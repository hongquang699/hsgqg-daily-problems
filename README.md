# HSGQG Local Judge 2.0 — GitHub daily sync

Mini Online Judge **local** trên Windows, tự kiểm tra bài mới từ một GitHub repository công khai lúc **19:00 giờ Việt Nam**, và kiểm tra bù khi khởi động. Có nộp C++17 và chấm qua Docker.

## 1. Cài đặt

- Cài **Node.js 18+** và **Docker Desktop** (bật Docker Desktop).
- Mở PowerShell trong thư mục giải nén.
- Chạy `docker pull gcc:14` (lần đầu cần Internet).
- Chạy `Copy-Item sync.config.example.json sync.config.json`.
- Kiểm tra `sync.config.json` trỏ tới `hongquang699/hsgqg-daily-problems`, nhánh `master` (xem mục 2).
- Chạy `node server.js`.
- Mở http://localhost:3000.

Không cần `npm install`; chương trình dùng Node.js built-in modules.

## 2. Nguồn GitHub

Repository này đã chứa `manifest.json` và `days/2026-10-11/` ở gốc nhánh `master`. Thư mục `github-template/` chỉ là bản mẫu; Local Judge không tải từ thư mục đó.

1. Kiểm tra `sync.config.json`:

```json
{"owner":"hongquang699","repo":"hsgqg-daily-problems","branch":"master"}
```

2. Kiểm tra ngay: `node sync/github-sync.js --force`.
3. Chạy `node server.js`, xem thông báo đồng bộ trên đầu trang. Xem chi tiết ở http://localhost:3000/api/sync-status.

**Quan trọng:** ChatGPT gửi đề hằng ngày **không tự push** vào GitHub. Bạn hoặc một workflow CI đã cấu hình phải publish đề và test lên repository. Bộ mã nguồn này đảm nhận việc **tự tải** từ GitHub về Local Judge, không tự sáng tác hoặc xuất bản bài mới.

## 3. Xuất bản bài mới hằng ngày

Ví dụ ngày `2026-10-12`:

1. Tạo `days/2026-10-12/contest.json` và `days/2026-10-12/tests.json`, theo cấu trúc mẫu của ngày 11.
2. `contest.json` có `title`, `durationMinutes`, mảng `problems`; mỗi problem có `id`, `title`, `statement`, `input`, `output`, `constraints`, `sampleInput`, `sampleOutput`, `hint`, `timeLimitMs`, `memoryLimitMb`, `subtasks` (tổng điểm 100).
3. `tests.json` là object, key là `problem.id`, value là danh sách `{ "input":"...", "output":"...", "subtask":1 }`. Mỗi subtask phải có ít nhất một test.
4. Tính SHA256 cho **bytes** của từng file. `.gitattributes` giữ các file trong `days/` ở định dạng xuống dòng LF trên Windows để hash local khớp với raw GitHub:

```powershell
(Get-FileHash days/2026-10-12/contest.json -Algorithm SHA256).Hash.ToLower()
(Get-FileHash days/2026-10-12/tests.json -Algorithm SHA256).Hash.ToLower()
```

5. Thêm release vào `manifest.json` (không xóa ngày cũ):

```json
{
  "date": "2026-10-12",
  "contest": "days/2026-10-12/contest.json",
  "tests": "days/2026-10-12/tests.json",
  "contestSha256": "64_HEX_CHARS",
  "testsSha256": "64_HEX_CHARS"
}
```

6. Commit/push lên GitHub trước 19:00. Máy local đang chạy sẽ kiểm tra lúc 19:00; nếu cập nhật muộn, chạy `node sync/github-sync.js --force` hoặc khởi động lại server.

**Ngày phát hành:** Sync chọn release có ngày mới nhất **không vượt quá ngày hiện tại tại Việt Nam**. Không có bài mới thì giữ contest đang có.

## 4. Vận hành

- Chạy thủ công: `node sync/github-sync.js --force`.
- Kiểm tra trạng thái: `http://localhost:3000/api/sync-status` hoặc `sync/status.json`.
- Bài đã tải lưu trong `problems/versions/`, `problems/active.json` trỏ đến phiên bản đang dùng.
- Khung soạn C++ có tô màu cú pháp, số dòng, mở/tải tệp `.cpp` và tự lưu mã đang viết trong trình duyệt. Dùng Tab để thụt lề, Ctrl+S để tải mã và Ctrl+Enter để nộp bài.
- Không có mạng vẫn sử dụng được bài đã tải và chấm Docker offline nếu image `gcc:14` đã có.
- Nếu máy tắt lúc 19:00, lần khởi động tiếp theo sẽ kiểm tra bù.
- Nếu chạy server liên tục, lịch 19:00 hoạt động theo múi giờ `Asia/Ho_Chi_Minh`.
- Có thể chạy `node server.js` bằng Windows Task Scheduler khi đăng nhập để tự khởi động.

## 5. Giới hạn và bảo mật

- Chỉ lắng nghe `127.0.0.1`; không công khai ra Internet.
- Chỉ tải từ `raw.githubusercontent.com` bằng HTTPS, kiểm SHA256 theo manifest và kiểm tra cấu trúc JSON trước khi kích hoạt.
- **SHA256 chỉ phát hiện thay đổi so với manifest; không chứng thực tác giả**. Bảo vệ tài khoản GitHub, branch và quyền ghi repository.
- Đề và đáp án trong **public repository có thể bị xem trực tiếp**. Vì vậy phù hợp cho **tự luyện**, KHÔNG dùng làm kỳ thi chống gian lận. Muốn giấu test cần nguồn private có xác thực, backend riêng và quản lý quyền.
- Test mẫu trong package chưa đủ chấm chuẩn HSGQG; bổ sung bộ test chất lượng trước khi tin điểm.
- Docker sandbox không phải ranh giới bảo mật tuyệt đối cho code độc hại; không triển khai Judge này cho người lạ trên máy chứa dữ liệu nhạy cảm.
- TLE đo thời gian wall-clock bao gồm overhead Docker, chỉ tham khảo; history bài nộp chỉ lưu RAM.
- Mỗi subtask được điểm khi toàn bộ test trong subtask AC. Mã nguồn giới hạn 100 KB, tối đa 2 bài đang chấm.
