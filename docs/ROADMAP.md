# DesktopFriends Roadmap

Mục tiêu: port DesktopFriends sang Windows trước, sau đó mới nâng cấp thành AI companion đầy đủ. Mỗi giai đoạn chỉ sửa đúng khu vực của giai đoạn đó để tránh ảnh hưởng chéo.

## Nguyên tắc làm việc

1. `main` giữ bản ổn định.
2. Mỗi nhóm chức năng dùng nhánh riêng.
3. Chỉ merge khi build + test của nhóm đó đạt.
4. Không thêm tính năng mới khi nền Windows chưa ổn định.
5. Mỗi lỗi phải sửa ở nguyên nhân gốc, không vá tạm nhiều nơi.

---

## KHU A — Nền Windows

**Mục tiêu:** app chạy native trên Windows như bản desktop thật.

### A1. Build Windows
- [x] Thêm workflow GitHub Actions Windows.
- [ ] Build Tauri hoàn chỉnh trên `windows-latest`.
- [ ] Xuất `.msi` / `.exe` artifact.

### A2. Native cursor
- [x] Thêm lấy vị trí chuột bằng Win32 API.
- [ ] Kiểm tra tọa độ chính xác khi scale DPI khác 100%.
- [ ] Kiểm tra nhiều màn hình.

### A3. Transparent window + click-through
- [ ] Kiểm tra nền trong suốt trên Windows.
- [ ] Kiểm tra `setIgnoreCursorEvents()`.
- [ ] Chỉ bắt click khi chuột nằm trên Live2D/UI.
- [ ] Không chặn click desktop ở vùng trong suốt.

### A4. Windows file path
- [x] Hỗ trợ `C:\...` trong custom `localfile://` protocol.
- [ ] Kiểm tra model nằm trong AppData.
- [ ] Kiểm tra texture / motion / expression tương đối.

**Chỉ khi KHU A hoàn tất mới chuyển sang KHU B.**

---

## KHU B — Live2D

**Mục tiêu:** nhân vật hiển thị và tương tác ổn định.

### B1. Model loader
- [ ] Import `.zip` Live2D.
- [ ] Cubism 2 (`model.json`).
- [ ] Cubism 3/4 (`model3.json`).
- [ ] Texture path Windows.

### B2. Interaction
- [ ] Click đầu / thân.
- [ ] Motion.
- [ ] Expression.
- [ ] Hover detection theo pixel alpha.

### B3. Window behavior
- [ ] Kéo nhân vật/cửa sổ.
- [ ] Always-on-top.
- [ ] Lock/unlock interaction.
- [ ] Ghi nhớ vị trí/kích thước cửa sổ.

---

## KHU C — AI Core

**Mục tiêu:** giữ nguyên và kiểm tra AI hiện có trước khi mở rộng.

### C1. Agent
- [ ] Chat hoạt động.
- [ ] Tool calling hoạt động.
- [ ] ReAct loop ổn định.

### C2. Provider
- [ ] OpenAI-compatible API.
- [ ] DeepSeek / Claude nếu source hiện tại hỗ trợ.
- [ ] Kiểm tra lỗi key / timeout / model unavailable.

### C3. Tool hiện có
- [ ] Live2D expression/motion.
- [ ] Todo.
- [ ] Timemap.
- [ ] Widget context.
- [ ] Pet-to-pet communication.

**Không viết lại AI core nếu chưa có lỗi thực tế.**

---

## KHU D — Memory & chủ động

**Mục tiêu:** biến nhân vật từ chatbot thành companion có đời sống.

### D1. Short-term memory
- [ ] Chuẩn hóa chat history hiện có.
- [ ] Giới hạn context để tránh tăng token vô hạn.

### D2. Long-term memory
- [ ] Lưu ký ức quan trọng.
- [ ] Semantic retrieval.
- [ ] Tách ký ức người dùng / sở thích / sự kiện.
- [ ] Cho phép xóa/sửa ký ức.

### D3. Heartbeat / schedule
- [ ] Kiểm tra Timemap hiện có.
- [ ] Agent tự kích hoạt đúng giờ.
- [ ] Daily / once schedule.
- [ ] Không gọi LLM liên tục khi không cần.

---

## KHU E — Voice

**Mục tiêu:** nói chuyện hai chiều.

### E1. STT
- [ ] Push-to-talk trước.
- [ ] Sau đó mới cân nhắc wake word.

### E2. TTS
- [ ] TTS engine.
- [ ] Lip-sync nếu Live2D hỗ trợ parameter mouth.
- [ ] Hàng đợi âm thanh tránh nói chồng.

### E3. Voice UX
- [ ] Mic permission.
- [ ] Mute/unmute.
- [ ] Hiển thị trạng thái nghe / nghĩ / nói.

---

## KHU F — PC Awareness & Tools

**Mục tiêu:** chỉ thêm sau khi AI + memory + voice ổn định.

### F1. Screen awareness
- [ ] Chụp màn hình khi người dùng cho phép.
- [ ] Chỉ phân tích khi cần, không chụp liên tục.

### F2. PC tools
- [ ] Mở ứng dụng.
- [ ] Mở file/folder.
- [ ] Notification.
- [ ] Các hành động nguy hiểm phải yêu cầu xác nhận.

---

## KHU G — UI/UX Windows

**Mục tiêu:** app dùng như sản phẩm hoàn chỉnh.

- [ ] Giao diện Settings rõ ràng.
- [ ] Chọn model / personality / provider.
- [ ] Quản lý memory.
- [ ] Quản lý Todo/Timemap.
- [ ] Tray icon.
- [ ] Start with Windows.
- [ ] Vietnamese UI nếu cần.

---

## KHU H — Test & Release

### H1. Test kỹ thuật
- [ ] Build debug.
- [ ] Build release.
- [ ] Windows 10.
- [ ] Windows 11.
- [ ] DPI 100% / 125% / 150%.
- [ ] 1 màn hình / nhiều màn hình.

### H2. Test chức năng
- [ ] Live2D.
- [ ] Click-through.
- [ ] AI chat.
- [ ] Timemap.
- [ ] Todo.
- [ ] Restart app không mất cấu hình.

### H3. Release
- [ ] Installer Windows.
- [ ] Release notes.
- [ ] Merge nhánh đã test vào `main`.

---

# Thứ tự triển khai bắt buộc

```text
A. Windows nền
   ↓
B. Live2D
   ↓
C. AI core
   ↓
D. Memory + chủ động
   ↓
E. Voice
   ↓
F. Screen/PC tools
   ↓
G. UI hoàn thiện
   ↓
H. Test + Release
```

## Trạng thái hiện tại

Đang ở **KHU A — Nền Windows**.

Không phát triển Memory, Voice, Screen Awareness hoặc PC tools cho đến khi KHU A và KHU B đã chạy ổn định trên Windows.
