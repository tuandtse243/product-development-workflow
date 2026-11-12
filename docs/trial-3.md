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
| 29 | Token: `aidw run` mỗi task một session (`END THIS SESSION`), reviewer ghi verdict vào file, task `C*` chỉ-test tự pass review | tối ưu | `runner.log`, tổng token trong transcript (so với mốc đã đo của trial-3b (xem #31)) |

## Kiểm đợt 1 của roadmap (làm cùng 3A)

Đợt 1 thêm các tính năng sau; chúng chưa từng chạy trong Claude Code thật. Kiểm khi đi qua 3A, không cần lượt riêng.
Cột "Kết quả" để trống cho tới khi chạy.

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 32 | Change branch: khởi động từ `main` sạch; sau `aidw transition <id> executing` (do `/aidw:run`), HEAD ở `aidw/<id>`, in dòng "task commits go to the new branch" | `git branch --show-current`; `git log main --oneline` không có commit `Txx:` | |
| 33 | Task branch của wave tên `aidw/<id>.Txx`, biến mất sau merge; branch `aidw/<id>` còn lại | `git branch --list 'aidw/*'` giữa wave và sau wave | |
| 34 | `aidw/<id>` giữ đúng khi `/aidw:resume` hoặc `aidw run` chạy lại từ `main` (switch về branch) | `git switch main` rồi resume; `git branch --show-current` | |
| 35 | Mở session mới khi HEAD ở `main` còn branch change chưa merge: có dòng "unmerged change branch" | Output đầu session / `AIDW_HOOK_LOG` | |
| 36 | Gate MCP: trước approve, tool MCP có tên ghi (create/update/deploy...) bị deny; sau approve thì hỏi; implementer subagent bị deny; tool tên đọc (list/get/search) đi qua. Thử bằng một tool vô hại | `grep mcp__ ~/aidw-trial-3-hooks.jsonl`; transcript | |
| 37 | Scaffold code-style (T01): có `.husky/pre-commit`, `.prettierrc`, `.prettierignore`, script `format` / `format:check` / `prepare`, `lint-staged` trong package.json | `ls -a`, đọc `package.json` | |
| 38 | `quality.yaml` layer `code` có `pnpm format:check`, và nó pass | `quality.yaml`; `evidence/quality/summary.json` | |
| 39 | Commit của aidw đi qua hook husky không lỗi; prettier có sửa file staged thì commit vẫn thành | `git log`; không có `refusing`/hook fail trong transcript | |
| 40 | Trong worktree hook không chạy, nhưng implementer đã chạy formatter: `format:check` vẫn pass sau wave | Checkpoint và `aidw integrate` pass; `integration.json` | |
| 41 | Ghi chú implementer: file `.aidw/run/report-<T>.md` chỉ có khi cần (đa số task không có); review brief có dòng "Implementer notes" khi file tồn tại | `ls .aidw/run/report-*.md`; `ls .aidw/run/briefs/*/` rồi đọc brief review | |
| 42 | `maxTurns: 100` không cắt ngang implementer nào | Không có task nào "đột ngột dừng"; `aidw cost` ghi số lượt mỗi subagent | |
| 43 | `codebase-design`: `start` đọc nó ở bước Architecture; task tạo module mới có `skills: [pocock/codebase-design]` và brief của nó liệt kê skill | `tasks.yaml`; brief implement | |
| 44 | `allowed-tools: Bash(aidw *)`: `/aidw:run` ở chế độ default không hỏi quyền cho từng lệnh `aidw` (số lần bị hỏi thấp) | Đếm hộp thoại quyền trong phiên | |
| 45 | Sau `/compact` (hoặc auto-compact) giữa lúc run: session in "context was compacted" kèm change và bước tiếp theo, và orchestrator tiếp tục đúng | Transcript sau `/compact`; `AIDW_HOOK_LOG` có `source: compact` | |
| 46 | Verify flaky: nếu gặp, evidence có `"flaky": true` (cơ hội, không cố tạo) | `grep -r '"flaky"' .aidw/changes/*/evidence` | |

Đo token: ghi `aidw cost` của 3A và so với mốc trial-3b (#31). Đợt 1 thêm ít token (một dòng trong brief, một skill chỉ nạp
cho task tạo module), nên mức tăng đáng kể là dấu hiệu bất thường.

## Trial-3C: kiểm các sửa sau 3A và batch 2

Chạy một change **nhỏ** trên project mới (hoặc `aidw-trial-3` sau `git switch master`): brief gợi ý "app ghi chú một
trang: thêm, xoá, tìm ghi chú; có nút Xuất JSON". Cài plugin bằng marketplace, bật `aidwc` như cũ, và cho phép
`vercel.com`, `*.vercel.com` trong sandbox trước. Cột "Kết quả" để trống cho tới khi chạy.

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 47 | `aidw doctor` chạy ở `start` (§8) và `run` (§0): in ok/WARN/FAIL cho pnpm, store, registry, CDP, vercel | transcript; `aidw doctor --json` | |
| 48 | `vercel link --yes` chạy trước task đầu; lần deploy đầu **không** đòi `--prod` | transcript; `.vercel/project.json`; `deploy.json` | |
| 49 | Mọi task trong `tasks.yaml` có `type`; thiếu thì `aidw analyze` báo lỗi | `tasks.yaml`; thử xoá một `type` rồi `aidw analyze` | |
| 50 | Commit của task dạng `type(capability): title` kèm footer `Change:`, `Task:`, `Evidence:`; không có `T01:` hay `(worktree)` | `git log --format=%B -n 5` | |
| 51 | Scaffold có `commitlint.config.js`, `.husky/commit-msg`; commit tay sai chuẩn bị từ chối | `ls -a`; `git commit --allow-empty -m "bad"` | |
| 52 | `.github/workflows/ci.yml` có, mirror các lệnh `code`/`unit`/`integration` của `quality.yaml` | đọc file | |
| 53 | `.gitignore` có `.pnpm-store/`, `.vitest/` ngay từ T01 | `cat .gitignore` | |
| 54 | Worktree của wave có symlink `node_modules`; checkpoint không lỗi "command not found"; `git status` không thấy nó | `ls -la .aidw/run/worktrees/*/*/node_modules` giữa wave | |
| 55 | Playwright config có reporter JUnit; layer e2e/a11y ghi `test-results/*.xml`; quality report không còn "declared report(s) missing" | `playwright.config.ts`; `delivery/quality-report.md` | |
| 56 | Scenario có WHEN là thao tác UI ("bấm Xuất JSON") có task chạm file UI sở hữu nó; `aidw analyze` không cảnh báo "triggered from the UI" | `aidw analyze` | |
| 57 | `Size: small` ở Summary; `analyze` giới hạn 3 task, cảnh báo layer thừa và deploy | `analysis.md`; thử thêm task thứ 4 | |
| 58 | Task `type: fix`: brief có dòng "regression test ... FAIL on the current code" | đọc brief implement | |
| 59 | Sửa `tasks.yaml` sau approve (đổi title một task done) rồi duyệt lại: task đó chạy lại, task khác giữ `done` | output `aidw approve`: "done work kept" / "edited tasks run again" | |
| 60 | `aidw task reopen T02 --revert`: có commit `revert(...)`, task về pending, kết quả quality bị xoá | `git log`; `tasks.yaml`; `evidence/quality/summary.json` | |
| 61 | Handoff có `## Merge danger`; `aidw pr` in tiêu đề, summary, evidence, merge danger (migration, env, dependency) | `delivery/handoff.md`; output `aidw pr` | |
| 62 | `aidw pr --create` luôn hiện hộp thoại hỏi quyền; không tự chạy | transcript (cần remote và `gh`; không có thì bỏ qua) | |
| 63 | Reviewer dialog: nhận xét về focus trap / Escape / tên truy cập nếu dialog thiếu; handoff liệt kê hết nhận xét non-blocking | `quality-report.md`; `handoff.md` | |
| 64 | Không còn implementer treo chờ tiến trình nền quá 5 phút | thời gian từng task (`aidw cost`) | |

Đo token cho các sửa tối ưu (so với mốc trial-3A: orchestrator 57%, implementer 33%, lượt đầu implementer 37K token):

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 65 | Lượt đầu của implementer giảm rõ (kỳ vọng dưới 15K) nhờ `tools:` allowlist | `aidw cost`, dòng "first turn" của implementer | |
| 66 | `aidw run` không nạp MCP server (`--strict-mcp-config` trong `runner.log`); orchestrator lượt đầu nhỏ hơn | `.aidw/run/runner.log`; `aidw cost` | |
| 67 | UI reviewer vòng 2+ chỉ mở ảnh đổi ("other artifact(s) did not change"); không còn ảnh trùng từ per-task shots | brief `ui-ux.layer-review.md` | |
| 68 | Task fix của layer có reviewer (ui, security) được "auto-passed", không có reviewer subagent | output checkpoint; `aidw cost` số reviewer | |
| 69 | `aidw cost` in "by role" và dòng "parallel waves: ... % faster" | output | |

## 0. Chuẩn bị

```bash
cd ~/Desktop/Learning/product-development-workflow && npm test     # bin mới, 207 test pass (chạy ngoài sandbox của Claude Code)
alias aidwc='AIDW_HOOK_LOG=$HOME/$(basename "$PWD")-hooks.jsonl claude --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw'
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.aidw-chrome" --no-first-run about:blank &
vercel whoami        # làm mới token ngoài sandbox (lỗi trial-2)

# Monorepo: cảnh báo phải hiện (kiểm nhanh, không cần project thật)
mkdir -p $TMPDIR/mono && cd $TMPDIR/mono && echo '{}' > package.json && touch pnpm-workspace.yaml && ~/Desktop/Learning/product-development-workflow/plugins/aidw/bin/aidw detect | grep -i monorepo
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
