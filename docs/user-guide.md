# aidw: hướng dẫn sử dụng

aidw là một plugin cho Claude Code. Bạn mô tả cần làm gì, trả lời một vòng câu hỏi, **đọc và duyệt một văn bản
phân tích**, rồi aidw tự làm phần còn lại: viết code, kiểm thử, deploy preview và bàn giao.

Tài liệu này dành cho người mới. Kế hoạch kiểm thử thực tế nằm ở [`trial-3.md`](trial-3.md).

## 1. Hiểu nhanh trong một phút

- Bạn **chỉ quyết định ở một chỗ**: duyệt `analysis.md` (lệnh `/aidw:approve`). Trước đó, code bị khóa. Sau đó,
  mọi thứ chạy tự động.
- Mọi trạng thái nằm trong thư mục `.aidw/` của project và trong git. Session Claude Code bị đóng giữa chừng
  không làm mất gì.
- Mỗi task do một **subagent mới** làm, rồi một **subagent khác** review. Mỗi task được một commit.
- `aidw` (CLI) giữ luật và trạng thái. Claude chỉ điều phối. Claude không tự sửa state, không tự duyệt.

## 2. Cài đặt

Yêu cầu: Claude Code, Node.js 20 trở lên, git. Project nên là một git repo.

Chạy thử trực tiếp từ thư mục plugin, không cần cài:

```bash
claude --plugin-dir /đường/dẫn/product-development-workflow/plugins/aidw
```

Hoặc cài như một marketplace (repo này có `.claude-plugin/marketplace.json`):

```
/plugin marketplace add /đường/dẫn/product-development-workflow
/plugin install aidw@aidw
```

Để dùng `aidw` trong terminal của chính bạn (không chỉ trong Claude Code), liên kết nó vào PATH:

```bash
ln -sf /đường/dẫn/product-development-workflow/plugins/aidw/bin/aidw ~/.local/bin/aidw
```

Nên cài bằng marketplace cho các lần chạy dài: một plugin nạp bằng `--plugin-dir` có thể biến mất khi session được nạp lại giữa chừng (trial-3A).

Gợi ý: đặt alias một dòng trong `~/.zshrc`, kèm file log hook để debug:

```bash
alias aidwc='AIDW_HOOK_LOG=$HOME/$(basename "$PWD")-hooks.jsonl claude --plugin-dir $HOME/Desktop/Learning/product-development-workflow/plugins/aidw'
```

## 3. Các lệnh bạn dùng

Bạn chỉ gõ các lệnh `/aidw:...` trong Claude Code. CLI `aidw` do Claude gọi, bạn hiếm khi gõ trực tiếp.

| Lệnh | Khi nào | Việc nó làm |
|---|---|---|
| `/aidw:init` | một lần mỗi project | tạo `.aidw/`. Tự nhận ra project có sẵn (brownfield) và ghi stack, package manager |
| `/aidw:start <ý tưởng, PRD hoặc đường dẫn file>` | mỗi change mới | hỏi bạn, phân tích, viết spec, chia task. Dừng trước cổng duyệt |
| `/aidw:approve` | sau khi bạn đọc xong | **cổng duy nhất**: bạn bấm Yes. Hash và đóng băng gói phân tích |
| `/aidw:run` | sau approve | chạy tự động các task, kiểm tra chất lượng, deploy preview, bàn giao |
| `/aidw:resume` | sau khi bị ngắt | tiếp tục từ chỗ dừng. Đã dừng vì escalation thì xử lý xong rồi mới resume |
| `/aidw:status` | bất cứ lúc nào | trạng thái, drift, task nào xong, việc cần bạn |
| `/aidw:deliver` | `run` tự gọi ở cuối | tạo gói bàn giao (README, handoff, báo cáo chất lượng) và archive |

Các lệnh CLI hữu ích khi bạn tự gõ `aidw` (xem mục 2 để đưa nó vào PATH):

| Lệnh | Việc nó làm |
|---|---|
| `aidw doctor [<id>]` | kiểm máy trước khi chạy: binary của các lệnh chất lượng, pnpm store, registry, Chrome CDP, đăng nhập và liên kết Vercel. Thoát mã 1 nếu có FAIL |
| `aidw task reopen <T> [--revert]` | task đã xong nhưng sai: về pending; `--revert` hoàn tác commit của nó (chỉ code, `.aidw/` giữ nguyên) |
| `aidw pr [<id>] [--create]` | sau bàn giao: in nội dung PR; `--create` push nhánh và mở PR bằng `gh` (luôn hỏi bạn trước) |

**Change nhỏ.** `start` đề xuất `Size: small` cho bugfix hoặc chỉnh một hành vi; bạn xác nhận ở cổng duyệt. Nhỏ nghĩa là tối đa
3 task, chỉ lớp `code` + `unit` (+ `e2e` nếu có UI), không deploy nếu bạn không yêu cầu, và bugfix phải có test tái hiện lỗi
chạy fail trước khi sửa.

**Sửa kế hoạch sau khi đã duyệt.** `escalated` → `analyzing` → sửa → duyệt lại. Task đã `done` mà không bị sửa thì được giữ nguyên
cùng bằng chứng; task bị sửa hoặc mới sẽ chạy lại (output `aidw approve` liệt kê hai nhóm).

**Commit.** Mọi commit theo Conventional Commits (`docs/commit-guide.md`). aidw tự dựng message `type(capability): title` từ trường
`type` của task.

**Stack pack.** Công cụ theo ngôn ngữ nằm ở `plugins/aidw/profiles/stacks/<ngôn ngữ>.md` (hiện có `node.md`); thêm ngôn ngữ mới là thêm một file.

## 4. Đường đi của một change

Sơ đồ: mở [`diagrams/lifecycle.html`](diagrams/lifecycle.html) trong trình duyệt để xem (có chế độ sáng/tối, zoom).

1. **Analyzing.** `/aidw:start` đọc code (nếu có), hỏi bạn từng vòng câu hỏi, rồi viết: `analysis.md` (tóm tắt,
   stack, thiết kế, quyền cần dùng), spec theo từng scenario, `tasks.yaml` và `quality.yaml`.
2. **Awaiting approval.** Bạn đọc `analysis.md` và duyệt. Gói bị đóng băng: spec, thiết kế, task. Muốn đổi
   phạm vi thì phải quay lại analyzing và duyệt lại.
3. **Executing.** Từng task chạy theo vòng lặp ở mục 5.
4. **Verifying.** aidw chạy các lớp chất lượng trong `quality.yaml` (code, unit, e2e, ui-ux, a11y, security,
   performance...). Lớp fail thì aidw thêm một task sửa và quay lại executing. Sau đó, bước *converge* kiểm
   mọi scenario của change đều có test chạy xanh.
5. **Delivered.** Deploy preview, chạy smoke check, tạo gói bàn giao rồi archive: spec của change được gộp vào
   `.aidw/specs/`.
6. **Paused và Escalated.** Hết quota thì change tự về *paused* và tự chạy lại. Task hết lượt thử hoặc cần quyết
   định của bạn thì *escalated*: bạn xử lý rồi `/aidw:resume`.

## 5. Bên trong một task

Xem [`diagrams/task-loop.html`](diagrams/task-loop.html). Tóm tắt:

1. **Orchestrator** (session chính của Claude) gọi `aidw task start T03`. Lệnh in sẵn đường dẫn brief và prompt.
2. **Implementer** (subagent mới) đọc brief, viết test cho từng scenario, viết code, tự chạy lệnh verify.
3. `aidw checkpoint T03` kiểm bằng chứng: mỗi scenario có test mang đúng id, mọi lệnh verify xanh, file đổi
   nằm trong phạm vi cho phép (`touches`). Task giao diện còn bị kiểm token thiết kế và ảnh chụp màn hình.
4. **Reviewer** (subagent mới, chỉ đọc) xem diff, chạy thử, mở từng ảnh chụp. Nó ghi verdict vào
   `.aidw/run/review-T03.md` và chỉ trả lại một dòng `VERDICT: pass` hoặc `VERDICT: fix`.
5. `aidw verdict T03` đọc file đó. `pass` thì task được commit. `fix` thì ghi chú của reviewer đi vào brief của
   lần thử kế tiếp (tối đa 3 lần, sau đó escalate).

Hai trường hợp đặc biệt:

- **Chạy song song (wave).** Các task có `touches` không giao nhau, không rủi ro cao, tối đa một task dùng
  trình duyệt thì chạy cùng lúc, mỗi task trong một git worktree riêng. Sau wave, `aidw integrate` kiểm lại
  code đã merge.
- **Task chỉ thêm test** (do converge sinh ra) mà checkpoint xanh thì tự pass review, không cần reviewer.

## 6. Ba hook bảo vệ

Xem [`diagrams/components.html`](diagrams/components.html).

| Hook | Chạy khi | Làm gì |
|---|---|---|
| **gate** (PreToolUse) | trước mỗi lần Claude dùng tool | chặn ghi code trước approve; chặn sửa gói đã đóng băng; chặn đọc secret; **hỏi bạn** với lệnh nguy hiểm (push, deploy production, trả tiền) và với `aidw approve` |
| **backstop** (Stop) | khi session dừng | báo file bị sửa mà không do bước aidw nào giải thích (file do tool sinh ra như `*.tsbuildinfo` được bỏ qua) |
| **pause** (StopFailure) | khi API lỗi hoặc hết quota | đặt change về `paused`, ghi lý do |

Quyền được chia theo bậc (xem [`plugins/aidw/policies/permissions.md`](../plugins/aidw/policies/permissions.md)):
bậc 0 và 1 tự do sau approve; bậc 2 (deploy preview, dự án cloud miễn phí) chỉ khi có trong danh sách bạn đã
duyệt; bậc 3 (tốn tiền, production, push) luôn hỏi bạn; bậc x (secret cá nhân) không bao giờ.

**Vì sao đôi lúc bạn thấy hộp thoại xác nhận:** gate hỏi `aidw approve` đúng một lần. Các lệnh bậc 3 hoặc lệnh
bậc 2 chưa nằm trong danh sách cũng hỏi. Hộp thoại lặp lại quá nhiều là dấu hiệu lệnh bị nhận nhầm: kiểm bằng
`grep '"ask"' ~/<tên project>-hooks.jsonl` rồi báo lại.

## 7. Chạy không cần trông: `aidw run`

Chạy ở **terminal của bạn** (không chạy trong Claude Code), sau khi đã approve:

```bash
aidw run <id> --permission-mode auto -- --plugin-dir /đường/dẫn/plugins/aidw
```

- Lặp `claude -p "/aidw:resume <id>"` cho tới khi archive. **Mỗi task một session mới**, bắt đầu khoảng 55K token,
  thay vì một session dài cứ phình ra.
- Hết quota: chờ tới giờ reset trong thông báo lỗi, không có thì chờ 5, 10, 20, 40, 60 phút.
- Dừng khi escalated, hoặc hai session liền không tiến triển. Log ở `.aidw/run/runner.log`.
- Câu hỏi cần bạn trả lời không thể hỏi lúc chạy này: nó thành một escalation.

Dùng `/aidw:run` tương tác vẫn được. Nên gõ `/clear` trước (cuộc trò chuyện phân tích dài, mỗi lượt sau đều đọc
lại toàn bộ). Giữ session quá dài là nguyên nhân chính khiến tốn token: lần đo ở `aidw-trial-3b` cho thấy 91%
token là của session chính (đo bằng `aidw cost`, 319 lượt và 103.7M token đọc cache ở session chính của `aidw-trial-3b`).

### Đo token: `aidw cost`

Chạy trong thư mục project (ở terminal của bạn hoặc trong Claude Code):

```bash
aidw cost                # mọi session của project
aidw cost --last 1       # session gần nhất
aidw cost --session 2f76 # một session, theo tiền tố id
```

Lệnh đọc transcript Claude Code lưu ở `~/.claude/projects/` (không gửi đi đâu) và in: số lượt, kích thước context
đầu, lớn nhất và trung bình, token đọc cache, số subagent, các lệnh `aidw` hay gọi nhất, rồi vài dòng gợi ý
(session quá dài, Agent bị gọi hai lần, gọi `status`/`next` thừa). Dùng nó trước và sau mỗi thay đổi để biết thay
đổi có thật sự tiết kiệm không. "Weighted cost" là ước lượng để so sánh hai lần chạy (cache đọc 0.1x, ghi cache
1.25x, output 5x), không phải hóa đơn.

### Cảnh báo kế hoạch quá tuần tự

`aidw analyze` (chạy trước khi bạn duyệt) cảnh báo khi các task thành **một chuỗi `depends_on`**, nên không bao giờ
chạy song song được, hoặc khi `depends_on` nối các task mà `touches` không giao nhau (có thể bỏ phụ thuộc đó).
Đó chỉ là gợi ý: giữ nguyên nếu phụ thuộc là thật. Cách chia tốt: mỗi lát dọc mang cả API, UI và test của một
hành vi, thay vì chia theo tầng.

## 8. Project có sẵn (brownfield)

`/aidw:init` tự nhận ra project đã có code và giữ nguyên stack, package manager, không migrate. Thêm:

- `analysis.md` có mục **Existing system**: đánh giá code, convention, và *health baseline* (lint, typecheck,
  test đang xanh hay đỏ sẵn).
- Capability mà change sắp sửa phải có **baseline spec** mô tả hành vi *hiện tại* (`aidw baseline <capability>`),
  và delta của change dùng `## MODIFIED Requirements`.
- Chỉ capability bị đụng tới mới cần baseline.
- Trước khi aidw commit, project cần `.gitignore` che `node_modules/`, `.next/`, `*.tsbuildinfo`,
  `next-env.d.ts`, `.env*`. `aidw init` và `aidw detect` cảnh báo nếu thiếu, và aidw từ chối commit các file đó.

## 9. File và thư mục

```
.aidw/
  project.yaml        loại project, stack, package manager, lớp chất lượng gợi ý
  constitution.md     nguyên tắc kỹ thuật mọi agent tuân theo
  specs/              spec hiện hành, gộp dần sau mỗi change
  domain/ architecture/ design/ decisions/   mô hình, kiến trúc, token thiết kế, ADR
  changes/<id>/       change đang làm
    intake.md analysis.md      yêu cầu và phân tích (được duyệt)
    specs/ tasks.yaml quality.yaml
    evidence/         bằng chứng từng task, từng lớp chất lượng, converge, deploy
  archive/<id>/       change đã xong, kèm delivery/ (README, handoff, báo cáo chất lượng)
  run/                brief, ảnh chụp, verdict, worktree, runner.log (trạng thái tạm)
```

## 10. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Không ghi được code, báo "Analysis is not approved yet" | chưa `/aidw:approve` | duyệt, hoặc xem `/aidw:status` |
| Báo "approval drift" | gói đã duyệt bị sửa | `escalated`, quay lại `analyzing`, duyệt lại |
| `aidw: command not found` | bin chưa vào PATH | dùng đường dẫn đầy đủ `plugins/aidw/bin/aidw` |
| Change `escalated` | task hết lượt thử, lớp chất lượng fail mãi, cần quyết định | đọc lý do ở `/aidw:status`, xử lý, `/aidw:resume` |
| `aidw run` dừng `no_progress` | hai session liền không đổi gì | đọc `.aidw/run/runner.log`, chạy `/aidw:status` |
| `refusing to commit dependency or build output` | thiếu `.gitignore` | thêm mục ignore, `git rm -r --cached <path>`, thử lại |
| Deploy báo cần đăng nhập Vercel | token hết hạn | chạy `vercel whoami` ở terminal của bạn, rồi chạy lại |
| Subagent bị từ chối: "input bị đổi sau khi duyệt" (auto mode) | plugin khác (context-mode) sửa prompt của Agent bằng hook | tắt hook PreToolUse của plugin đó cho tool Agent, hoặc tắt plugin khi chạy aidw |
| `pnpm install` treo hoặc báo EPERM trong sandbox | store của pnpm không ghi được, hoặc safe-chain tải danh sách gói quá lâu | tự chạy `pnpm install` ở terminal của bạn khi T01 đã có `package.json` |
| Deploy báo `fetch failed` | sandbox chặn mạng | cho phép `vercel.com` và `*.vercel.com` hoặc chạy lệnh ở terminal của bạn |
| Deploy báo `first_deployment_production` | project Vercel chưa tồn tại | `vercel link --yes` rồi chạy lại; không dùng `--prod` nếu chưa chắc |
| Giữa chừng báo plugin/agent `aidw:*` biến mất | chạy bằng `--plugin-dir` và session được nạp lại | cài plugin bằng marketplace (mục 2), rồi `/reload-plugins` |
| Hộp thoại xác nhận lặp lại | lệnh bậc 2 hoặc 3 chưa nằm trong danh sách | xem mục 6 |

## Token và tốc độ (số đo từ trial-3A)

`aidw cost` in ra chi phí theo vai trò và hiệu quả của parallel. Một lần chạy 11 task, 29 subagent:

| Phần | Tỉ lệ chi phí | Vì sao |
|---|---|---|
| Orchestrator (session chính) | 57% | 186 lượt, mỗi lượt đọc lại context lớn dần từ 51K lên 300K token |
| Implementer | 33% | lượt đầu tiên đã 37K token (so với 9K của reviewer): schema tool của MCP và plugin đi kèm mọi lượt |
| Reviewer, UI reviewer, security | 10% | ảnh chụp màn hình chiếm phần lớn ở UI reviewer (4 vòng) |

**Parallel có nhanh hơn không?** Có: 6 task chạy theo wave mất 14 phút thay vì 22 phút (nhanh hơn 37%). Mức tăng bị giới hạn bởi
độ rộng của đồ thị task (wave rộng 2 trong 4 tầng). **Có tốn thêm token không?** Không đáng kể: mỗi task tốn như nhau dù chạy song
song hay tuần tự; phần thêm duy nhất là bước `aidw integrate` sau wave. Chi phí lớn nhất là số lượt của orchestrator, không phải số subagent.

Đã tối ưu: implementer chỉ có 6 tool (allowlist), reviewer chạy Sonnet, `aidw run` bỏ MCP server, UI reviewer vòng 2 trở đi chỉ mở ảnh đã đổi,
task sửa lỗi của layer có reviewer riêng được tự duyệt, orchestrator có kỷ luật token trong `/aidw:run`. Cách rẻ nhất vẫn là chạy
`aidw run <id>` ở terminal của bạn (session mới cho từng task, khoảng một phần tư token). `aidw doctor` cảnh báo khi bật nhiều plugin khác.

## 11. Giới hạn hiện tại

- Chạy song song (wave), `aidw run` và brownfield đã có code và test, nhưng **chưa được kiểm trong Claude Code
  thật**. Kế hoạch kiểm nằm ở [`trial-3.md`](trial-3.md).
- Plugin context-mode (nếu bạn dùng) viết lại prompt của mỗi lần spawn subagent, nên mỗi lần spawn tốn thêm một
  lượt gọi. Tắt nó khi chạy aidw sẽ tiết kiệm token.
- aidw giữ stack của project có sẵn, không đề xuất migrate.
- Mỗi project chỉ chạy **một change tại một thời điểm**. Muốn làm thêm thì `deliver` và archive change hiện tại trước.
- **Monorepo chưa được hỗ trợ** (pnpm workspaces, turbo, nx). `aidw init` và `aidw detect` cảnh báo; chạy aidw trong
  một package thì được, nhưng `touches`, lệnh verify và quality layer phải tự chỉnh.
- Từ lúc `executing`, aidw commit mọi task lên branch `aidw/<change-id>` (hoặc feature branch bạn đang đứng), không
  commit lên `main`. aidw không tự merge hay push: bạn merge, hoặc mở PR từ branch đó.
