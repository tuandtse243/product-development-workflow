# aidw: hướng dẫn sử dụng

aidw là một plugin cho Claude Code. Bạn mô tả cần làm gì, trả lời một vòng câu hỏi, **đọc và duyệt một văn bản
phân tích**, rồi aidw tự làm phần còn lại: viết code, kiểm thử, deploy preview và bàn giao.

Tài liệu này dành cho người mới. Kế hoạch kiểm thử thực tế nằm ở [`trial-3.md`](trial-3.md).

## 1. Hiểu nhanh trong một phút

- Bạn **chỉ quyết định ở một chỗ**: duyệt `analysis.md` (đồng ý mọi mục trên trang cổng duyệt, hoặc gõ `/aidw:approve`).
  Trước đó, code bị khóa. Sau đó, mọi thứ chạy tự động: **một lệnh `/aidw:start`** đi từ yêu cầu qua cổng duyệt vào tới
  lúc build, bạn không phải gõ `/aidw:run`.
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
| `/aidw:start <ý tưởng, PRD hoặc đường dẫn file>` | mỗi change mới | hỏi bạn, phân tích, viết spec, chia task, dừng ở cổng duyệt. Bạn đồng ý xong thì nó tự duyệt và tự build (mục 7: tối đa 3 task build ngay trong phiên, hơn 3 task tự bật runner nền) |
| `/aidw:approve` | khi muốn duyệt từ phiên khác | **cổng duy nhất**: bạn bấm Yes. Hash và đóng băng gói phân tích, rồi build như trên |
| `/aidw:run` | thường không cần gõ | build ngay trong phiên: chạy các task, kiểm tra chất lượng, deploy preview, bàn giao. `start` và `approve` tự gọi nó khi kế hoạch có tối đa 3 task |
| `/aidw:resume` | sau khi bị ngắt, hoặc để hoàn tất một PR draft | tiếp tục từ chỗ dừng. Đã dừng vì escalation thì xử lý xong rồi mới resume. Change kết thúc bằng PR draft: làm theo mục "Needed from the user to finish" của PR rồi resume, aidw build lại phần còn thiếu và cập nhật chính PR đó |
| `/aidw:status` | bất cứ lúc nào | trạng thái, drift, task nào xong, việc cần bạn |
| `/aidw:deliver` | `run` tự gọi ở cuối | tạo gói bàn giao (README, handoff, báo cáo chất lượng), mở pull request (ready hoặc draft), rồi archive khi PR ready |

Các lệnh CLI hữu ích khi bạn tự gõ `aidw` (xem mục 2 để đưa nó vào PATH):

| Lệnh | Việc nó làm |
|---|---|
| `aidw doctor [<id>]` | kiểm máy trước khi chạy: binary của các lệnh chất lượng, pnpm store, registry, Chrome CDP, đăng nhập và liên kết Vercel. Thoát mã 1 nếu có FAIL |
| `aidw browser start\|status\|url\|stop` | trình duyệt test riêng của project cho các layer e2e, a11y, ui-ux, performance (`aidw run` tự khởi động nó trước mỗi phiên vì runner chạy ngoài sandbox): Chrome chạy headless trên cổng trống do chính Chrome chọn (không cố định 9222), mỗi project một profile. Các layer nhận `E2E_CDP_URL` và `E2E_CDP_PORT` tự động. Nếu sandbox chặn việc mở Chrome, chạy `aidw browser start` trong terminal của bạn. |
| `aidw task reopen <T> [--revert]` | task đã xong nhưng sai: về pending; `--revert` hoàn tác commit của nó (chỉ code, `.aidw/` giữ nguyên) |
| `aidw stages [<id>] [--done <stage>]` | các stage phân tích trước cổng duyệt: xong, sẵn sàng, và nhóm chạy song song ngay (không đọc/ghi chồng nhau, một việc dùng trình duyệt, `parallel.max`); `--done` báo một stage đã xong |
| `aidw plan-review [<id>] [--brief]` | review độc lập kiến trúc và kế hoạch trước cổng duyệt: `--brief` viết brief cho code-reviewer; không có thì ghi verdict của nó thành một vòng (tối đa 2 vòng sửa) |
| `aidw pr [<id>] [--create]` | sau bàn giao: viết nội dung PR vào `.aidw/run/pr-<id>.md`, cho biết ready hay draft và quyền push; `--create` commit gói bàn giao, push nhánh và mở PR bằng `gh` (draft nếu còn thiếu), hoặc cập nhật PR đã mở (body, đánh dấu ready). Hỏi bạn trước, trừ khi bạn đã cấp quyền push ở cổng duyệt |
| `aidw cap <id> --raise <n>` | run dừng vì chạm trần Agent run: nâng trần thêm `n` lượt (luôn hỏi bạn, chỉ bạn quyết; ghi vào `approval.history`, không phải Deviation), rồi `/aidw:resume` |
| `aidw task retry <T>` | cho một task `escalated`, `failed` hoặc `not_built` một lượt thử mới; task `not_built` quay lại cùng các task bị bỏ vì phụ thuộc nó |

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
   Trước cổng duyệt, sau khi `aidw analyze` sạch lỗi, một agent **code-reviewer** chỉ đọc (không phải người viết gói)
   chấm kiến trúc, kế hoạch và test plan theo một danh sách cố định: (1) mọi scenario được duyệt đều có task thật sự làm
   nó, (2) không task nào ngoài phạm vi, (3) theo đúng constitution, (4) không phức tạp thừa. Nó ghi verdict vào
   `.aidw/run/review-plan-<id>.md`, mỗi phát hiện nêu số mục và task id, scenario id hoặc vùng (`architecture`,
   `constitution`, `contracts`, `test-plan`, `quality`). `aidw plan-review <id> --brief` viết brief cho nó;
   `aidw plan-review <id>` ghi verdict thành một vòng (`changes/<id>/plan-review.yaml`). `fix` thì các Role viết phần đó
   sửa rồi agent chấm lại; tối đa 2 vòng sửa (CLI đếm), verdict thứ ba là cuối cùng. Phát hiện còn mở sau đó được đưa
   lên **đầu trang Decision Page của cổng duyệt**, để bạn duyệt kèm chúng hoặc yêu cầu sửa. `aidw transition <id>
   awaiting_approval` từ chối khi chưa có verdict được ghi, khi vòng sửa còn đang mở, hoặc khi file verdict bị sửa sau
   khi ghi (D4, [ADR-0011](adr/0011-approval-gate-stays-after-the-plan.md)). Mỗi vòng cần brief riêng. Nếu bạn trả gói
   về từ cổng duyệt và kế hoạch đã chấm (task, spec, kiến trúc, constitution, hợp đồng dữ liệu/API, test plan) thay đổi,
   cổng từ chối và một lượt review mới chạy, với 2 vòng sửa riêng; kế hoạch không đổi thì review cũ vẫn tính. Chỉ
   code-reviewer được ghi file verdict, không agent nào được ghi `plan-review.yaml`. Workflow `bugfix` cũng chạy bước
   này; `aidw approve --auto` không tự duyệt khi còn phát hiện mở mà để bạn quyết ở trang cổng duyệt.
2. **Awaiting approval.** Bạn đọc `analysis.md` và duyệt. Gói bị đóng băng: spec, thiết kế, task. Muốn đổi
   phạm vi thì phải quay lại analyzing và duyệt lại.
3. **Executing.** Từng task chạy theo vòng lặp ở mục 5.
4. **Verifying.** aidw chạy các lớp chất lượng trong `quality.yaml` (code, unit, e2e, ui-ux, a11y, security,
   performance...). Lớp fail thì aidw thêm một task sửa và quay lại executing. Sau đó, bước *converge* kiểm
   mọi scenario của change đều có test chạy xanh.
5. **Delivered.** Deploy preview, chạy smoke check, tạo gói bàn giao, mở **pull request** rồi archive: spec của change
   được gộp vào `.aidw/specs/`. Run luôn kết thúc bằng một pull request (D12): *ready* khi mọi lớp chất lượng qua, converge
   đủ, deploy thành công và không có gì *not built*; *draft* trong mọi trường hợp khác. Body của PR mở đầu bằng ba mục cố
   định, theo thứ tự: **Differs from the approved package** (từng Deviation: lý do, Role tác giả, tóm tắt, scenario và
   requirement bị bỏ, thêm, đổi kèm lý do, loại thay đổi contract), **Not built and why** (task kèm nguyên nhân, lý do,
   các task phụ thuộc bị bỏ theo, nơi giữ phần việc bị bỏ dở; lớp chất lượng; scenario; trần Agent run nếu chạm), và
   **Needed from the user to finish** (việc cụ thể theo nguyên nhân: thiếu key thì cung cấp gì, việc ngoài quyền thì
   làm tay, chạm trần thì `aidw cap`, deploy lỗi, các finding review và câu hỏi còn mở từ trước cổng duyệt). Mục trống
   ghi "Nothing.". PR mở **trước** archive vì quyền push chỉ phủ change chưa archive; nếu PR mở bằng quyền đó, lệnh
   archive push luôn commit archive lên cùng nhánh. Deploy lỗi hay cần bạn (deploy production không bao giờ tự động)
   không chặn PR: PR mở dạng draft và deploy nằm trong mục "Needed". PR draft thì change **không** bị archive mà ở lại
   *delivered*; `/aidw:resume` đưa nó về executing, chạy lại task bị bỏ vì môi trường (sau khi bạn sửa) hoặc vì trần (sau
   khi bạn nâng), chạy lại lớp chất lượng bị bỏ và deploy lỗi, rồi cập nhật chính PR đó (push lại, thay body, `gh pr
   ready` khi đã đủ). Phần việc bị bỏ dở của một task not built được chép vào `changes/<id>/delivery/not-built/` và
   commit cùng gói bàn giao, để người review PR trên máy khác vẫn thấy (bản gốc ở `.aidw/run/` không được commit).
6. **Paused, not built và Escalated.** Hết quota thì change tự về *paused* và tự chạy lại. Sau cổng duyệt run không
   hỏi bạn ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md)): việc không làm được thì bị
   đánh dấu *not built* (kèm lý do) và phần còn lại chạy tiếp; pull request liệt kê chúng. *Escalated* chỉ còn cho
   những gì không bao giờ tự động (credential ngoài `.env` của project, thứ tốn tiền, deploy production, xoá dữ liệu
   cloud), khi bạn tự dừng run, hoặc khi CLI tự báo `escalate`: bạn xử lý rồi `/aidw:resume`. Một blocker không Role
   nào trả lời được (thiếu key, dịch vụ chết, cài package bị chặn) là nguyên nhân môi trường: task bị đánh dấu
   `not_built` (`aidw not-built <T> --cause environment`), không escalate. Một lần checkpoint bị máy chặn thì chạy lại
   ngoài sandbox; bị chặn lần thứ hai thì task cũng `not_built` (môi trường).

## 5. Bên trong một task

Xem [`diagrams/task-loop.html`](diagrams/task-loop.html). Tóm tắt:

1. **Orchestrator** (session chính của Claude) gọi `aidw task start T03`. Lệnh in sẵn đường dẫn brief và prompt.
2. **Implementer** (subagent mới) đọc brief, viết test cho từng scenario, viết code, tự chạy lệnh verify.
3. `aidw checkpoint T03` kiểm bằng chứng: mỗi scenario có test mang đúng id, mọi lệnh verify xanh, file đổi
   nằm trong phạm vi cho phép (`touches`). Task giao diện còn bị kiểm token thiết kế và ảnh chụp màn hình.
4. **Reviewer** (subagent mới, chỉ đọc) xem diff, chạy thử, mở từng ảnh chụp. Nó ghi verdict vào
   `.aidw/run/review-T03.md` và chỉ trả lại một dòng `VERDICT: pass` hoặc `VERDICT: fix`.
5. `aidw verdict T03` đọc file đó. `pass` thì task được commit. `fix` thì ghi chú của reviewer đi vào brief của
   lần thử kế tiếp (tối đa 3 lần, sau đó tới bước Triage bên dưới).

Hai trường hợp đặc biệt:

- **Chạy song song (wave).** Các task có `touches` không giao nhau, không rủi ro cao, tối đa một task dùng
  trình duyệt thì chạy cùng lúc, mỗi task trong một git worktree riêng. Sau wave, `aidw integrate` kiểm lại
  code đã merge.
- **Chạy song song trước cổng duyệt và khi review.** CLI tự tính việc nào chạy cùng lúc được từ các Artifact mỗi việc
  đọc và ghi: hai stage phân tích không đọc/ghi chồng nhau (ví dụ `research` và `user-research`) được đưa ra cùng một
  dòng `NEXT:` của `aidw stages <id>`; các reviewer của lớp chất lượng (`ui`, `security`, `performance`) được
  `aidw verify` đưa ra cùng lúc. Reviewer luôn được ưu tiên trước stage phân tích; tối đa một việc dùng trình duyệt
  (reviewer `ui`, stage `design`), không quá `parallel.max`. Session chính mở mỗi việc một subagent trong một tin nhắn,
  rồi báo từng việc xong (`aidw stages --done <stage>`, `aidw layer-review <layer>`).
- **Task chỉ thêm test** (do converge sinh ra) mà checkpoint xanh thì tự pass review, không cần reviewer.
- **Agent thiếu thông tin thì hỏi, không đoán (Consultation, [ADR-0013](adr/0013-agents-consult-other-roles-through-the-orchestrator.md)).**
  Một Agent gặp lỗ hổng trong contract (chưa ai nêu status code, tên cột...) không tự đoán và cũng không hỏi bạn
  trước: nó ghi câu hỏi vào `.aidw/changes/<id>/consult/<task>.request.md` (câu hỏi + ghi chú tiến độ: đã làm gì,
  bước tiếp theo, file đã đụng) rồi dừng lượt với dòng `CONSULT <đường dẫn>`. Session chính chạy
  `aidw consult <file>`: CLI kiểm cặp Role có được khai trong `consults:` của `role.md` không, chỉ một tầng (Role được
  hỏi không được hỏi tiếp), tối đa 2 câu mỗi lần Agent chạy, và khi build thì chỉ được hỏi Role đã viết contract mà
  task đọc (`api-designer` cho API contract, `database-architect` cho data model, `software-architect` cho kiến trúc).
  Hợp lệ thì CLI ghi `C01` vào `changes/<id>/consultations.yaml` và in lệnh spawn Role được hỏi; Role đó ghi câu trả
  lời vào `consult/C01.answer.md`. `aidw consult answer C01` luôn viết một *resume brief* (brief gốc + ghi chú tiến độ +
  đường dẫn câu trả lời) để một Agent mới cùng Role làm tiếp; nếu Agent đã hỏi vẫn đang chạy trong phiên thì session
  chính nhắn tiếp cho nó (SendMessage) cho rẻ hơn (`aidw consult resume C01` in cả hai cách). Các task khác của wave vẫn
  chạy trong lúc đó. Với runner, `aidw next` ở phiên mới đưa Consultation đang dở lên trước mọi việc khác, nên không gì
  bị mất. Sau cổng duyệt, câu hỏi không trả lời được hoặc câu trả lời đòi đổi thứ đã duyệt cũng không đến tay bạn
  ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md)): nó được ghi lại để Role tác giả
  quyết định như một Deviation (xem dưới), và pull request sẽ nêu ra. Trước cổng duyệt, câu hỏi không ai trả lời được thành
  câu hỏi mở trong Artifact và được liệt kê (kèm nguyên văn câu hỏi) trên trang duyệt; stage còn Consultation dở thì
  chưa được báo xong và package chưa duyệt được. Hook chỉ cho implementer ghi `<task>.request.md` của task nó đang chạy,
  và chỉ Role được hỏi mới ghi được `C01.answer.md` của câu hỏi đó.

- **Sau cổng duyệt, thứ đã duyệt chỉ đổi qua một Deviation ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md)).**
  Khi một câu trả lời (hay một chẩn đoán) đòi đổi spec, contract, kiến trúc hay plan đã duyệt, session chính không tự
  sửa và không hỏi bạn: nó chạy `aidw deviation open --role <Role tác giả> --files <file> --reason "<vì sao>"`. CLI
  chỉ nhận Role đã viết file đó (theo `artifacts.yaml`) và chỉ file thuộc package đã duyệt; trong lúc mở, hook chỉ cho
  đúng Role đó sửa đúng các file đó, còn sửa bất kỳ file đã duyệt nào khác vẫn là drift. Role tác giả sửa theo ba quy
  tắc: giữ mục đích, sửa ít nhất, không thêm phạm vi. `aidw deviation close` kiểm: không file nào khác bị đổi, không
  contract hay scenario nào đang viết dở, không đụng `grants`, `permissions` hay lệnh `run`/`setup` của các layer mà bạn đã duyệt, package vẫn hợp lệ, không bỏ
  scenario đã duyệt nào mà không ghi lý do (`--remove-reason`), không thêm requirement mới nếu không ghi lý do
  (`--scope-reason`), task mới phải phục vụ một scenario đã duyệt, task cần chạy lại không còn đang chạy dở, và phân
  loại thay đổi contract (`openapi.yaml`, `data-model.dbml`) là *additive* (thêm, không phá) hay *breaking*. "Giữ mục
  đích" và "sửa ít nhất" là phán đoán của Role tác giả và reviewer, CLI không kiểm được. Xong thì CLI tính lại hash duyệt (giữ nguyên quyền push bạn đã cấp),
  ghi lịch sử vào `approval.history`, đưa các task bị ảnh hưởng (đã xong) về chạy lại, và ghi vào
  `changes/<id>/deviations.yaml`: đây là nguồn của mục "khác với package đã duyệt" trong pull request.
- **Việc vượt ngoài quyền bạn cấp thì không làm (D10).** Task cần thứ ngoài permission envelope (hay thứ không bao giờ
  tự động: credential ngoài `.env`, thứ tốn tiền, deploy production, xoá dữ liệu cloud) được đánh dấu `not_built` kèm
  lý do (`aidw not-built <task> --reason "..."`, `--cause environment` khi thiếu key hay mạng), cùng các task phụ thuộc nó; phần còn lại chạy tiếp và pull request
  liệt kê chúng.

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
              +------- failed ----(sau 3 lần thử)----> Triage
                                                         |
           implementation: thêm 1 lần thử  <-------------+
           plan / spec / architecture: Role tác giả sửa Artifact, chạy lại (tối đa 3 vòng)
           environment, hết 3 vòng, hoặc chạm trần Agent run ----> not_built
```

- `running`: có implementer đang làm. Nếu phiên chết giữa chừng, task kẹt ở `running`; `aidw next` gọi nó là *interrupted* và phiên sau làm tiếp từ phần code đã có.
- `review`: checkpoint đã xanh, đang chờ reviewer độc lập.
- `failed`: checkpoint đỏ hoặc reviewer đòi sửa. Ghi chú lỗi đi vào brief của lần thử kế tiếp. Tối đa 3 lần (`max_attempts`), sau đó một Agent độc lập (Software Architect) chẩn đoán nguyên nhân (Triage), và CLI tự định tuyến, không hỏi bạn:
  - `implementation`: thêm một lần thử với chẩn đoán trong brief; vẫn hỏng thì `not_built`.
  - `plan`, `spec`, `architecture`: task quay về Role đã viết Artifact đó (technical-planner cho plan, chủ của spec và architecture theo `artifacts.yaml`). `aidw brief <T> --for upstream` mở một **Deviation** cho đúng các file đó (Triage có thể chỉ file bằng dòng `FILES:`; chủ của file theo `artifacts.yaml` sẽ sửa, ví dụ api-designer cho hợp đồng API) và in một brief duy nhất cho Role tác giả. Role sửa xong thì `aidw deviation close` (CLI kiểm và ghi lại), rồi `aidw upstream <T>` cho task chạy lại. Tối đa 3 vòng; sau đó `not_built`. Role không sửa được thì `aidw upstream <T> --cannot "<lý do>"`: Deviation bị huỷ, task `not_built`. Triage hai lần không ra nguyên nhân rõ thì `aidw triage <T> --unclear`: `not_built`.
  - `environment` (thiếu key, mạng): `not_built` ngay, lý do ghi rõ bạn cần sửa gì để hoàn tất sau.
- `not_built`: run không làm được task này (lý do ở `not_built: { cause, reason }`). Mọi task phụ thuộc vào nó (trực tiếp hay gián tiếp) cũng `not_built`; các task độc lập chạy tiếp. Change vẫn đi tiếp tới verify và giao hàng; pull request liệt kê những gì chưa làm và vì sao.
- `done`: đã review xong và **đã commit**: một task, một commit, dạng `type(capability): title`.

Có bốn nguồn gốc (`origin`): `plan` (bạn đã duyệt), `converge` (thêm test cho scenario còn thiếu), `quality` (sửa một lớp chất lượng bị fail) và `integration` (sửa chỗ code của các task song song không khớp nhau). Ba loại sau do aidw thêm, nên không làm hash duyệt bị lệch.

Cần sửa task đã xong: `aidw task reopen T02 [--revert]`. Sửa kế hoạch sau khi duyệt: duyệt lại, task không đổi giữ nguyên.

**Trần Agent run.** Ở cổng duyệt bạn đặt trần số lần chạy Agent cho change (`grants.agent_runs` trong `quality.yaml`;
mặc định 3 lần số Agent run kế hoạch cần: mỗi task một implementer và một reviewer, cộng một reviewer cho mỗi lớp
review trong `quality.yaml`; trang cổng duyệt ghi rõ phép tính). Con số được ghi vào bản ghi duyệt lúc bạn duyệt, nên
một Deviation thêm task không làm trần thay đổi. CLI đếm mỗi Agent mà nó in dòng `SPAWN` (implementer, reviewer, triage, Role
tác giả, integration, Role được hỏi, reviewer của lớp chất lượng), mỗi lần một lần, ghi ở
`.aidw/changes/<id>/evidence/agent-runs.json`. Chạm trần thì không task mới nào bắt đầu: task chưa chạy hoặc đang
`failed` thành `not_built` (lý do: trần), việc đang chạy làm nốt, lớp chất lượng fail hay khoảng trống converge không
còn được thêm task sửa, không Consultation mới nào được ghi (Agent hỏi sẽ làm theo gói đã duyệt và báo khoảng trống).
Reviewer của các lớp review vẫn chạy khi chạm trần: chúng chỉ đánh giá thứ đã làm. Change đi tiếp tới verify và giao
hàng một cách êm, không dừng chờ bạn. File đếm hỏng thì coi như đã chạm trần. `aidw task reopen` đặt lại cả số vòng sửa
ngược của task.

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

**Xung đột.** Nếu lúc merge hai task sửa cùng một chỗ, aidw không bỏ công việc ngay mà giao conflict cho role `integration`:

1. `aidw review`/`aidw verdict` báo `merge conflict ...: the integration Role resolves it`; task chuyển sang trạng thái `conflict`, worktree của nó được giữ, và conflict được ghi vào `.aidw/changes/<id>/conflicts.yaml` (task nào, đụng với task nào, file nào).
2. `aidw brief <task> --for conflict` merge nhánh change vào worktree của task (agent không được tự merge) và viết brief cho `aidw:integration`: cả hai task (id, tên, scenario, touches, verify), các file conflict và cả hai nhánh.
3. Agent gộp hai phía trong các file conflict, chạy verify của cả hai task, không commit. `aidw resolve <task>` commit merge trong worktree, kiểm so với cả hai phía (không còn dấu conflict ở file nào, không có rác, và các guard của checkpoint: xóa hay tắt test, đổi cấu hình kiểm tra, khóa bí mật, package), rồi chạy lại kiểm tra của **cả hai task** (verify và test cho từng scenario) trên code đã gộp. Nếu máy từ chối một lệnh (sandbox, proxy) thì conflict vẫn mở và chỉ cần chạy lại `aidw resolve`. File nhị phân trong conflict thì không gộp được bằng tay: task bị bỏ ngay từ bước brief.
4. Một reviewer độc lập (`aidw brief <task> --for merge-review`, `aidw:code-reviewer`) xem riêng phần gộp; `aidw verdict <task>` pass thì task được merge vào nhánh change như bình thường.

Hỏng ở bất kỳ bước nào (còn dấu conflict, kiểm tra fail, reviewer trả `fix`, merge lại vẫn conflict): aidw làm như trước đây, tức xóa nhánh của task, đánh `sequential` và chạy lại nó một mình trên code mới nhất. Kết quả (`resolved` hay `dropped`, kèm lý do) cũng ghi vào `conflicts.yaml`; Technical Planner đọc file này lần sau khi lập kế hoạch để sửa `touches`. Cách phòng tốt nhất vẫn là `touches` thật hẹp (cho nên `aidw plan` và `analyze` cảnh báo).

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
| **gate** (PreToolUse) | trước mỗi lần Claude dùng tool | chặn ghi code trước approve; chặn sửa gói đã đóng băng; chặn đọc secret; **hỏi bạn** với lệnh nguy hiểm (push, deploy production, trả tiền) và với `aidw approve`; push Change Branch và mở PR không hỏi nếu bạn đã cấp ở cổng duyệt |
| **backstop** (Stop) | khi session dừng | báo file bị sửa mà không do bước aidw nào giải thích (file do tool sinh ra như `*.tsbuildinfo` được bỏ qua) |
| **pause** (StopFailure) | khi API lỗi hoặc hết quota | đặt change về `paused`, ghi lý do |

Quyền được chia theo bậc (xem [`plugins/aidw/company/permissions.md`](../plugins/aidw/company/permissions.md)):
bậc 0 và 1 tự do sau approve; bậc 2 (deploy preview, dự án cloud miễn phí) chỉ khi có trong danh sách bạn đã
duyệt; bậc 3 (tốn tiền, production, push) luôn hỏi bạn; bậc x (secret cá nhân) không bao giờ.

**Quyền cấp ở cổng duyệt (grants).** Trang Decision Page của cổng duyệt có mục "Grants for this Change", ghi trong
`quality.yaml` ở khối `grants:` và được duyệt (băm, đóng băng) cùng gói:

```yaml
grants:
  push: { remote: origin, base: main }  # push Change Branch lên remote này và mở một PR (kể cả draft) vào base này
  envelope: true                        # tài nguyên miễn phí của provider đang dùng; migration đổi dữ liệu ở DB local/dev khi đảo ngược được và đã thử trên seed
  agent_runs: 30                        # trần số lượt chạy Agent; bỏ trống = 3 lần số task trong plan
```

Lúc `aidw approve`, aidw chốt Change Branch, remote cùng URL của nó và base vào `approval.push` (được băm cùng gói;
trang cổng duyệt hiện nhánh này trước khi bạn duyệt, và skill approve hỏi bạn giữ hay rút quyền push). Có quyền đó,
gate cho qua không hỏi đúng các lệnh `git push [-u] <remote> <Change Branch>`, `gh pr create --base <base> --head
<Change Branch> [--draft]` (body chỉ từ file `aidw pr` viết) và `aidw pr <id> --create`, chỉ cho Orchestrator (mọi
agent khác vẫn bị hỏi), không từ trong Task Worktree, chỉ khi change đang mở hoặc đã bàn giao, gói còn khớp hash và
URL của remote chưa đổi. Nhánh khác, remote khác, base khác, `--force`, `HEAD:`, lệnh nối chuỗi: vẫn hỏi. Push nhánh
của Task Worktree thì bị chặn hẳn. Envelope và trần chỉ được ghi lại (trong brief và trang cổng duyệt) để
Agent và vòng chạy đọc; gate không đoán được "miễn phí". Không bao giờ tự động, dù cấp gì: credential ngoài `.env`
của project, mọi thứ tốn tiền, deploy production, xóa dữ liệu cloud.

**Vì sao đôi lúc bạn thấy hộp thoại xác nhận:** gate hỏi `aidw approve` đúng một lần. Các lệnh bậc 3 hoặc lệnh
bậc 2 chưa nằm trong danh sách cũng hỏi. Hộp thoại lặp lại quá nhiều là dấu hiệu lệnh bị nhận nhầm: kiểm bằng
`grep '"ask"' ~/<tên project>-hooks.jsonl` rồi báo lại.

## 7. Chạy không cần trông: `aidw run` (cách chạy khuyên dùng)

**Bạn không phải gõ gì.** Ngay sau khi duyệt, `aidw approve` in một dòng `NEXT:` cho biết build ở đâu. CLI quyết định
theo số task còn lại (ngưỡng cố định là 3), không phải Claude:

| Số task | `NEXT:` | Việc phiên Claude Code làm |
|---|---|---|
| tối đa 3 | `build here: follow the /aidw:run steps` | build ngay trong phiên, như `/aidw:run` |
| hơn 3 | `start the runner: <plugin>/bin/aidw run <id> --detach --permission-mode auto` | tự chạy đúng lệnh đó (ngoài sandbox, vì runner mở các phiên Claude Code cần mạng và đăng nhập), báo bạn cách theo dõi rồi dừng |

Lệnh này chạy ngoài sandbox, và một lệnh gate cho phép thì không hiện thêm hộp thoại nào, nên gate chỉ cho phép không hỏi
khi **chuỗi lệnh trùng từng ký tự** với lệnh `aidw approve` vừa in cho đúng change đó (đường dẫn tuyệt đối
`<plugin>/bin/aidw`, không phải `aidw` trần vì PATH có thể bị cài file giả), từ phiên chính (không phải subagent, không phải
phiên do runner mở), khi change đó đã được duyệt, **và** plugin aidw được cài đặt (nằm trong một thư mục `.claude/plugins/`,
ngoài project). Khi aidw được nạp từ một thư mục (`--plugin-dir`, ví dụ lúc phát triển plugin), lệnh bật runner **hỏi bạn**:
bạn bấm đồng ý ở hộp thoại thì build bắt đầu; dòng `NEXT:` có ghi điều này. Mọi chuỗi khác có `--detach` cho change đã duyệt
cũng hỏi; `aidw run` chạy nổi trong phiên, trước khi duyệt hay cho change chưa duyệt thì bị chặn.

Runner chạy mọi phiên ở chế độ `auto`: sau cổng duyệt không còn gì hỏi bạn ([ADR-0014](adr/0014-after-the-approval-gate-the-run-does-not-ask-the-user.md)); việc vượt ngoài quyền đã cấp kết thúc
bằng *not built* chứ không chờ bạn; runner chạy tiếp tới pull request. Runner dừng ở đó: `DONE (archived)` sau một PR
ready, `STOPPED (draft)` sau một PR draft, kèm link PR và dòng `NEXT:`. Nếu bạn không cấp quyền push ở cổng duyệt, phiên
không người trông không thể trả lời câu hỏi push: nó chỉ viết body PR vào `.aidw/run/pr-<id>.md` và runner kết thúc với
`NEXT: aidw pr <id> --create [--draft]` để bạn tự mở (lệnh đó hỏi bạn), không bao giờ treo. Chạy lại `aidw run <id>` trên
một change đang là draft thì runner resume nó trước.

Theo dõi: `tail -f .aidw/run/runner.log`; xem trạng thái: `aidw run --status`; dừng: `aidw run --stop` (rồi `/aidw:resume`
để làm tiếp trong phiên). Nếu phiên không bật được runner (bạn từ chối hộp thoại, đã có runner khác chạy), tự gõ:

- **Ngay trong cửa sổ Claude Code đang mở:** `! aidw run <id> --detach --permission-mode auto`. Lệnh trả về ngay, vòng lặp chạy nền.
- **Ở terminal riêng** (chạy nổi, thấy log trực tiếp):

```bash
aidw doctor <id>        # kiểm máy trước: Chrome CDP, đăng nhập Vercel, store pnpm...
aidw run <id> --permission-mode auto -- --plugin-dir /đường/dẫn/plugins/aidw
```

(Cần `aidw` trong PATH: xem mục 2.) Lệnh là một vòng lặp tự động, không phải chạy từng task bằng tay:

- Nó mở `claude -p "/aidw:resume <id>"`, chờ phiên đó xong, rồi mở phiên mới, cho tới khi change được archive. Cách các phiên nối tiếp nhau và vì sao không xung đột: xem mục "Task, phiên và worktree" ở trên.
- **Rẻ hơn khoảng bốn lần** so với `/aidw:run` trong Claude Code: mỗi phiên bắt đầu khoảng 55K token thay vì một phiên phình tới 300K. Nó cũng bỏ các MCP server khỏi phiên (thêm `--keep-mcp` để giữ).
- Hết quota: chờ tới giờ reset trong thông báo lỗi, không có thì chờ 5, 10, 20, 40, 60 phút.
- Task `not_built`, lớp chất lượng hết vòng sửa, hay chạm trần Agent run không làm nó dừng: change đi tiếp tới giao hàng.
- Dừng khi escalated (chỉ còn những gì không bao giờ tự động), hoặc hai phiên liền không tiến triển. Log ở `.aidw/run/runner.log`.
- Nó không hỏi bạn được giữa chừng. Xử lý xong một escalation thì chạy lại đúng lệnh trên; nó tiếp tục từ chỗ dừng.
- Nếu muốn tạm dừng: Ctrl+C. Chạy lại lệnh sau là tiếp tục. Không mất gì.

Dùng `/aidw:run` tương tác trong Claude Code vẫn được (với kế hoạch tối đa 3 task, `start` và `approve` tự làm vậy), dành cho việc ngắn hoặc khi bạn muốn xem từng bước. Hãy gõ `/clear` trước (cuộc trò chuyện phân tích dài, mỗi lượt sau đều đọc lại toàn bộ).

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
    plan-review.yaml  các vòng review kiến trúc và kế hoạch trước cổng duyệt (CLI ghi, ngoài gói được duyệt)
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
| Change `escalated` | việc không bao giờ tự động, bạn tự dừng, hoặc task bạn escalate bằng tay | đọc lý do ở `/aidw:status`, xử lý, `/aidw:resume` |
| Task `not_built` | môi trường (Triage, blocker không Role nào trả lời được, máy chặn hai lần); hết 3 vòng sửa ngược; hoặc chạm trần Agent run | đọc mục "Needed from the user to finish" của PR draft (hoặc `not_built.reason` ở `/aidw:status`), làm theo, rồi `/aidw:resume` |
| `aidw run` dừng `draft` | run kết thúc bằng PR draft (hoặc chỉ body PR khi chưa cấp quyền push) | làm theo dòng `NEXT:` và mục "Needed" của PR; chạm trần thì `aidw cap <id> --raise <n>`; rồi `/aidw:resume` |
| `aidw run` dừng `no_progress` | hai session liền không đổi gì | đọc `.aidw/run/runner.log`, chạy `/aidw:status` |
| `aidw run` dừng `needs_user` ngay phiên đầu | `aidw doctor` có FAIL (chưa đăng nhập Vercel, project chưa có deployment nào nên lần deploy đầu là Production, Chrome CDP đóng) | làm theo dòng in ra rồi chạy lại đúng lệnh. Trước bước deploy, runner không dừng nữa: deploy lỗi thì PR mở dạng draft và ghi việc cần làm |
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
  commit lên `main`. aidw không tự merge; nó chỉ push branch đó và mở PR khi bạn đã cấp quyền ở cổng duyệt (nếu không thì hỏi).
