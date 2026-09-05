// Minimal Tauri v1 convertFileSrc-compatible shim for shared UI builds.
// Tauri v1 encodes the whole path and maps custom protocols to
// http://<protocol>.localhost/... on Windows/WebView2.
export function convertFileSrc(filePath: string, protocol = 'asset'): string {
  const encodedPath = encodeURIComponent(filePath)
  const isWindows =
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

  return isWindows
    ? `http://${protocol}.localhost/${encodedPath}`
    : `${protocol}://localhost/${encodedPath}`
}
