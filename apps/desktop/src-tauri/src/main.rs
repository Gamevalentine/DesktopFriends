// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSWindow, NSWindowStyleMask};
#[cfg(target_os = "macos")]
use cocoa::base::id;

use std::fs;
use std::path::Path;
use tauri::http::{Request, Response, ResponseBuilder};
use tauri::Manager;

#[derive(serde::Serialize)]
struct CursorPosition {
    x: f64,
    y: f64,
    in_window: bool,
}

#[tauri::command]
fn get_cursor_position(window: tauri::Window) -> CursorPosition {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSEvent;
        use cocoa::base::nil;
        use cocoa::foundation::NSPoint;

        unsafe {
            let mouse_location: NSPoint = NSEvent::mouseLocation(nil);
            let ns_window = window.ns_window().unwrap() as id;
            let frame = NSWindow::frame(ns_window);
            let relative_x = mouse_location.x - frame.origin.x;
            let relative_y = mouse_location.y - frame.origin.y;
            let in_window = relative_x >= 0.0
                && relative_x <= frame.size.width
                && relative_y >= 0.0
                && relative_y <= frame.size.height;

            CursorPosition {
                x: relative_x,
                y: frame.size.height - relative_y,
                in_window,
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{POINT, RECT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetClientRect, GetCursorPos, ScreenToClient,
        };

        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd.0 as windows_sys::Win32::Foundation::HWND,
            Err(_) => {
                return CursorPosition {
                    x: 0.0,
                    y: 0.0,
                    in_window: false,
                }
            }
        };

        let mut point = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut point) } == 0 {
            return CursorPosition {
                x: 0.0,
                y: 0.0,
                in_window: false,
            };
        }

        // Convert from virtual-screen coordinates to the WebView client area.
        // This handles secondary monitors with negative virtual-screen offsets.
        if unsafe { ScreenToClient(hwnd, &mut point) } == 0 {
            return CursorPosition {
                x: 0.0,
                y: 0.0,
                in_window: false,
            };
        }

        let mut client_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if unsafe { GetClientRect(hwnd, &mut client_rect) } == 0 {
            return CursorPosition {
                x: 0.0,
                y: 0.0,
                in_window: false,
            };
        }

        // Win32 coordinates are physical pixels while DOM/Live2D hit testing uses
        // logical (CSS) pixels. Convert using the current monitor scale factor so
        // 125%/150% DPI does not shift the interactive region.
        let scale_factor = window.scale_factor().unwrap_or(1.0).max(f64::EPSILON);

        // Win32 RECT's right/bottom edges are exclusive.
        let in_window = point.x >= client_rect.left
            && point.x < client_rect.right
            && point.y >= client_rect.top
            && point.y < client_rect.bottom;

        CursorPosition {
            x: point.x as f64 / scale_factor,
            y: point.y as f64 / scale_factor,
            in_window,
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        CursorPosition {
            x: 0.0,
            y: 0.0,
            in_window: false,
        }
    }
}

fn get_mime_type(path: &str) -> &'static str {
    let extension = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match extension.to_lowercase().as_str() {
        "json" => "application/json",
        "moc3" | "moc" => "application/octet-stream",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "motion3.json" => "application/json",
        "exp3.json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn normalize_localfile_path(path: String) -> String {
    #[cfg(target_os = "windows")]
    {
        let mut normalized = path.replace('\\', "/");
        let bytes = normalized.as_bytes();

        if bytes.len() >= 3
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && bytes[2] == b':'
        {
            normalized.remove(0);
        }

        // Existing desktop code encodes a Windows path as part of the custom URL host.
        // Relative Live2D assets can therefore arrive as:
        // C:/.../model.model3.json/textures/texture.png
        // Convert that back to the model directory before reading the asset.
        let lower = normalized.to_ascii_lowercase();
        for marker in [".model3.json/", ".model.json/"] {
            if let Some(marker_start) = lower.find(marker) {
                if let Some(dir_end) = normalized[..marker_start].rfind('/') {
                    let asset_start = marker_start + marker.len();
                    return format!("{}{}", &normalized[..=dir_end], &normalized[asset_start..]);
                }
            }
        }

        return normalized;
    }

    #[cfg(not(target_os = "windows"))]
    {
        path
    }
}

fn handle_localfile_protocol(request: &Request) -> Result<Response, Box<dyn std::error::Error>> {
    let url = request.uri();
    let path = url.replace("localfile://localhost", "");
    let decoded_path = urlencoding::decode(&path)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| path.clone());
    let decoded_path = normalize_localfile_path(decoded_path);

    println!("[localfile] Requested: {}", decoded_path);

    let file_path = Path::new(&decoded_path);
    if !file_path.exists() {
        println!("[localfile] File not found: {}", decoded_path);
        return ResponseBuilder::new()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body(b"File not found".to_vec());
    }

    match fs::read(file_path) {
        Ok(contents) => {
            let mime_type = get_mime_type(&decoded_path);
            println!(
                "[localfile] Serving: {} ({}, {} bytes)",
                decoded_path,
                mime_type,
                contents.len()
            );
            ResponseBuilder::new()
                .status(200)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                .header("Access-Control-Allow-Headers", "*")
                .header("Content-Type", mime_type)
                .body(contents)
        }
        Err(e) => {
            println!("[localfile] Error reading file: {}", e);
            ResponseBuilder::new()
                .status(500)
                .header("Access-Control-Allow-Origin", "*")
                .body(format!("Error reading file: {}", e).into_bytes())
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::normalize_localfile_path;

    #[test]
    fn strips_leading_slash_before_windows_drive() {
        assert_eq!(
            normalize_localfile_path("/C:/Users/Test/AppData/Roaming/model.model3.json".into()),
            "C:/Users/Test/AppData/Roaming/model.model3.json"
        );
    }

    #[test]
    fn normalizes_windows_backslashes() {
        assert_eq!(
            normalize_localfile_path("C:\\Users\\Test\\model.model3.json".into()),
            "C:/Users/Test/model.model3.json"
        );
    }

    #[test]
    fn resolves_relative_live2d_texture_after_model_url() {
        assert_eq!(
            normalize_localfile_path(
                "C:/Users/Test/models/Hiyori/Hiyori.model3.json/textures/texture_00.png".into()
            ),
            "C:/Users/Test/models/Hiyori/textures/texture_00.png"
        );
    }

    #[test]
    fn resolves_relative_cubism2_asset_after_model_url() {
        assert_eq!(
            normalize_localfile_path(
                "C:/Users/Test/models/Shizuku/shizuku.model.json/motions/idle.mtn".into()
            ),
            "C:/Users/Test/models/Shizuku/motions/idle.mtn"
        );
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_cursor_position])
        .register_uri_scheme_protocol("localfile", |_app, request| {
            handle_localfile_protocol(request)
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let window = app.get_window("main").unwrap();
                let ns_window = window.ns_window().unwrap() as id;
                unsafe {
                    ns_window.setOpaque_(cocoa::base::NO);
                    ns_window.setBackgroundColor_(cocoa::appkit::NSColor::clearColor(
                        cocoa::base::nil,
                    ));

                    let mut style_mask = ns_window.styleMask();
                    style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
                    ns_window.setStyleMask_(style_mask);
                    ns_window.setTitlebarAppearsTransparent_(cocoa::base::YES);
                    ns_window.setTitleVisibility_(
                        cocoa::appkit::NSWindowTitleVisibility::NSWindowTitleHidden,
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
