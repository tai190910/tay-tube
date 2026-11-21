# Tày Tube PC 🎬

**Trình phát video & xem phim Desktop hiện đại, tối giản và siêu mượt dành cho Windows.**  
*A modern, lightweight, and high-performance desktop video player built for Windows.*

---

## 📥 Tải về & Cài đặt nhanh (Dành cho người dùng Windows)

Tải ngay phiên bản phát hành mới nhất của **Tày Tube PC** tại đường dẫn sau:  
👉 **[Trang Releases - Tày Tube PC](https://github.com/tai190910/tay-tube/releases)**

Tại trang Releases, bạn có thể lựa chọn 1 trong 2 phiên bản phù hợp với nhu cầu:

| Tệp cài đặt (`.exe`) | Phiên bản | Mô tả & Cách sử dụng |
| :--- | :--- | :--- |
| **`Tay-Tube-PC-Setup-1.2.0.exe`** | **Bản cài đặt đầy đủ** *(Khuyên dùng)* | Tự động cài đặt vào hệ thống Windows, tự tạo biểu tượng shortcut ngoài màn hình Desktop và trong Start Menu để tiện mở ứng dụng hàng ngày. |
| **`Tay-Tube-PC-1.2.0-Portable.exe`** | **Bản Portable** *(Chạy ngay)* | Không cần cài đặt. Tải về nhấp đúp chuột là xem phim được ngay, có thể copy vào USB để mang theo và sử dụng trên nhiều máy tính khác nhau. |

> [!NOTE]
> ### 🛡️ Lưu ý về cảnh báo bảo vệ của Windows (SmartScreen)
> Do **Tày Tube PC** là dự án mã nguồn mở phát triển độc lập phi lợi nhuận (chưa đăng ký chứng chỉ số thương mại đắt tiền từ Microsoft), khi bạn mở file `.exe` lần đầu tiên, Windows SmartScreen có thể hiển thị cảnh báo:  
> **`"Windows protected your PC"`** *(Windows đã bảo vệ máy tính của bạn)*.
>
> **Cách xử lý rất đơn giản:**
> 1. Nhấp chuột vào dòng chữ **"More info"** *(Thêm thông tin)* trên bảng cảnh báo.
> 2. Chọn nút **"Run anyway"** *(Vẫn chạy)*. Ứng dụng sẽ khởi động bình thường và hoàn toàn an toàn cho thiết bị của bạn.

---

## 🌟 Giới thiệu & Tính năng chính (v1.2.0)

**Tày Tube PC** là ứng dụng xem video, Shorts và nghe nhạc YouTube trên desktop Windows, tập trung vào khả năng phát ổn định các video siêu dài và tiêu tốn ít tài nguyên phần cứng:

- ⚡ **Kiến trúc Tauri v2 + Rust:** Thay thế Electron bằng backend Rust gọn nhẹ và Microsoft Edge WebView2, giảm đáng kể mức chiếm dụng RAM và CPU trên các máy cấu hình tầm trung hoặc văn phòng.
- 🎞️ **Chunked Range Proxy phát & tua video 19h+ tức thì:** Proxy cục bộ viết bằng Rust (`axum` trên cổng `8989`) chia nhỏ request theo từng phân đoạn 2 MB, hỗ trợ tua nhanh ngay cả trên các video dài hàng chục giờ mà không tràn RAM hay treo ứng dụng.
- 🎥 **Giao diện Cinema Dark Mode thông minh:** Tự động ẩn thanh điều khiển và con trỏ chuột khi xem video, đồng thời hạn chế tối đa hiệu ứng làm mờ nặng GPU.
- 🔐 **Đăng nhập tài khoản Google (Device OAuth):** Liên kết tài khoản qua `google.com/device` để đồng bộ Lịch sử xem (Watch History), Xem sau (Watch Later), Kênh đăng ký (Subscriptions) và tiến độ xem, kết hợp lưu trữ cục bộ an toàn bằng SQLite.
- 📱 **YouTube Shorts trên PC:** Trình phát dọc tỷ lệ 9:16 căn giữa màn hình, hỗ trợ cuộn vô tận bằng con lăn chuột hoặc phím mũi tên lên/xuống, thích/bình luận và tự giải phóng bộ nhớ decoder khi chuyển clip.
- 🎵 **YouTube Music Mode & Mini Player chạy nền:** Tìm kiếm bài hát, danh sách chờ Radio, phát âm thanh tách riêng qua Chunked Range Proxy với thanh Mini Player cố định dưới đáy giúp nghe nhạc xuyên suốt khi duyệt tab khác và không dùng hiệu ứng `backdrop-blur` nặng GPU.

---

## 💻 Dành cho lập trình viên (Build từ mã nguồn)

Dành cho những ai muốn tự đóng gói từ mã nguồn hoặc tham gia phát triển dự án:

### Yêu cầu môi trường
- **Hệ điều hành:** Windows 10 / 11 (64-bit)
- **Node.js:** Phiên bản 20 trở lên và `npm`
- **Rust & C++ Toolchain:** Rust (`rustc` + `cargo`), **Microsoft C++ Build Tools** (Visual Studio Build Tools với Desktop development with C++) và **Microsoft Edge WebView2 Runtime**

### Các bước cài đặt và khởi chạy

1. **Clone mã nguồn về máy:**
   ```bash
   git clone https://github.com/tai190910/tay-tube.git
   cd tay-tube
   ```

2. **Cài đặt các thư viện phụ thuộc:**
   ```bash
   npm install
   ```

3. **Khởi chạy ở chế độ phát triển (Live Dev):**
   ```bash
   npm run tauri dev
   ```

4. **Biên dịch & đóng gói Tauri v2 + Rust bản release:**
   ```bash
   npm run tauri build
   ```
   Lệnh này biên dịch frontend TypeScript/Vite và Rust (`--release`), đồng thời tạo bộ cài đặt NSIS trong `src-tauri/target/release/bundle/nsis/` và file thực thi độc lập `src-tauri/target/release/tay-tube-pc.exe`. Để tự động gom cả 2 tệp của phiên bản `1.2.0` vào thư mục `release/` (`release/Tay-Tube-PC-Setup-1.2.0.exe` và `release/Tay-Tube-PC-1.2.0-Portable.exe`), chạy thêm:
   ```bash
   npm run build:release
   ```

---

## 🙏 Ghi nhận & Tri ân (Credits)

- **[MeeTube / SmartTube](https://github.com/yuliskov/SmartTube):** Tham khảo cơ chế xác thực Google Device OAuth2, cấu hình InnerTube client, các endpoint **YouTube Shorts** (`reel/reel_item_watch`, `reel/reel_watch_sequence`), **YouTube Music (MeeTune)** (`WEB_REMIX`), `FEhistory`, `VLWL`, `FEsubscriptions` và đồng bộ tiến độ xem.
- **[YTXTube](https://github.com/Koustubh12345/YTXTube/):** Dự án nền tảng ban đầu truyền cảm hứng cho kiến trúc trích xuất luồng phát và tối ưu trải nghiệm xem video YouTube.

---

## 📄 Giấy phép (License)

Dự án được phát hành theo giấy phép **GPL-3.0** (`GNU General Public License v3.0`).
