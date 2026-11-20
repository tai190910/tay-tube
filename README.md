# Tày Tube PC

Ứng dụng xem YouTube trên Windows được xây dựng bằng **Tauri v2 (Rust backend)** và **React + TypeScript + Vite + TailwindCSS**, tối ưu bộ nhớ và CPU cho máy cấu hình tầm trung hoặc thấp (ví dụ Intel Core i5-4590S và NVIDIA GT 730).

## Tính năng chính

### Phát mượt và tua nhanh video siêu dài (9 đến 37 giờ)
- Backend Rust tích hợp **Chunked Range Proxy** nội bộ trên `http://127.0.0.1:8989` (`axum` + `reqwest` + `tokio`, giữ kết nối keep-alive và truyền trực tiếp theo từng chunk tối đa 2 MB).
- Tự động lấy luồng HLS (`hlsManifestUrl`) qua InnerTube client `IOS` và ghi lại playlist qua `/hls-manifest` để phát bằng **Shaka Player** trên một thẻ `<video>` duy nhất, kèm fallback sang MP4 qua `/stream` và tự làm mới URL nếu gặp HTTP 403.

### Giao diện Cinema Dark Mode tối giản
- Tự động ẩn thanh điều khiển và con trỏ chuột sau 2,5 giây không di chuyển chuột khi đang phát, dùng chuyển động `opacity` và `translateY`.
- Thanh tiến trình có hiển thị phần đã đệm (`buffered`), kéo tua và tooltip thời gian định dạng `HH:MM:SS` cho video dài.
- Hạn chế các lớp `backdrop-blur` nặng GPU, giữ nền tối `#0b0b0b` cho tốc độ khung hình ổn định.
- Hỗ trợ phím tắt chuẩn YouTube: `Space` / `K` (phát hoặc dừng), `J` / `L` (tua 10 giây), `←` / `→` (tua 5 giây), `↑` / `↓` (âm lượng), `M` (tắt tiếng), `F` (toàn màn hình), `T` (rạp hát).

### Phụ đề không khóa UI, SponsorBlock và SQLite cục bộ
- Phân tích phụ đề VTT theo batch bất đồng bộ, lưu danh sách cue vào `useRef` và tìm kiếm nhị phân theo thời gian phát.
- Tự động bỏ qua đoạn tài trợ, intro hoặc outro từ dữ liệu SponsorBlock.
- Lưu lịch sử xem, vị trí xem dở (tự bỏ qua 10 giây đầu và cuối) và danh sách yêu thích bằng SQLite tích hợp (`rusqlite` `bundled`) tại `%APPDATA%\tay-tube-pc\taytube.db`.

## Yêu cầu môi trường

- Node.js >= 18 và npm
- Rust và Cargo (`rustup` toolchain `stable-x86_64-pc-windows-msvc`)
- Microsoft Edge WebView2 Runtime (có sẵn trên Windows 10/11)

## Cài đặt và phát triển

```bash
npm install
npm run tauri:dev
```

Chạy kiểm tra mã nguồn frontend và unit test backend Rust:

```bash
npm run build
cd src-tauri && cargo test
```

## Đóng gói bản build Windows (x64)

```bash
npm run build:release
```

Lệnh này biên dịch giao diện vào `dist-renderer/`, biên dịch Tauri v2 + Rust bản release (đã nhúng WebView assets, icon và SQLite) rồi xuất cả 2 tệp vào thư mục `release/`:
- `release/Tay-Tube-PC_1.0.0_x64-setup.exe` (bộ cài đặt NSIS trên Windows)
- `release/Tay-Tube-PC_1.0.0_x64-portable.exe` (bản chạy trực tiếp không cần cài đặt)
