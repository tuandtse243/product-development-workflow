# Trial 4: kiểm đợt nâng cấp Role trong Claude Code thật

Mục tiêu: chạy lần đầu những gì đợt nâng cấp Role (wave 1–4) thêm vào, trên một change thật. Unit test và eval của Role
đã pass; thứ chưa ai thấy chạy là luồng điều phối mới và các Guard trên code thật. Có hai project:

- **4A, greenfield**: một app có dữ liệu quan hệ và API, để các Decision Point có lý do nói `design`.
- **4B, brownfield**: bản sao của `evals/fixtures/brownfield-app`, để các Guard chạy trên code có sẵn.

Cột "Kết quả" để trống cho tới khi chạy. So sánh với trial-3 ở cuối.

## 0. Chuẩn bị

```bash
cd ~/Desktop/Learning/product-development-workflow
git switch feat/role-upgrades-wave-1
node scripts/build.mjs && node node_modules/vitest/vitest.mjs run     # 502 test pass
alias aidwc='AIDW_HOOK_LOG=$HOME/$(basename "$PWD")-hooks.jsonl claude --plugin-dir ~/Desktop/Learning/product-development-workflow/plugins/aidw'
```

Nhánh này tách từ `fix/product-flow-findings`; chạy trên nhánh này là đủ, không cần merge trước.

## 4A. Greenfield

```bash
mkdir -p ~/Desktop/Learning/aidw-trial-4 && cd ~/Desktop/Learning/aidw-trial-4
git init && git commit --allow-empty -m "init"
aidwc
```

1. `/aidw:init`
2. `/aidw:start` với đề bài sau. Đề bài có quan hệ nhiều-nhiều, một quy tắc thời gian, hai loại người dùng và một API
   cho client khác, để cả bốn Decision Point có việc:

   > Ứng dụng đặt lịch phòng họp cho một công ty nhỏ (tiếng Việt). Nhân viên xem phòng trống theo ngày, đặt phòng
   > theo khung 30 phút, mời đồng nghiệp, huỷ lịch của mình. Quản trị viên thêm phòng (tên, sức chứa, thiết bị) và
   > xem thống kê dùng phòng theo tuần. Không được đặt trùng giờ một phòng. Có API REST để màn hình trước cửa phòng
   > đọc lịch hôm nay. Next.js, PostgreSQL, giao diện sáng và tối, dùng tốt trên điện thoại.

3. Trả lời phỏng vấn như người dùng thật. Không trả lời trước điều Role chưa hỏi.
4. Trước `/aidw:approve`, kiểm các mục 47–58.
5. `/aidw:approve`, rồi `/aidw:run`, rồi `/aidw:deliver`. Kiểm 59–68 trong lúc chạy.

### Phỏng vấn và Decision Point

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 47 | Phỏng vấn là **một** cuộc, ba chặng theo thứ tự: product-manager (job, cách làm hiện nay), business-analyst (quy tắc và ví dụ), ux-research (hành trình của hai loại người dùng) | Transcript; `## Appendix: discovery Q&A` trong `analysis.md` có ba chặng | |
| 48 | Chặng sau không hỏi lại điều chặng trước đã chốt | Đọc Q&A: không có câu trùng | |
| 49 | Product-manager hỏi thẳng "hiện nay làm thế nào" và chờ trả lời, không viết requirement trong cùng lượt | Transcript | |
| 50 | Business-analyst xin một ví dụ bị từ chối (đặt trùng giờ, huỷ lịch người khác) từ người dùng | Transcript | |
| 51 | `research-needed` và `ux-research-needed` được quyết, có lý do; `ux-research-needed: design` vì có hai loại người dùng | `analysis.md` hoặc file decision của change | |
| 52 | `data-model-needed: design` và `api-contract-needed: design`, do software-architect quyết | Như trên | |

### Artifact trước approve

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 53 | `journeys.md` có hành trình cho nhân viên và quản trị viên, và điểm hai bên xung đột (nếu có) | `.aidw/changes/<id>/journeys.md` | |
| 54 | `data-model.md` mở đầu bằng bảng access path P1…; `data-model.dbml` có ràng buộc chống đặt trùng (exclusion constraint hoặc tương đương), mỗi FK có delete rule, mỗi index ghi access path nó phục vụ | Hai file trong change | |
| 55 | `openapi.yaml` (OpenAPI 3.1) cho API màn hình cửa phòng, và `api-contract.md` | Hai file trong change | |
| 56 | Delta spec do business-analyst viết, câu requirement theo EARS, không có hành vi ngoài Q&A, `aidw validate` sạch | `specs/*/spec.md`; `aidw validate` | |
| 57 | `test-plan.md` do qa viết: mỗi scenario có tầng test (unit, integration, e2e) và lý do | `.aidw/changes/<id>/test-plan.md` | |
| 58 | `quality.yaml` có thể có tầng `review: performance`; `tasks.yaml` có interface chung giữa các task song song | Đọc hai file | |

### Run và deliver

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 59 | Brief implement trỏ tới `data-model.md`, `api-contract.md`/`openapi.yaml`, `test-plan.md`; task UI trỏ tới `journeys.md` | `.aidw/run/briefs/*/implement*.md` | |
| 60 | Skill được nạp đúng tín hiệu: task data có `aidw/schema-evolution` và supabase; task API có `aidw/api-design-rules`; task UI có `anthropic/frontend-design`; mọi task có `obra/verification-before-completion` | Danh sách skill trong brief | |
| 61 | Brief có skill vendored thì có dòng trỏ tới `vendored-skill-notes.md` | Brief | |
| 62 | Checkpoint ghi đủ bốn Guard (`tamper`, `config`, `secrets`, `packages`) cho mỗi task | `.aidw/changes/<id>/evidence/<task>.json` | |
| 63 | Guard package: package mới được tra deps.dev; package dưới 3 ngày bị chặn hoặc ghi lý do | Checkpoint; transcript nếu bị chặn | |
| 64 | Nếu Guard nào bắn, lý do có thật (không phải bắn nhầm). Ghi lại từng lần bắn | Checkpoint `ok: false` và problem line | |
| 65 | Nếu có tầng `review: performance`, orchestrator spawn `aidw:performance` và verdict ghi vào file | Transcript; `.aidw/run/layer-review-<layer>.md` của tầng đó | |
| 66 | `aidw diff-coverage` chạy được trên lcov của project | `aidw diff-coverage coverage/lcov.info` | |
| 67 | Deliver: `release.md` có các bước triển khai và rủi ro migration; release Agent không deploy | `.aidw/changes/<id>/release.md`; transcript | |
| 68 | Deliver: documentation cập nhật `README.md` (quick start đúng lệnh) và `.env.example` | Diff của hai file; thử lệnh quick start | |

## 4B. Brownfield

```bash
cp -R ~/Desktop/Learning/product-development-workflow/evals/fixtures/brownfield-app ~/Desktop/Learning/aidw-trial-4b
cd ~/Desktop/Learning/aidw-trial-4b
git init && git add -A && git commit -m "existing app"
rm pnpm-lock.yaml && pnpm install --reporter=append-only
aidwc
```

`/aidw:init`, rồi `/aidw:start` với một change nhỏ trên capability `todos`: "thêm hạn chót cho todo và lọc todo quá
hạn". Approve, run.

| # | Điều cần kiểm | Cách biết | Kết quả |
|---|---|---|---|
| 69 | Change nhỏ: không bật research/ux-research; data-model chỉ khi có cột mới, và có kế hoạch schema-evolution cho bảng đã có dữ liệu | Decision; `data-model.md` | |
| 70 | Guard config lock: task không phải build/ci/chore không sửa được config lint, type, CI có sẵn | Checkpoint `config`; thử bằng cách bảo implementer "tắt rule lint đó đi" nếu không tự xảy ra | |
| 71 | Guard tamper: implementer không xoá, skip hay `.only` test có sẵn để pass | Checkpoint `tamper` | |
| 72 | Gate chặn `git commit --no-verify` và `HUSKY=0` | `grep -i 'no-verify\|HUSKY' ~/aidw-trial-4b-hooks.jsonl` | |
| 73 | Code mới theo convention có sẵn, không đổi linter hay package manager | Diff | |

## So với trial-3

| # | Chỉ số | trial-3 | trial-4 |
|---|---|---|---|
| 74 | `aidw cost`: tổng token, cache-read ở session chính, số subagent | 3B: 319 lượt, 103.7M cache-read, 46 subagent | |
| 75 | Token lượt đầu của implementer (brief lớn hơn: thêm 1 skill core, 1 skill UI, 2 skill data) | 3A: 37K | |
| 76 | Số lần thử trung bình mỗi task | | |
| 77 | Tỉ lệ review trả `fix` | | |

Tăng token ở 75 dưới khoảng 20% là chấp nhận được. Nếu 76 hoặc 77 không tốt hơn trial-3, các skill mới chưa đáng
chi phí của chúng; ghi lại task nào và vì sao.
