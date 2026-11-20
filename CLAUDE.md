# TÀY TUBE PC - PROJECT CONTEXT & ARCHITECTURE

## 1. Tổng quan dự án
- **Mục tiêu:** Port ứng dụng xem YouTube Android (`YTXTube 2.2.0`) sang Windows Desktop bằng **Electron + React + Vite + TypeScript + TailwindCSS**.
- **Môi trường chạy thực tế của user:** Windows 10, CPU Intel Core i5-4590S, GPU NVIDIA GT 730 (cần tối ưu GPU, hạn chế `backdrop-blur` nặng, ưu tiên giải mã phần cứng).

## 2. Kiến trúc lõi (Backend & Streaming)
- **Trích xuất dữ liệu (`src/core/`):** Dùng client `ANDROID_VR` + `PoToken` để lấy stream độ phân giải cao (144p -> 2160p), phụ đề VTT (`TimedText`) và mốc tự động bỏ qua quảng cáo từ **SponsorBlock API**.
- **Local Proxy (`http://127.0.0.1:8989/stream`):**
  - Đóng vai trò trung gian vượt chặn 403/bóp băng thông từ `googlevideo.com`.
  - Phải xử lý chuẩn HTTP `206 Partial Content`, chuyển tiếp chính xác `Range: bytes=start-end`, dùng `keepAlive: true`, `socket.setTimeout(0)` và `stream.pipeline` để tránh đứt kết nối giữa chừng với video dài.
- **Trình phát Video (`shaka-player` + Virtual DASH MPD):**
  - Đã bỏ cách ghép 2 thẻ `<video>` + `<audio>` thủ công (vì gây deadlock và nghẽn `moov atom` trên video siêu dài 9–19 tiếng).
  - Với độ phân giải **1080p trở lên**: Server sinh động file **Virtual DASH MPD** (`/manifest.mpd`) tận dụng `initRange` và `indexRange` từ `adaptiveFormats` của YouTube, nạp vào `shaka-player` (chỉ dùng 1 thẻ `<video>` duy nhất).
  - Đã bật switch `autoplay-policy: no-user-gesture-required` trong `electron/main.ts`.

## 3. Lịch sử lỗi đã sửa & Vấn đề đang xử lý
- **[ĐÃ FIX]** Lỗi biên dịch `vite`/`tsc` và lỗi thiếu binary `electron.exe` sau khi cài `shaka-player`.
- **[ĐANG FIX]** Khi xem video siêu dài (9 tiếng – 19 tiếng) ở 1080p, phát tới **giây thứ 53** hoặc tua (seek) bị đứng vòng quay loading do Local Proxy bị timeout / rớt Range request giữa các chunk của Shaka Player.

## 4. Quy tắc làm việc bắt buộc
- Không xóa hoặc thay đổi luồng xác thực `ANDROID_VR` / `PoToken` đang hoạt động tốt.
- Mọi thay đổi ở Backend/Electron phải đảm bảo biên dịch sạch với `npm run build` (`tsc` + `vite build`).