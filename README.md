# ShortTool Discord Bot

Bản Discord của web kiếm tiền: tạo key ngẫu nhiên → gắn vào trang MMO → rút gọn qua các nhà cung cấp → lưu lịch sử, backup mã hoá lên GitHub.

## Lệnh

| Lệnh | Chức năng |
|---|---|
| `/getlink [provider] [cong_khai]` | Tạo link mới (mặc định chỉ mình bạn thấy) |
| `/history [so_luong]` | Xem lịch sử link |
| `/stats` | Thống kê cá nhân |
| `/providers` | Nhà cung cấp đang bật |
| `/settings [luu_lich_su] [max_lich_su]` | Cài đặt cá nhân |
| `/clearhistory` | Xoá lịch sử |
| `/admin stats` / `/admin backup` | Quản trị (ID nằm trong `ADMIN_IDS`) |

Không còn đăng nhập/đăng ký: mỗi người dùng được nhận diện bằng Discord ID.

## Cài đặt

1. Vào https://discord.com/developers/applications → **New Application** → tab **Bot** → **Reset Token** → copy vào `DISCORD_TOKEN`.
   Copy **Application ID** (tab General Information) vào `DISCORD_CLIENT_ID`.
2. Mời bot vào server: tab **OAuth2 → URL Generator**, tick scope `bot` + `applications.commands`, mở link tạo ra.
   (Bot không cần bật Privileged Intent nào.)
3. `cp .env.example .env` rồi điền:
   - `DISCORD_GUILD_ID` = ID server của bạn (lệnh hiện ngay; để trống thì lệnh global, chờ tới ~1 giờ)
   - `ADMIN_IDS` = ID Discord của bạn (bật Developer Mode → chuột phải tên mình → Copy User ID)
   - Token các provider bạn dùng (provider nào thiếu token sẽ tự ẩn)
   - `GITHUB_TOKEN`, `GITHUB_REPO`, `BACKUP_SECRET` nếu muốn backup
4. Chạy:
   ```bash
   npm install
   npm start
   ```

Bot cần chạy liên tục (VPS, Railway, Render worker, máy nhà...). Không chạy được trên hosting serverless/static.

## Lưu ý

- Muốn chỉ mình/nhóm bạn dùng: điền `ALLOWED_USER_IDS`. Để trống thì ai trong server cũng dùng được và tốn quota API của bạn (đã có cooldown `COOLDOWN_SECONDS`).
- Backup dùng lại format cũ (AES-256-GCM, cùng `BACKUP_SECRET`). Nếu trỏ vào repo backup cũ, bot chỉ nạp user Discord và bỏ qua tài khoản web cũ; dữ liệu cũ không bị xoá.
- Mỗi lần backup là ~20 request GitHub (10 file mirror). Nếu bot đông người, giảm `BACKUP_MIRRORS` (ví dụ 3) để tránh chạm giới hạn 5000 request/giờ.
