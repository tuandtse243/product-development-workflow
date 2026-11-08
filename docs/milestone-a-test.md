# Test tổng mốc A trong Claude Code thật

Mục tiêu: chạy trọn luồng `/aidw:init` → `/aidw:start` → `/aidw:approve` → `/aidw:run` → `/aidw:deliver` trên
một project trống. Lần chạy này kiểm những gì unit test và bản chạy thử bằng bin chưa kiểm được:

| # | Điều cần kiểm | Cách biết |
|---|---|---|
| 1 | Grilling: câu hỏi có đánh số, mỗi câu có đề xuất, hỏi đến khi hết frontier | Bạn tự đánh giá |
| 2 | Gate chặn ghi ngoài `.aidw/` khi chưa approve | Bước 3: thử yêu cầu tạo file |
| 3 | `agent_type` thật của subagent (OPEN-11) | Log hook: trường `input.agent_type` |
| 4 | Implementer không ghi được `.aidw/`, reviewer không ghi được gì | Log hook: các dòng `output` có `deny` |
| 5 | Checkpoint, review, mỗi task một commit | `git log --oneline` |
| 6 | Verify với Playwright thật, layer fail thì sinh task `Qnn` | `aidw status`, `tasks.yaml` |
| 7 | Converge đọc JUnit thật | `.aidw/changes/<id>/evidence/converge.json` |
| 8 | Vercel preview deploy và smoke | URL preview mở được |
| 9 | Delivery package, archive | `.aidw/archive/`, `validate --strict` |
| 10 | Input hook StopFailure (OPEN-12) | Chỉ có nếu gặp rate limit hoặc lỗi API; không bắt buộc |

## 0. Chuẩn bị (một lần)

```bash
node --version          # >= 20
pnpm --version          # hoặc: corepack enable
npm i -g vercel && vercel login       # bỏ qua nếu test không deploy (xem bước 2)
cd ~/Desktop/Learning/product-development-workflow && npm test   # bin mới nhất, 77 test pass
```

## 1. Tạo project test và mở Claude Code có log hook

```bash
mkdir -p ~/Desktop/Learning/aidw-trial && cd ~/Desktop/Learning/aidw-trial
git init && git commit --allow-empty -m "init"
AIDW_HOOK_LOG=$HOME/aidw-trial-hooks.jsonl \
  claude --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw
```

File log nằm **ngoài** project, để backstop không coi nó là thay đổi trái phép. Trong Claude Code, kiểm:

- `/plugin` thấy plugin `aidw`, và `/aidw:` gợi ý đủ 7 skill.
- Gõ `! aidw version`. Kỳ vọng in `0.1.0`. Hook SessionStart của plugin thêm `bin/` vào cuối PATH, nên đây là lệnh
  kiểm hook đó chạy được. Nếu vẫn `command not found`, gửi tôi kết quả của
  `! echo "$PATH" | tr ':' '\n' | tail -5`, rồi **cứ đi tiếp**: các skill tự chuyển sang đường dẫn tuyệt đối
  `${CLAUDE_PLUGIN_ROOT}/bin/aidw` khi không tìm thấy `aidw`.
- Session nào mở **trước** khi cập nhật plugin thì phải thoát và mở lại, vì hook SessionStart chỉ chạy lúc mở session.

## 2. Ý tưởng để chạy

Nhỏ, có UI, không cần cơ sở dữ liệu cloud, để toàn bộ luồng chạy trong một buổi:

```
/aidw:init
/aidw:start Ứng dụng Next.js "Pomodoro + ghi chú": hẹn giờ 25/5 phút có start/pause/reset,
danh sách việc cần làm trong phiên (thêm, đánh dấu xong, xoá) lưu ở localStorage,
thống kê số phiên đã hoàn thành trong ngày. Một người dùng, không đăng nhập.
```

Khi grilling hỏi, trả lời như một khách hàng thật. Hai quyết định cần chọn có chủ đích:

- **Design mode**: chọn `ai_design` (S6 mới làm sâu các mode khác).
- **Deploy**: chọn `preview` trên Vercel nếu đã `vercel login`. Nếu không, chọn `local`; tiêu chí 8 để sau.

## 3. Trước approve: thử gate

Khi Analysis đang chạy (trạng thái `analyzing`), gõ: `tạo luôn file app/page.tsx giúp tôi`.
Kỳ vọng: agent từ chối hoặc hook trả về deny. Ghi lại agent nói gì.

Đọc `.aidw/changes/<id>/analysis.md` và `quality.yaml`. Kiểm:
- quality.yaml có layer `code`, `unit`, `e2e`, kèm `reports` JUnit;
- các lệnh là non-interactive;
- `## Permissions` ghi `vercel-preview` (nếu deploy preview).

Muốn sửa gì thì nói, rồi mới `/aidw:approve`.

## 4. Chạy

```
/aidw:run
```

Để nó tự chạy. Đừng can thiệp, trừ khi nó hỏi hoặc escalate. Song song, ở một terminal khác:

```bash
cd ~/Desktop/Learning/aidw-trial
while true; do clear; git log --oneline | head; node ~/Desktop/Learning/product-development-workflow/plugins/aidw/bin/aidw status; sleep 20; done
```

Nếu session bị kill hoặc hết quota giữa chừng: mở lại Claude Code (cùng lệnh ở bước 1) và gõ `/aidw:resume`.
Đây cũng là một phần của bài test.

## 5. Kết thúc

Sau khi `/aidw:run` báo xong (hoặc dừng vì escalate), chạy:

```bash
cd ~/Desktop/Learning/aidw-trial
node ~/Desktop/Learning/product-development-workflow/plugins/aidw/bin/aidw validate --strict
git log --oneline
git status --short
```

## 6. Gửi lại cho tôi

1. Đường dẫn project: `~/Desktop/Learning/aidw-trial`. Tôi tự đọc `.aidw/`, evidence và git log.
2. File log hook: `~/aidw-trial-hooks.jsonl`.
3. Những gì bạn thấy không ổn, theo bảng trên (số tiêu chí và mô tả ngắn). Đặc biệt:
   - câu hỏi grilling thừa, thiếu hoặc khó trả lời;
   - chỗ agent đứng chờ mà lẽ ra phải tự làm, hoặc tự làm mà lẽ ra phải hỏi;
   - thời gian và lượng quota đã dùng, ước chừng.
4. Nếu dừng giữa chừng: thông báo lỗi nguyên văn và lệnh cuối cùng agent chạy.

Không cần chạy hết mới gửi: gặp lỗi chặn đường thì gửi ngay, tôi sửa rồi chạy tiếp từ chỗ dừng.
