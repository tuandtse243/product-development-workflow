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
| `aidw browser start\|status\|url\|stop` | trình duyệt test riêng của project cho các layer e2e, a11y, ui-ux, performance (`aidw run` tự khởi động nó trước mỗi phiên vì runner chạy ngoài sandbox): Chrome chạy headless trên cổng trống do chính Chrome chọn (không cố định 9222), mỗi project một profile. Các layer nhận `E2E_CDP_URL` và `E2E_CDP_PORT` tự động. Nếu sandbox chặn việc mở Chrome, chạy `aidw browser start` trong terminal của bạn. |
| `aidw task reopen <T> [--revert]` | task đã xong nhưng sai: về pending; `--revert` hoàn tác commit của nó (chỉ code, `.aidw/` giữ nguyên) |
| `aidw pr [<id>] [--create]` | sau bàn giao: in nội dung PR; `--create` push nhánh và mở PR bằng `gh` (luôn hỏi bạn trước) |

**Trang quyết định (Decision Page).** Khi cần bạn chọn, aidw không in một khối chữ dài vào terminal nữa. Nó in một link
`file://…/.aidw/run/pages/<tên>.html` kèm một hai dòng tóm tắt. Giữ Cmd và bấm link (hoặc gõ `! open <đường dẫn>`) để mở
trang trong trình duyệt:

- **Vòng câu hỏi** (phỏng vấn, stack, hướng thiết kế, task bị dừng): mỗi câu là một hàng thẻ phương án đặt cạnh nhau, có
  dòng được, mất và các tiêu chí so sánh thẳng hàng. Phương án aidw đề xuất được chọn sẵn kèm lý do.
- **Cổng duyệt**: mỗi mục (phạm vi, stack, thiết kế, chất lượng, quyền, rủi ro) bạn đánh dấu "Đồng ý" hoặc "Cần sửa" kèm ghi chú.
- **Audit**: tick các phát hiện muốn sửa, xếp theo mức nghiêm trọng.

Chọn xong, bấm **Sao chép câu trả lời** rồi dán khối chữ vào chat. aidw kiểm tra khối chữ đó (thiếu câu, sai mã, trang đã
cũ) rồi mới ghi vào `analysis.md`. Trang chỉ là bản xem: nó nằm trong `.aidw/run/` và không được commit; việc duyệt chính
thức vẫn là `/aidw:approve`. Nếu trình duyệt chặn nút sao chép với file cục bộ, bôi đen khối chữ ở thanh dưới cùng và sao
chép tay. Bạn vẫn có thể trả lời thẳng trong chat nếu muốn. Lý do thiết kế: [ADR-0007](adr/0007-decision-pages-are-views.md).

**Change nhỏ.** `start` đề xuất `Size: small` cho bugfix hoặc chỉnh một hành vi; bạn xác nhận ở cổng duyệt. Nhỏ nghĩa là tối đa
3 task, chỉ lớp `code` + `unit` (+ `e2e` nếu có UI), không deploy nếu bạn không yêu cầu, và bugfix phải có test tái hiện lỗi
chạy fail trước khi sửa.

**Sửa kế hoạch sau khi đã duyệt.** `escalated` → `analyzing` → sửa → duyệt lại. Task đã `done` mà không bị sửa thì được giữ nguyên
cùng bằng chứng; task bị sửa hoặc mới sẽ chạy lại (output `aidw approve` liệt kê hai nhóm).

**Commit.** Mọi commit theo Conventional Commits (`docs/commit-guide.md`). aidw tự dựng message `type(capability): title` từ trường
`type` của task.

**Stack pack.** Công cụ theo ngôn ngữ nằm ở `plugins/aidw/stacks/<ngôn ngữ>.md` (hiện có `node.md`); thêm ngôn ngữ mới là thêm một file.

## 4. Đường đi của một change

Sơ đồ: mở [`diagrams/lifecycle.html`](diagrams/lifecycle.html) trong trình duyệt để xem (có chế độ sáng/tối, zoom).

1. **Analyzing.** `/aidw:start` đọc code (nếu có), hỏi bạn từng vòng câu hỏi, rồi viết: `analysis.md` (tóm tắt,
   stack, thiết kế, quyền cần dùng), spec theo từng scenario, `tasks.yaml` và `quality.yaml`. Với sản phẩm mới
   (workflow `product`), buổi phỏng vấn có một **vòng phạm vi**: trang `scope` hỏi tầm nhìn, các khả năng nằm trong phạm
   vi, bản MVP và những gì để ngoài. Câu trả lời được ghi nguyên văn vào `analysis.md` (mục `### Scope round` trong phụ lục
   phỏng vấn). Đây là vòng câu hỏi, không phải cổng duyệt: không có gì bị đóng băng ở bước này, bạn vẫn chỉ duyệt một lần
   ở cuối ([ADR-0011](adr/0011-approval-gate-stays-after-the-plan.md)). Change tạo bởi bản aidw cũ còn ở
   `awaiting_scope_approval` được đọc như `analyzing`: phỏng vấn tiếp tục, `brief.md` của nó thay cho vòng phạm vi.
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

## Task, phiên và worktree: ba khái niệm cần phân biệt

Ba thứ này hay bị nhầm vì đều liên quan tới "một đơn vị công việc". Chúng ở ba tầng khác nhau.

| Khái niệm | Là gì | Sống ở đâu | Sống bao lâu |
|---|---|---|---|
| **Task** | một lát việc hoàn chỉnh (ví dụ "thêm, sửa, xóa danh mục") do bạn duyệt ở cổng | `.aidw/changes/<id>/tasks.yaml` và git | suốt change, cho tới khi xong |
| **Phiên (session)** | một cuộc trò chuyện của Claude: nó đọc context rồi hành động | bộ nhớ của Claude (transcript) | từ lúc mở tới lúc đóng hoặc hết ngữ cảnh |
| **Worktree** | một bản checkout git riêng của repo, để một task chạy song song mà không giẫm lên task khác | `.aidw/run/worktrees/<change>/<task>/` | từ lúc task bắt đầu tới lúc merge |

Nguyên tắc nền: **mọi thứ cần nhớ nằm ở `.aidw/` và git, không nằm trong phiên.** Phiên nào cũng có thể chết, bị ngắt hoặc thay bằng phiên mới mà không mất gì.

### Task

Một task là một lát dọc (vertical slice): mang cả API, giao diện và test của một hành vi. Mỗi task trong `tasks.yaml` có:

- `id` (T01...), `title`, `type` (feat/fix/...: dùng cho commit message), `role`;
- `specs` và `scenarios`: yêu cầu nó phải làm cho đúng. Mỗi scenario phải có một test mang đúng id của nó;
- `depends_on`: task nào phải xong trước;
- `touches`: các file nó được phép sửa. Đây là hàng rào: file ngoài danh sách bị báo ở checkpoint;
- `risk`: `high` (đăng nhập, thanh toán, migration) thì luôn chạy một mình;
- `verify`: các lệnh chứng minh nó chạy được.

Vòng đời của một task (cột `status`):

```
pending -> running -> review -> done
              ^          |
              |          v
              +------- failed ----(sau 3 lần thử)----> escalated
```

- `running`: có implementer đang làm. Nếu phiên chết giữa chừng, task kẹt ở `running`; `aidw next` gọi nó là *interrupted* và phiên sau làm tiếp từ phần code đã có.
- `review`: checkpoint đã xanh, đang chờ reviewer độc lập.
- `failed`: checkpoint đỏ hoặc reviewer đòi sửa. Ghi chú lỗi đi vào brief của lần thử kế tiếp. Tối đa 3 lần (`max_attempts`), sau đó `escalated`: cần bạn quyết định.
- `done`: đã review xong và **đã commit**: một task, một commit, dạng `type(capability): title`.

Có bốn nguồn gốc (`origin`): `plan` (bạn đã duyệt), `converge` (thêm test cho scenario còn thiếu), `quality` (sửa một lớp chất lượng bị fail) và `integration` (sửa chỗ code của các task song song không khớp nhau). Ba loại sau do aidw thêm, nên không làm hash duyệt bị lệch.

Cần sửa task đã xong: `aidw task reopen T02 [--revert]`. Sửa kế hoạch sau khi duyệt: duyệt lại, task không đổi giữ nguyên.

### Phiên

Có ba kiểu "người làm" khác nhau, đừng gộp:

1. **Orchestrator**: phiên Claude điều phối. Nó chỉ làm việc cơ học: gọi `aidw task start`, giao việc cho subagent, gọi `aidw checkpoint`, `aidw verdict`. Nó không viết code. Đó là phiên bạn đang chat, hoặc một phiên không giao diện do `aidw run` mở.
2. **Subagent**: Claude con, mỗi cái một context mới, chỉ biết brief của nó. *Implementer* viết code của một task. *Reviewer* chỉ đọc và đánh giá. Xong việc thì biến mất; kết quả nằm trong file và git, không nằm trong trí nhớ của ai.
3. **Runner** (`aidw run`): không phải Claude, chỉ là một chương trình lặp lại việc mở phiên orchestrator mới.

Một phiên orchestrator dài là phần tốn token nhất: mỗi lượt nó đọc lại toàn bộ cuộc trò chuyện, nên context càng lớn thì mỗi lượt càng đắt (trial-3A: phiên chính chiếm 57% chi phí, lớn dần tới 300K token). Vì thế `aidw run` mở **phiên mới sau mỗi task hoặc wave**: phiên mới đọc `.aidw/`, biết task nào xong, và tiếp tục. Sau khi một task commit, lệnh của aidw in "END THIS SESSION", phiên đó dừng, runner mở phiên kế.

Hai phiên **không bao giờ chạy cùng lúc**. Runner chờ phiên này kết thúc rồi mới mở phiên sau. Song song chỉ xảy ra *bên trong* một phiên, giữa các subagent, qua worktree.

### Worktree

Hai task cùng sửa một thư mục làm việc sẽ giẫm lên nhau. Git worktree cho mỗi task một bản checkout riêng của cùng một repo (cùng lịch sử, khác thư mục và khác nhánh), nên chúng chạy song song an toàn.

Khi nào dùng: aidw xếp các task thành một **wave** khi (1) `depends_on` đã xong, (2) `touches` không giao nhau, (3) không có task `risk: high` hay `touches: ["**"]` (chúng chạy một mình), (4) tối đa một task dùng trình duyệt (chung cổng e2e), (5) không quá `parallel.max` (mặc định 3). Task đứng một mình chạy thẳng trong thư mục chính, không cần worktree.

Vòng đời trong một wave:

1. `aidw task start T02 --worktree` tạo thư mục `.aidw/run/worktrees/<change>/T02/` trên nhánh `aidw/<change>.T02`, bắt đầu từ commit hiện tại của nhánh change. aidw tự nối `node_modules` của repo chính vào đó (không bị git thấy).
2. Implementer chỉ làm việc trong thư mục đó. Cổng bảo vệ không cho nó sửa thư mục chính hay `.aidw/` của worktree. Checkpoint chạy trong đó.
3. Reviewer pass: aidw commit trong worktree, rồi **merge vào nhánh change** (`--no-ff`), từng task một, cùng với trạng thái `.aidw/`. Worktree và nhánh `.T02` bị xóa. Kết quả: nhánh change có một commit cho mỗi task, y như chạy tuần tự.
4. Sau cả wave, `aidw integrate` chạy lệnh verify của các task trong wave và lớp `code` trên **code đã gộp**. Nếu hai task không khớp nhau, nó thêm một task sửa (`origin: integration`) và dừng wave kế tiếp cho tới khi xong.

**Xung đột.** Nếu lúc merge hai task sửa cùng một chỗ: aidw hủy merge, xóa nhánh của task đó, đánh `sequential` và chạy lại nó một mình trên code mới nhất. Không có ai phải giải quyết conflict bằng tay, và không mất công việc của task kia. Cách phòng tốt nhất là `touches` thật hẹp (cho nên `aidw plan` và `analyze` cảnh báo).

### Gộp lại: một change chạy ra sao

```
bạn: aidw run <id>   (một lần, ở terminal của bạn)
 └─ runner mở phiên orchestrator #1  ── đọc .aidw/, thấy T01 pending
     ├─ task start T01 → implementer(T01) → checkpoint → reviewer(T01) → verdict → commit
     └─ "END THIS SESSION"
 └─ runner mở phiên #2 ── thấy T01 done; T02, T03 ready (wave)
     ├─ worktree T02 ┐  implementer ×2 song song, mỗi cái trong worktree riêng
     ├─ worktree T03 ┘  checkpoint, reviewer, verdict, merge từng task, integrate
     └─ "END THIS SESSION"
 └─ ... phiên #n ── mọi task xong → verify các lớp chất lượng → deploy → bàn giao → archive
```

## 6. Ba hook bảo vệ

Xem [`diagrams/components.html`](diagrams/components.html).

| Hook | Chạy khi | Làm gì |
|---|---|---|
| **gate** (PreToolUse) | trước mỗi lần Claude dùng tool | chặn ghi code trước approve; chặn sửa gói đã đóng băng; chặn đọc secret; **hỏi bạn** với lệnh nguy hiểm (push, deploy production, trả tiền) và với `aidw approve` |
| **backstop** (Stop) | khi session dừng | báo file bị sửa mà không do bước aidw nào giải thích (file do tool sinh ra như `*.tsbuildinfo` được bỏ qua) |
| **pause** (StopFailure) | khi API lỗi hoặc hết quota | đặt change về `paused`, ghi lý do |

Quyền được chia theo bậc (xem [`plugins/aidw/company/permissions.md`](../plugins/aidw/company/permissions.md)):
bậc 0 và 1 tự do sau approve; bậc 2 (deploy preview, dự án cloud miễn phí) chỉ khi có trong danh sách bạn đã
duyệt; bậc 3 (tốn tiền, production, push) luôn hỏi bạn; bậc x (secret cá nhân) không bao giờ.

**Vì sao đôi lúc bạn thấy hộp thoại xác nhận:** gate hỏi `aidw approve` đúng một lần. Các lệnh bậc 3 hoặc lệnh
bậc 2 chưa nằm trong danh sách cũng hỏi. Hộp thoại lặp lại quá nhiều là dấu hiệu lệnh bị nhận nhầm: kiểm bằng
`grep '"ask"' ~/<tên project>-hooks.jsonl` rồi báo lại.

## 7. Chạy không cần trông: `aidw run` (cách chạy khuyên dùng)

Bạn gõ **một lệnh, một lần**, sau khi đã approve. Sau đó có thể đi làm việc khác. AI không tự mở được tab terminal khác (sandbox chặn Claude Code lồng nhau gọi mạng và đăng nhập), nên có hai cách gõ:

- **Ngay trong cửa sổ Claude Code đang mở:** `! aidw run <id> --detach --permission-mode auto`. Lệnh trả về ngay, vòng lặp chạy nền. Theo dõi: `tail -f .aidw/run/runner.log`; xem trạng thái: `aidw run --status`; dừng: `aidw run --stop`.
- **Ở terminal riêng** (chạy nổi, thấy log trực tiếp):

```bash
aidw doctor <id>        # kiểm máy trước: Chrome CDP, đăng nhập Vercel, store pnpm...
aidw run <id> --permission-mode auto -- --plugin-dir /đường/dẫn/plugins/aidw
```

(Cần `aidw` trong PATH: xem mục 2.) Lệnh là một vòng lặp tự động, không phải chạy từng task bằng tay:

- Nó mở `claude -p "/aidw:resume <id>"`, chờ phiên đó xong, rồi mở phiên mới, cho tới khi change được archive. Cách các phiên nối tiếp nhau và vì sao không xung đột: xem mục "Task, phiên và worktree" ở trên.
- **Rẻ hơn khoảng bốn lần** so với `/aidw:run` trong Claude Code: mỗi phiên bắt đầu khoảng 55K token thay vì một phiên phình tới 300K. Nó cũng bỏ các MCP server khỏi phiên (thêm `--keep-mcp` để giữ).
- Hết quota: chờ tới giờ reset trong thông báo lỗi, không có thì chờ 5, 10, 20, 40, 60 phút.
- Dừng khi escalated, hoặc hai phiên liền không tiến triển. Log ở `.aidw/run/runner.log`.
- Nó không hỏi bạn được giữa chừng: câu hỏi cần bạn trả lời thành một escalation. Xử lý xong thì chạy lại đúng lệnh trên; nó tiếp tục từ chỗ dừng.
- Nếu muốn tạm dừng: Ctrl+C. Chạy lại lệnh sau là tiếp tục. Không mất gì.

Dùng `/aidw:run` tương tác trong Claude Code vẫn được, dành cho việc ngắn hoặc khi bạn muốn xem từng bước. Hãy gõ `/clear` trước (cuộc trò chuyện phân tích dài, mỗi lượt sau đều đọc lại toàn bộ).

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
| `aidw run` dừng `needs_user` ngay phiên đầu hoặc trước deploy | `aidw doctor` có FAIL (chưa đăng nhập Vercel, project chưa có deployment nào nên lần deploy đầu là Production, Chrome CDP đóng) | làm theo dòng in ra rồi chạy lại đúng lệnh |
| `vercel ... has no deployments yet` / doctor `vercel deployments` FAIL | project Vercel mới: deployment đầu tiên luôn là Production, không tạo được preview | chạy `aidw first-deploy --yes` trong terminal của bạn (deploy công khai một lần), rồi `aidw deploy`; hoặc đặt deploy target `none` |
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
