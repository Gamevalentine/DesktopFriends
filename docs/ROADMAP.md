# DesktopFriends — Development Roadmap

Mục tiêu cuối: một AI companion duy nhất chạy bộ não chính trên Windows, có Live2D trên desktop, có trí nhớ và lịch chủ động, và có thể chat từ iPhone ở bất kỳ đâu qua một kết nối riêng tư.

## Nguyên tắc làm việc

1. `main` giữ bản ổn định.
2. Mỗi nhóm chức năng dùng nhánh riêng.
3. Chỉ merge khi build + test của nhóm đó đạt.
4. Không nhảy sang tính năng sau khi nền trước chưa ổn định.
5. Sửa ở nguyên nhân gốc, không vá cùng một lỗi ở nhiều nơi.
6. Tận dụng source hiện có trước khi viết mới.
7. Windows là bộ não chính; iPhone về sau chỉ là remote client của cùng một AI.

---

# A — Nền Windows

**Mục tiêu:** DesktopFriends chạy native trên Windows và có installer thật.

## A1. Build / Installer
- [x] Thêm GitHub Actions Windows.
- [x] Build Tauri thành công trên `windows-latest`.
- [x] Xuất NSIS `setup.exe`.
- [x] Xuất WiX `.msi`.
- [x] CI kiểm tra bắt buộc cả hai installer tồn tại.
- [x] CI có startup smoke test để phát hiện app crash ngay khi mở.

## A2. Native cursor / DPI / multi-monitor
- [x] Lấy vị trí chuột bằng Win32 API.
- [x] Dùng `ScreenToClient` thay vì tự trừ vị trí cửa sổ.
- [x] Dùng client rect thật của Windows.
- [x] Quy đổi physical pixel → logical/CSS pixel bằng scale factor.
- [ ] Runtime test DPI 100%.
- [ ] Runtime test DPI 125%.
- [ ] Runtime test DPI 150%.
- [ ] Runtime test màn hình phụ nằm trái/phía trên màn hình chính.

## A3. Transparent window + click-through
- [x] Tauri config có `transparent: true`.
- [x] Tauri config có `decorations: false`.
- [x] HTML/WebView root có nền transparent.
- [x] Source đã có `setIgnoreCursorEvents()` và polling hit-test.
- [ ] Runtime test nền trong suốt trên Windows 10/11.
- [ ] Runtime test click đúng trên Live2D/UI.
- [ ] Runtime test vùng trong suốt click xuyên desktop.
- [ ] Runtime test lock/unlock interaction.

> Lưu ý: app hiện có hệ thống background riêng. Nền gradient/image do người dùng chọn sẽ cố ý che nền trong suốt; không ép transparent bằng hack khi khởi động.

## A4. Windows file path / local Live2D assets
- [x] Hỗ trợ đường dẫn `C:\\...`.
- [x] Bỏ slash thừa trước drive letter trong `localfile://`.
- [x] Sửa relative asset path đi qua `model3.json` / `model.json`.
- [x] Có unit test cho path normalization trên Windows.
- [ ] Runtime test model trong AppData.
- [ ] Runtime test texture tương đối.
- [ ] Runtime test motion/expression tương đối.

**Gate A:** chỉ chuyển sang B sau khi installer mới qua CI và runtime test Windows cơ bản đạt.

---

# B — Live2D

**Mục tiêu:** nhân vật hiển thị và tương tác ổn định trên Windows.

## B1. Model loader
- [ ] Import ZIP Live2D.
- [ ] Cubism 2 (`model.json`).
- [ ] Cubism 3/4 (`model3.json`).
- [ ] Texture path Windows.
- [ ] Model lỗi phải báo rõ và vẫn vào được Settings.

## B2. Interaction
- [ ] Click đầu / thân.
- [ ] Motion.
- [ ] Expression.
- [ ] Hover detection theo pixel alpha.
- [ ] Không bắt click vào phần canvas trong suốt.

## B3. Window behavior
- [ ] Kéo nhân vật/cửa sổ.
- [ ] Always-on-top.
- [ ] Lock/unlock interaction.
- [ ] Ghi nhớ vị trí/kích thước cửa sổ.

**Gate B:** Live2D thật phải chạy ổn trước khi kiểm tra/nâng AI.

---

# C — AI Core hiện có

**Mục tiêu:** giữ và kiểm tra AI hiện có trước khi mở rộng.

## C1. Agent
- [ ] Chat hoạt động.
- [ ] Streaming hoạt động.
- [ ] Tool calling hoạt động.
- [ ] ReAct loop ổn định.
- [ ] `shouldReply` / inner thought không gây treo luồng.

## C2. Provider
- [ ] OpenAI-compatible API.
- [ ] DeepSeek.
- [ ] Claude nếu source hiện tại còn hỗ trợ.
- [ ] Lỗi API key rõ ràng.
- [ ] Timeout / model unavailable không làm app treo.

## C3. Tool hiện có
- [ ] Live2D expression/motion.
- [ ] Todo.
- [ ] Timemap.
- [ ] Widget context.
- [ ] Pet-to-pet communication.

**Không viết lại AI core nếu chưa có lỗi thực tế.**

---

# D — One Brain: Windows làm bộ não duy nhất

**Mục tiêu:** chuẩn bị cho nhiều thiết bị nhưng chỉ có một AI/state chính.

- [ ] AI Agent chạy ở Windows host.
- [ ] API key chỉ lưu ở Windows.
- [ ] Chat history có nguồn sự thật duy nhất.
- [ ] Todo có nguồn sự thật duy nhất.
- [ ] Timemap có nguồn sự thật duy nhất.
- [ ] Personality có nguồn sự thật duy nhất.
- [ ] Định nghĩa protocol remote client tối thiểu.
- [ ] Đồng bộ message realtime giữa các client.

Kiến trúc mục tiêu:

```text
Windows Host
├─ AI Agent
├─ Memory
├─ Chat History
├─ Todo
├─ Timemap
└─ Private API / Socket
       ├─ Windows UI
       └─ iPhone Remote Client
```

---

# E — iPhone Remote Client

**Mục tiêu:** iPhone ở ngoài nhà vẫn chat với đúng AI đang chạy trên Windows.

## E1. Mobile Web / PWA
- [ ] Tận dụng `apps/mobile` hiện có.
- [ ] Chế độ remote client không chạy AI riêng trên iPhone.
- [ ] Chat UI mobile.
- [ ] Live2D mobile nếu hiệu năng phù hợp.
- [ ] Add to Home Screen.

## E2. Remote transport
- [ ] Tận dụng Fastify + Socket.IO server hiện có.
- [ ] Thêm protocol user↔host thay vì chỉ pet↔pet.
- [ ] Reconnect tự động.
- [ ] Đồng bộ reply về cả Windows và iPhone.

## E3. Kết nối ngoài Wi-Fi nhà
- [ ] Tailscale private network.
- [ ] Không mở port router công khai.
- [ ] Không đưa API key lên iPhone.
- [ ] Test iPhone qua 4G/5G khi Windows ở Wi-Fi nhà.

---

# F — Memory

**Mục tiêu:** cùng một trí nhớ dùng xuyên Windows/iPhone và xuyên phiên.

## F1. Short-term
- [ ] Chuẩn hóa chat context.
- [ ] Giới hạn context/token.
- [ ] Tóm tắt lịch sử cũ khi cần.

## F2. Long-term
- [ ] Lưu ký ức quan trọng.
- [ ] Semantic retrieval.
- [ ] Tách profile / preference / event / relationship memory.
- [ ] Tránh lưu mọi câu chat vô hạn.
- [ ] Cho phép xem/sửa/xóa/quên ký ức.

---

# G — Proactive / Timemap / Heartbeat

**Mục tiêu:** companion có thể chủ động đúng lúc nhưng không gọi LLM liên tục.

- [ ] Kiểm tra Timemap hiện có.
- [ ] `once` schedule.
- [ ] `daily` schedule.
- [ ] Heartbeat local nhẹ.
- [ ] Chỉ gọi AI khi có event cần xử lý.
- [ ] Reply proactive đồng bộ ra Windows/iPhone.
- [ ] Quiet hours / không làm phiền.

---

# H — Voice

**Mục tiêu:** nói chuyện hai chiều.

## H1. STT
- [ ] Push-to-talk trước.
- [ ] Microphone permission rõ ràng.
- [ ] Sau đó mới cân nhắc wake word.

## H2. TTS
- [ ] TTS engine.
- [ ] Hàng đợi audio tránh nói chồng.
- [ ] Lip-sync nếu model có mouth parameter.

## H3. Cross-device voice
- [ ] Nói từ Windows.
- [ ] Nói từ iPhone.
- [ ] Windows host vẫn là nơi xử lý AI chính.

---

# I — Screen Awareness & PC Tools

**Mục tiêu:** AI hiểu môi trường PC khi được cho phép và có một số công cụ an toàn.

## I1. Screen awareness
- [ ] Chụp màn hình chỉ khi cần/được cho phép.
- [ ] Không capture liên tục mặc định.
- [ ] Nhận biết app/window hiện tại khi cần.

## I2. PC tools
- [ ] Mở ứng dụng.
- [ ] Mở file/folder.
- [ ] Notification.
- [ ] Tìm file.
- [ ] Hành động phá hủy/nguy hiểm phải xác nhận.

---

# J — UI/UX hoàn chỉnh

- [ ] UI tiếng Việt.
- [ ] Settings rõ theo khu vực.
- [ ] Chọn model / personality / provider.
- [ ] Memory manager.
- [ ] Todo/Timemap manager.
- [ ] Device manager.
- [ ] Tray icon.
- [ ] Start with Windows.
- [ ] Trạng thái online/offline/reconnecting.

---

# K — Security

- [ ] Pairing iPhone lần đầu bằng mã/QR.
- [ ] Windows phải xác nhận thiết bị mới.
- [ ] Device token riêng.
- [ ] Thu hồi thiết bị từ Windows.
- [ ] API key chỉ ở Windows.
- [ ] Không expose Socket server trực tiếp ra Internet.
- [ ] Dangerous PC tools yêu cầu confirmation.

---

# L — Test & Release

## L1. Windows matrix
- [ ] Windows 10.
- [ ] Windows 11.
- [ ] DPI 100/125/150%.
- [ ] 1 monitor / multi-monitor.
- [ ] Sleep → wake.
- [ ] Restart Windows.

## L2. Functional
- [ ] Live2D.
- [ ] Click-through.
- [ ] AI chat.
- [ ] Memory.
- [ ] Timemap/Heartbeat.
- [ ] iPhone local Wi-Fi.
- [ ] iPhone 4G/5G remote.
- [ ] Mất mạng → reconnect.

## L3. Release
- [ ] Stable Windows installer.
- [ ] Release notes.
- [ ] Auto-update strategy.
- [ ] Merge tested branch vào `main`.

---

# Thứ tự bắt buộc

```text
A Windows nền
↓
B Live2D
↓
C AI Core
↓
D One Brain
↓
E iPhone Remote
↓
F Memory
↓
G Proactive
↓
H Voice
↓
I Screen/PC tools
↓
J UI/UX
↓
K Security hardening
↓
L Test/Release
```

# Mốc sản phẩm

## MVP 1 — Desktop Windows
Windows + Live2D + Chat + AI.

## MVP 2 — Một AI, nhiều thiết bị
Windows host + iPhone remote + cùng chat/state.

## MVP 3 — Companion thật
Memory + Timemap + Heartbeat + proactive.

## MVP 4 — Hoàn chỉnh
Voice + screen awareness + PC tools + UI/security/release.

---

## Trạng thái hiện tại

**Đang ở A — Nền Windows.**

- Build/installer: **đã đạt ở CI**.
- Cursor Win32: **đã triển khai**, đang chờ CI + runtime validation cho DPI/multi-monitor.
- Transparent/click-through: **source/config đã có**, còn runtime validation.
- Windows Live2D path: **đã có fix + unit test**, còn runtime validation với model thật.

Không chuyển sang B cho đến khi Gate A đạt.
