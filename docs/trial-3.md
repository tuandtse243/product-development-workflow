# Trial 3: kiểm S7–S10 trong Claude Code thật

Mục tiêu: một lượt kiểm cho mọi thứ còn lại của mốc B. Có hai project:

- **3A, greenfield**: một app có UI và route server. Kiểm tầng review (S7), chạy song song (S8) và `aidw run` (S9).
- **3B, brownfield**: bản sao của `evals/fixtures/brownfield-app`. Kiểm detect, assessment và baseline spec (S10).

Có thể làm 3B trước, vì 3B ngắn hơn.

| # | Điều cần kiểm | Slice | Cách biết |
|---|---|---|---|
| 17 | `quality.yaml` có `ui-ux` (review: ui), `a11y`, `security` (review: security), `performance` | S7 | Đọc trước khi `/aidw:approve` |
| 18 | Verify dừng ở `REVIEW`, orchestrator spawn `aidw:ui-reviewer` / `aidw:security-reviewer` rồi `aidw layer-review` | S7 | Transcript; `evidence/quality/summary.json` có `review` |
| 19 | ui-reviewer mở **mọi** ảnh và bắt lỗi kiểu trial-2 (tràn ở 390px, theme nháy) | S7 | Reply của reviewer, `.aidw/run/layer-review-ui-ux.md` |
| 20 | Lighthouse gắn được Chrome CDP cổng 9222 từ trong sandbox | S7 | Tầng `performance` pass hoặc lỗi rõ ràng |
| 21 | `aidw next` trả `wave`, implementer chạy song song, mỗi cái trong worktree của mình | S8 | Transcript (nhiều Agent trong một message); `git log --graph` |
| 22 | Build và test chạy được trong worktree (node_modules ở thư mục cha) | S8 | Checkpoint của task trong wave pass |
| 23 | `aidw integrate` sau mỗi wave | S8 | `evidence/integration.json` |
| 24 | `aidw run` chạy tiếp sau khi dừng giữa chừng và dừng đúng lúc | S9 | `.aidw/run/runner.log` |
| 25 | `aidw init` nhận ra brownfield, stack đúng | S10 | `.aidw/project.yaml` |
| 26 | Assessment: `## Existing system`, health baseline, conventions vào constitution | S10 | `analysis.md`, `constitution.md` |
| 27 | Baseline spec cho capability `todos` trước khi sửa, delta là MODIFIED | S10 | `.aidw/specs/todos/spec.md`, `aidw approval check` |
| 28 | Code mới theo conventions có sẵn, không migrate stack | S10 | Diff |
| 30 | `aidw analyze` cảnh báo kế hoạch một chuỗi; một change có wave thật (commit `(worktree)`) | thông lượng | `aidw analyze`, `git log --graph` |
| 31 | `aidw cost` so với mốc trial-3b (319 lượt, 103.7M cache-read ở session chính, 46 subagent) | token | `aidw cost` |
| 29 | Token (D-32): `aidw run` mỗi task một session (`END THIS SESSION`), reviewer ghi verdict vào file, task `C*` chỉ-test tự pass review | tối ưu | `runner.log`, tổng token trong transcript (so với mốc đã đo của trial-3b (xem #31)) |

## 0. Chuẩn bị

```bash
cd ~/Desktop/Learning/product-development-workflow && npm test     # bin mới, 148 test pass
alias aidwc='AIDW_HOOK_LOG=$HOME/$(basename "$PWD")-hooks.jsonl claude --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw'
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.aidw-chrome" --no-first-run about:blank &
vercel whoami        # làm mới token ngoài sandbox (lỗi trial-2)
```

## 3A. Greenfield: S7, S8, S9

```bash
mkdir -p ~/Desktop/Learning/aidw-trial-3 && cd ~/Desktop/Learning/aidw-trial-3
git init && git commit --allow-empty -m "init"
aidwc
```

Trong Claude Code, chạy lần lượt:

1. `/aidw:init`
2. `/aidw:start` với đề bài sau. Đề bài có nhiều lát độc lập để tạo wave, có UI, và có route server để security-reviewer có việc làm:

   > Ứng dụng ghi chi tiêu cá nhân (tiếng Việt). Có ba màn: (1) danh sách chi tiêu theo tháng, thêm, sửa, xóa,
   > lọc theo danh mục; (2) quản lý danh mục, gồm tên, màu và icon; (3) báo cáo tháng, có biểu đồ tròn theo danh
   > mục và tổng theo tuần. Dữ liệu lưu qua API route của Next.js vào file JSON phía server, không cần đăng
   > nhập. Có export CSV. Giao diện sáng và tối, dùng tốt trên điện thoại. Deploy Vercel preview.

3. Trước khi approve, kiểm:
   - `quality.yaml` có đủ 8 tầng, kèm `parallel: { max: 3 }`;
   - `tasks.yaml` có các task với `touches` không chồng nhau (danh mục, báo cáo, CSV).
4. `/aidw:approve`, rồi `/aidw:run`.
5. **Kiểm S9 giữa chừng.** Khi đã có 2–3 task done:
   1. Thoát Claude Code (`/exit`).
   2. Đặt change về paused như hook StopFailure sẽ làm, để giả lập hết quota. Lệnh đầu tiên lấy `<id>`:

      ```bash
      aidw status
      aidw transition <id> paused --reason "rate_limit: retry after 60 seconds"
      ```

   3. Chạy runner, vẫn trong thư mục project:

      ```bash
      ~/Desktop/Learning/product-development-workflow/plugins/aidw/bin/aidw run <id> \
        --permission-mode auto -- --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw
      ```

   4. Kỳ vọng:
      - runner chờ khoảng 2 phút rồi chạy `claude -p "/aidw:resume <id>"`;
      - runner chạy tiếp tới khi archive, hoặc dừng ở escalation. Ví dụ: tier 3 không trả lời được khi chạy headless, hay deploy cần `vercel whoami`.
   5. Nếu runner dừng: đọc `.aidw/run/runner.log`, xử lý, rồi chạy lại runner hoặc dùng `aidwc` + `/aidw:resume`.

Lệnh kiểm sau khi chạy:

```bash
git log --graph --oneline | head -30          # merge commit "Txx: ..." + nhánh "Txx (worktree): ..."
cat .aidw/changes/*/evidence/integration.json | head -40
cat .aidw/changes/*/evidence/quality/summary.json | grep -n '"review"\|"status"'
ls .aidw/run/briefs/*/ | grep layer-review
```

## 3B. Brownfield: S10

```bash
cp -R ~/Desktop/Learning/product-development-workflow/evals/fixtures/brownfield-app ~/Desktop/Learning/aidw-trial-3b
cd ~/Desktop/Learning/aidw-trial-3b
git init && git add -A && git commit -m "existing app"   # trước khi cài: fixture có .gitignore sẵn
rm pnpm-lock.yaml && pnpm install --reporter=append-only   # fixture không có lockfile thật; đừng bấm Ctrl+C khi tải chậm
git add -A && git commit -m "lockfile" && git status --short   # phải sạch (node_modules đã bị ignore)
aidwc
```

Trong Claude Code, chạy lần lượt:

1. `/aidw:init`: kỳ vọng in `brownfield` và stack Next.js 15, Vitest, Playwright, Vercel.
2. `/aidw:start Thêm hạn chót (due date) cho todo; todo quá hạn hiển thị màu đỏ; API nhận dueDate tuỳ chọn.`
   Trước khi approve, kiểm:
   - có bước assessment trước grilling, và `## Existing system` nêu health baseline (`pnpm lint`, `pnpm typecheck`, `pnpm test`);
   - có `.aidw/specs/todos/spec.md` mô tả hành vi **hiện tại** (thêm todo, toggle), và delta dùng `## MODIFIED Requirements`;
   - `aidw approval check <id> --json` có liệt kê `.aidw/specs/todos/spec.md`;
   - stack vẫn là `Source: client`, không đổi package manager.
3. `/aidw:approve`, rồi `/aidw:run`. Kiểm:
   - code mới theo đúng style của `lib/todos.ts` (zod, hàm thuần);
   - test cũ vẫn pass.

## Ghi kết quả

Ghi theo bảng ở đầu tài liệu: đạt, đạt một phần hay fail, kèm bằng chứng. Gửi lại cho Claude:

- đường dẫn hai project;
- file log hook: `~/aidw-trial-3-hooks.jsonl`, `~/aidw-trial-3b-hooks.jsonl`.

Lỗi sẽ được vá một lượt, như trial-2 (§29).
