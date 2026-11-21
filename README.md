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
| **`Tay-Tube-PC-Setup-1.1.0.exe`** | **Bản cài đặt đầy đủ** *(Khuyên dùng)* | Tự động cài đặt vào hệ thống Windows, tự tạo biểu tượng shortcut ngoài màn hình Desktop và trong Start Menu để tiện mở ứng dụng hàng ngày. |
| **`Tay-Tube-PC-1.1.0-Portable.exe`** | **Bản Portable** *(Chạy ngay)* | Không cần cài đặt. Tải về nhấp đúp chuột là xem phim được ngay, có thể copy vào USB để mang theo và sử dụng trên nhiều máy tính khác nhau. |

> [!NOTE]
> ### 🛡️ Lưu ý về cảnh báo bảo vệ của Windows (SmartScreen)
> Do **Tày Tube PC** là dự án mã nguồn mở phát triển độc lập phi lợi nhuận (chưa đăng ký chứng chỉ số thương mại đắt tiền từ Microsoft), khi bạn mở file `.exe` lần đầu tiên, Windows SmartScreen có thể hiển thị cảnh báo:  
> **`"Windows protected your PC"`** *(Windows đã bảo vệ máy tính của bạn)*.
>
> **Cách xử lý rất đơn giản:**
> 1. Nhấp chuột vào dòng chữ **"More info"** *(Thêm thông tin)* trên bảng cảnh báo.
> 2. Chọn nút **"Run anyway"** *(Vẫn chạy)*. Ứng dụng sẽ khởi động bình thường và hoàn toàn an toàn cho thiết bị của bạn.

---

## 🌟 Giới thiệu & Tính năng chính

**Tày Tube PC** là ứng dụng xem video/phim YouTube trên desktop dành riêng cho Windows, tập trung vào khả năng phát ổn định các video siêu dài, giao diện rạp chiếu phim tối giản và tiêu tốn cực ít tài nguyên phần cứng:

- 🎞️ **Phát & Tua video siêu dài tức thì (Instant Seeking):** Tích hợp cơ chế **Chunked Range Proxy** chia nhỏ dữ liệu truyền tải theo từng phân đoạn thông minh, giúp tua (scrubbing) mượt mà ngay cả trên các video dài hàng chục tiếng đồng hồ (19h+) mà không gây tràn RAM hay đứng hình.
- 🎥 **Giao diện Cinema Dark Mode thông minh:** Tự động ẩn thanh điều khiển và con trỏ chuột sau vài giây không thao tác để tối ưu không gian hiển thị, không làm ảnh hưởng đến trải nghiệm xem phim.
- ⚡ **Tối ưu phần cứng tầm trung & văn phòng:** Giảm thiểu tối đa các hiệu ứng làm mờ (blur) ngốn GPU, đảm bảo hoạt động mát mẻ, ổn định trên các cấu hình phổ thông.
- 🔐 **Đăng nhập tài khoản Google (Device OAuth):** Liên kết tài khoản an toàn qua `google.com/device` để đồng bộ **Lịch sử xem (Watch History)**, **Xem sau (Watch Later)** và **Kênh đăng ký (Subscriptions)** ngay trên ứng dụng.
- 💾 **Lưu trữ cục bộ an toàn (Offline):** Toàn bộ lịch sử xem phim, tiến độ xem dở và video yêu thích được lưu trữ cục bộ ngay trên máy thông qua SQLite, vẫn dùng mượt mà khi chưa đăng nhập.

---

## 💻 Dành cho lập trình viên (Build từ mã nguồn)

Dành cho những ai muốn tự đóng gói từ mã nguồn hoặc tham gia phát triển dự án:

### Yêu cầu môi trường
- **Hệ điều hành:** Windows 10 / 11 (64-bit)
- **Node.js:** Phiên bản 20 trở lên và `npm`
- *(Nếu build bản Rust / Tauri v2)*: **Rust** (`rustc` + `cargo`), **Microsoft C++ Build Tools** và **Microsoft Edge WebView2 Runtime**

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
   npm run tauri:dev
   ```

4. **Đóng gói bản build hoàn chỉnh cho Windows (x64):**
   ```bash
   npm run build:release
   ```
   Lệnh này biên dịch giao diện, build ứng dụng **Tauri v2 + Rust** ở chế độ release và tự động xuất cả 2 tệp vào thư mục `release/`:
   - `release/Tay-Tube-PC-Setup-1.1.0.exe` (bộ cài đặt NSIS)
   - `release/Tay-Tube-PC-1.1.0-Portable.exe` (bản chạy ngay không cần cài đặt)

---

## 🙏 Ghi nhận & Tri ân (Credits)

- **[MeeTube / SmartTube](https://github.com/yuliskov/SmartTube):** Tham khảo cơ chế xác thực Google Device OAuth2, trích xuất thông số TV client động và gọi các endpoint InnerTube (`FEhistory`, `VLWL`, `FEsubscriptions`, đồng bộ tiến độ xem).
- **[YTXTube](https://github.com/Koustubh12345/YTXTube/):** Dự án nền tảng ban đầu truyền cảm hứng cho kiến trúc trích xuất luồng phát và tối ưu trải nghiệm xem video YouTube.
