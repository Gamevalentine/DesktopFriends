# DesktopFriends — Current Status

Cập nhật: 2026-09-05

## Phase A — Windows foundation

**Trạng thái: ĐẠT GATE CƠ BẢN**

Đã xác nhận trên máy Windows thật:
- App cài và khởi động được.
- Live2D render được.
- Nền desktop trong suốt.
- Vùng ngoài nhân vật click xuyên xuống desktop.
- Nhân vật vẫn giữ vùng tương tác riêng.

Đã có trong source/CI:
- Win32 cursor tracking.
- DPI coordinate conversion.
- Multi-monitor-safe `ScreenToClient` conversion.
- Windows local Live2D path normalization.
- Rust tests.
- Windows release build.
- Startup smoke test.
- NSIS `.exe` và WiX `.msi` artifacts.

Regression còn để lại cho phase L:
- DPI 100/125/150% trên máy thật.
- Nhiều bố cục multi-monitor khác nhau.
- Lock/unlock interaction matrix.

## Phase B — Live2D

**Trạng thái: ĐANG LÀM — B1 runtime render fix / B2 interaction code**

Nhánh: `live2d-hardening`

### B1 — Model loader
**Trạng thái: IMPORT/METADATA ĐẠT; ĐANG XÁC NHẬN LẠI RENDER MODEL LOCAL TRÊN WINDOWS**

- [x] Rà source import ZIP hiện tại.
- [x] Chặn ZIP path traversal / absolute path.
- [x] Chỉ chọn model JSON khi các file bắt buộc mà model tham chiếu thực sự tồn tại.
- [x] Chỉ giải nén phạm vi model đã chọn, tránh file rác ngoài model root.
- [x] CI Windows xanh sau hardening.
- [x] Sửa false-positive validator với thư mục bình thường trong ZIP.
- [x] Runtime import ZIP Cubism 3/4 trên Windows (Hiyori: 1 texture, 8 motion, 6 motion groups, 14 files).
- [x] Runtime import ZIP Cubism 2 trên Windows (Shizuku: 4 expressions, 18 motions, 6 motion groups, 6 textures, 47 files).
- [x] Xác nhận metadata texture/motion/expression sau import.
- [x] Xác định lỗi Windows local model URL: frontend tự tạo `localfile://...` không theo mapping WebView2 của Tauri.
- [x] Chuyển frontend sang `convertFileSrc(filePath, "localfile")` của Tauri.
- [x] Backend nhận cả `localfile://localhost/...` và `https://localfile.localhost/...`.
- [x] CSP cho phép `https://localfile.localhost` cho model texture/media/connect.
- [ ] Runtime: Shizuku Cubism 2 render thật trên Windows sau fix 1.4.4.
- [ ] Runtime: motion/expression tải và phát thật từ model local.

### B2 — Interaction
- [x] Bỏ hard-code phụ thuộc tên `tap_body` / `happy` trong code.
- [x] Fallback motion/expression theo model thực tế trong code.
- [ ] Runtime click đầu/thân trên model local sau khi render được.
- [x] Pixel-alpha hit test không bắt vùng canvas trong suốt — đã xác nhận trên Windows thật ở Phase A.

### B3 — Window behavior
- [ ] Kéo cửa sổ/nhân vật.
- [ ] Always-on-top.
- [ ] Lock/unlock.
- [ ] Ghi nhớ vị trí và kích thước cửa sổ.

## Không làm trong phase B

Chưa đụng tới AI core, memory, voice, iPhone remote hoặc PC tools cho đến khi Gate B đạt.
