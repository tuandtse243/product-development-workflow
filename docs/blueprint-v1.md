# Technical Implementation Blueprint v1

**Sản phẩm:** AI Fullstack Autonomous Development Workflow (tên tạm `aidw`, tên thật là OPEN)
**Ngày:** 2026-11-08
**Runtime:** Claude Code 2.1.319 (đã kiểm chứng trên máy phát triển)
**Tài liệu liên quan:** `docs/decisions-log.md` (mọi quyết định có ID)

Nhãn dùng trong tài liệu: **[C]** CONFIRMED · **[P]** PROPOSED · **[O]** OPEN · **[V]** đã kiểm chứng bằng spike.
Không có đề xuất [P] nào được tự động xem là yêu cầu. Muốn chuyển một mục [P] thành [C] thì phải ghi vào decisions-log.

---

## 0. Tóm tắt

`aidw` là một **Analysis-Gated Autonomous Development System** [C Q2, D-18]. Người dùng đưa vào một idea, PRD, JD hoặc codebase. Hệ thống phân tích và đóng gói kết quả thành một **Analysis package**, rồi người dùng duyệt **một lần**. Sau đó hệ thống tự thiết kế, xây dựng, kiểm thử theo nhiều lớp, đối chiếu với spec, deploy theo strategy đã duyệt, và bàn giao một **Complete Delivery Package**.

Lõi tự viết là **orchestration + governance**: state, gate, permission tiers, scheduler, evidence, resume, delivery. Bề mặt được ghép từ những thực hành đã kiểm chứng: Matt Pocock (product và requirements), Addy Osmani (engineering), OpenSpec (mô hình living spec) và Spec Kit (constitution, clarify, analyze, converge) [C D-18..D-20].

---

## 1. Định vị và mô hình 4 lớp [C D-18]

```
+------------------------------------------------------------------+
| L1 SKILLS          day AI LAM tung nghiep vu (craft)             |
| L2 SPEC FRAMEWORK  cai gi la SU THAT, cai gi DANG THAY DOI       |
| L3 ORCHESTRATION   AI NAO lam GI, KHI NAO, song song/tuan tu     |
| L4 RUNTIME/TOOLING Claude Code, git, worktree, browser, DB, CI   |
+------------------------------------------------------------------+
  + GOVERNANCE (xuyen lop): gate, tiers, evidence, resume, delivery
```

| Hệ thống | L1 | L2 | L3 | L4 | Thiếu gì để thành hệ tự chủ |
|---|---|---|---|---|---|
| Addy agent-skills | mạnh | yếu | `/build auto` chạy tuần tự | - | Không có state bền vững, gate, scheduler song song |
| Pocock skills | mạnh (product) | vừa | `to-tickets` + `implement-spec` | - | Không có governance, resume, evidence |
| OpenSpec | - | mạnh | - | - | Không có orchestration, quality |
| Spec Kit | - | mạnh | yếu | - | Không có archive/delta theo thời gian |
| Claude Code | - | - | subagent, worktree | mạnh | Không có quy trình |

**Kết luận:** phần còn thiếu chính là sản phẩm này, gồm L3 và governance.

```
L2 SPEC        .aidw/ (mo hinh OpenSpec: specs / changes / delta / archive)
               + Spec Kit: constitution | clarify | analyze | converge
                   ^ ghi boi
L1 PRODUCT     Pocock: grill-me, grilling, grill-with-docs, domain-modeling,
               to-spec, to-tickets   (adapter -> format .aidw)
                   |
L3 ORCHESTRATE engine orchestrator = mau Pocock implement-spec
               + state/gate/touches/evidence/resume (bin/aidw + hooks)
               tham khao vong lap 1 task cua Addy /build auto
                   |
L1 ENGINEERING Addy: TDD, incremental, frontend-ui, api, browser-testing, security,
               performance, code-review, debugging, git, ci-cd, shipping, docs-adrs
                   |
L4 RUNTIME     Claude Code plugin (skills, agents, hooks, bin/, worktrees, headless)
               git, Playwright, axe-core, Lighthouse, Supabase CLI, Vercel CLI
```

---

## 2. Ràng buộc đã chốt (tóm tắt, chi tiết ở decisions-log)

- Input là mọi loại. Golden path là greenfield từ idea/JD. Phạm vi là mọi loại web [C Q1, D-03, D-04].
- Chỉ có một gate là Analysis. Production cần duyệt riêng (bậc 3) [C Q2, Q6, D-08].
- Stack: khách > AI (chọn trong tập quen dùng) > fallback Next.js + Supabase + Tailwind/shadcn + Vercel [C D-05..D-07].
- Có 5 bậc quyền [C D-08]. Chạy local có theo dõi, khoảng 2–3 giờ, resume là bắt buộc, khi hết quota thì chờ rồi chạy tiếp [C D-09, D-10].
- Plugin cài ở scope user, không khóa version [C D-11]. Spec system tự xây, không phụ thuộc OpenSpec [C D-12]. Core deterministic viết bằng Node/TS [C D-13].
- Phạm vi v1.0 là tất cả trừ demo video [C D-14].

---

## 3. Flow nghiệp vụ end-to-end (17 bước) [C cấu trúc / P chi tiết]

| # | Bước | Input | Output (`.aidw/`) | Owner | Exit khi |
|---|---|---|---|---|---|
| 0 | Init | repo trống hoặc có sẵn | skeleton `.aidw/`, `project.yaml`, `constitution.md` | engine `aidw:init` | `aidw validate` pass |
| 1 | Intake | idea / PRD / JD / code | `changes/<id>/intake.md` (loại input, nguồn, ràng buộc của khách, stack khách yêu cầu nếu có) | engine (input adapter) | đã phân loại, ghi rõ nguồn |
| 2 | Discovery / Grill | intake | Q&A, assumptions, out-of-scope (trong `analysis.md`) | Pocock grill-* + Spec Kit clarify | không còn ambiguity nào **chặn** |
| 3 | Domain model | kết quả grill | `domain/model.md` (entity, relation, business rule, glossary) | Pocock domain-modeling | thuật ngữ và rule thống nhất |
| 4 | Requirements & specs | domain + grill | `requirements/*.md`, delta `changes/<id>/specs/<cap>/spec.md` | Pocock to-spec (adapter) | mọi requirement có ≥1 Scenario WHEN/THEN |
| 5 | Design decision | assets? + yêu cầu | design mode + `design/` (direction / bundle / refs) | engine design-mode (+ người dùng nếu chọn Claude Design) | mode đã chọn, đủ dữ liệu cho UI review |
| 6 | Architecture & stack | specs + constitution | `architecture/overview.md`, ADR, stack kèm nguồn | architect agent (Addy api-design, docs-adrs) | stack có nguồn + lý do |
| 7 | Plan | specs + architecture | `changes/<id>/tasks.yaml` (task contract) | Pocock to-tickets (adapter) | mọi task có `verify` + `touches` |
| 8 | Quality, deploy & permissions | loại project, mức rủi ro | quality profile, deploy strategy, danh sách quyền bậc 2 (trong `analysis.md`) | engine | layer + ngưỡng + quyền đã rõ |
| 9 | **Analyze** | tất cả ở trên | báo cáo nhất quán | `aidw analyze` + Spec Kit analyze | 0 lỗi chặn |
| | **GATE** | Analysis package | `approval` (hash) trong `change.yaml` | **người dùng** → `aidw approve` | đã duyệt |
| 10 | Design execution | `design/` | UI foundation, tokens | frontend-engineer | theo design mode |
| 11 | Build (theo wave) | `tasks.yaml` | code, mỗi task một commit | orchestrator + specialist agents | task `done` **có evidence** |
| 12 | Integration | sau mỗi wave | build + test tích hợp | orchestrator + qa-engineer | wave xanh |
| 13 | Verify layers | code | `evidence/<layer>/` | qa / ui / security / code reviewer | đạt ngưỡng của quality profile |
| 14 | **Converge** | specs ↔ code | task bổ sung (nếu thiếu) | `aidw converge` + Spec Kit converge | mọi Scenario có test pass, nếu chưa thì quay lại 11 |
| 15 | Deploy | strategy đã duyệt | URL preview/staging | Addy shipping, ci-cd | smoke test pass. Production là bậc 3, phải hỏi |
| 16 | Sync & archive | delta specs | `specs/` cập nhật, `archive/` | `aidw archive` (merge deterministic) | validate pass |
| 17 | Deliver | `.aidw/` + evidence | `changes/<id>/delivery/`, `docs/` cho khách | engine + Addy docs | đủ checklist §14 |

**Bước 2–9 gộp lại là "Analysis".** Bước 9 là chốt tự kiểm tra trước khi đưa người dùng duyệt.
**Bước 11–14 là một vòng lặp:** build → integrate → verify → converge, thiếu thì quay lại build.

---

## 4. State machine của một change [P]

```
 draft -> intake -> analyzing -> awaiting_approval --approve--> approved
                       ^               |  request_changes            |
                       +---------------+                             v
                                                                 executing <---------+
                                                                 |   ^   |           |
                                                   rate_limit    |   |   | wave done |
                                                    +------------+   |   v           |
                                                    v                | verifying     |
                                                 paused --resume-----+   |           |
                                                                          v           |
                                                                      converging --gap+
                                                                          | ok
                                                                          v
                                                                      deploying -> delivered -> archived
 bat ky trang thai sau approved:  escalated (bac 3 / vuot scope / het retry) --user--> tiep tuc | sua analysis
```

- Chuyển trạng thái **chỉ qua `bin/aidw`**. Lệnh này kiểm tra điều kiện trước khi đổi (ví dụ không thể `executing` nếu chưa `approved`).
- Nếu sửa Analysis package sau khi đã approve thì hash lệch (drift) và mọi transition sau approve bị chặn. Riêng `escalated` vẫn vào được, vì đó là lối thoát. Đường quay lại là `escalated → analyzing`, bước này xóa approval cũ, rồi trình duyệt lại. [V test S1]
- `paused` ghi lại `paused.from`. Lệnh `aidw transition <id> resume` đưa change về đúng state trước đó.
- Hash bao gồm: `intake.md`, `analysis.md`, `design.md`, delta `specs/**`, `tasks.yaml` (chỉ các trường kế hoạch: bỏ `status`, `attempts`, `evidence`... và bỏ task có `origin: converge`), `constitution.md`, `design/**`, `domain/**`, `architecture/**`, `requirements/**`. Tiến độ thực thi vì vậy **không** bị tính là drift. `decisions/` không nằm trong hash vì có thể phát sinh ADR mức implementation trong lúc thực thi. (Phần domain, architecture và requirements được thêm sau khi chạy thử S2 phát hiện chúng bị bỏ sót.)

---

## 5. Project knowledge: `.aidw/` [C D-12 / P chi tiết]

Phủ đủ 7 nhóm knowledge của Q7.

```
<project>/.aidw/
+-- project.yaml              stack (+ source: client|ai|fallback, ly do), design mode mac dinh,
|                             deploy targets, quality profile mac dinh, engine version (truy vet)
+-- constitution.md           nguyen tac ky thuat xuyen suot, coding standards, profile stack
+-- requirements/             business requirements, user stories, acceptance       [Requirements]
+-- specs/<capability>/spec.md  hanh vi HIEN TAI cua he thong                         [Specifications]
+-- domain/model.md           entity, relationship, business rules, glossary         [Domain]
+-- architecture/overview.md  kien truc, stack, folder structure                     [Architecture]
+-- decisions/NNNN-<slug>.md  ADR                                                    [Decisions]
+-- design/                   tokens, references, bundle Claude Design, anh chuan
+-- changes/<id>/                                                                    [Implementation]
|   +-- change.yaml           state, approval{hash,at}, resume pointer, session id
|   +-- intake.md
|   +-- analysis.md           Analysis package (xem §6)
|   +-- specs/<cap>/spec.md   delta: ADDED / MODIFIED / REMOVED / RENAMED
|   +-- tasks.yaml            task graph (xem §9)
|   +-- evidence/<layer>/     ket qua tung quality layer, tung task
|   +-- delivery/             goi ban giao
+-- archive/<YYYY-MM-DD>-<id>/                                                       [Synchronization]
+-- run/                      runtime: paused.json, locks, logs (khong phai su that nghiep vu)
```

### 5.1 Ngữ pháp spec (học từ OpenSpec, tự viết lại) [P]

```markdown
# <Capability>

## Purpose
<1-2 cau>

## Requirements

### Requirement: <ten, mot hanh vi>
<The system SHALL ...>   (<= 500 ky tu, SHALL/MUST)

#### Scenario: <ten>
- **GIVEN** <tien dieu kien>        (tuy chon)
- **WHEN** <trigger>
- **THEN** <ket qua quan sat duoc>
```

- Mỗi requirement có ít nhất một Scenario. Scenario phải có WHEN (hoặc GIVEN) và THEN.
- Scenario là **nguồn của E2E/integration test** (bước 13) và của **converge** (bước 14). Mỗi Scenario có ID ổn định: `<capability>/<requirement-slug>/<scenario-slug>`.

### 5.2 Delta và merge [P]

| Section | Quy tắc | Merge |
|---|---|---|
| `## ADDED Requirements` | Block mới hoàn chỉnh | Thêm vào cuối spec chính. Báo lỗi nếu trùng tên |
| `## MODIFIED Requirements` | Copy **nguyên block cũ** rồi sửa, header phải khớp | Thay thế block có header khớp chính xác. Báo lỗi nếu không tìm thấy |
| `## REMOVED Requirements` | Header + **Reason** + **Migration** | Xóa block |
| `## RENAMED Requirements` | `FROM:` / `TO:` | Đổi header |

`aidw validate` chạy thử merge mà không ghi file. `aidw archive` merge thật bằng code, **không bao giờ để LLM merge**.

### 5.3 Ví dụ `change.yaml` [P]

```yaml
id: 2026-11-08-booking-clinic
title: Booking app cho phong kham nho
input_type: upwork_jd
state: executing
approval:
  hash: sha256:...        # hash cua analysis.md + specs/ + tasks.yaml + design/ refs
  at: 2026-11-08T10:12:00Z
  by: user
run:
  session_id: ...
  current_wave: 3
  paused: null            # {reason: rate_limit, at, retry_after?}
engine_version: 0.1.0     # chi de truy vet
```

---

## 6. Analysis package và gate [C Q2 / P format]

Package phải **duyệt được trong 15–30 phút**. Nếu dài quá, người dùng sẽ không đọc kỹ và gate thành hình thức.

```
analysis.md
  1. TOM TAT 1 TRANG: muc tieu, scope, 5-10 quyet dinh chinh, RUI RO & GIA DINH noi bat
  2. Requirements & scope (in / out), assumptions
  3. Domain model (tom tat, link domain/model.md)
  4. Stack: lua chon + nguon (client|ai|fallback) + ly do; neu ngoai tap quen dung -> ly do
  5. Design mode + direction / bundle / refs
  6. Architecture + ADR moi
  7. Specs (link delta), so requirement / scenario
  8. Plan: so task, so wave, task song song, agent can dung
  9. Quality profile: layer nao chay, nguong
 10. Deploy strategy (local / preview / staging / production-can-hoi)
 11. QUYEN BAC 2 xin cap (tung tai nguyen)
 12. Ket qua `aidw analyze`
  Phu luc: Q&A grill day du
```

Người dùng phản hồi theo một trong hai hướng:
- **Approve:** `aidw approve` ghi hash vào `change.yaml`, state chuyển sang `approved`.
- **Request changes:** quay lại bước tương ứng (2–8), chạy lại Analyze rồi trình duyệt lại.

---

## 7. Skill inventory và phân vai [C D-16, D-17, D-19, D-20]

### 7.1 Matt Pocock (`mattpocock/skills`, MIT, v1.3.2): product, requirements, orchestration pattern

| Dùng | Bước | Cách dùng |
|---|---|---|
| `grill-me`, `grilling`, `grill-with-docs` | 2 | Grill có adapter: kết quả ghi vào `analysis.md` |
| `domain-modeling` | 3 | Ghi ra `domain/model.md` |
| `to-spec` | 4 | Adapter ép output về ngữ pháp spec ở §5.1 |
| `to-tickets` | 7 | Adapter ép output về task contract ở §9 |
| `implement-spec` | 11 | **Mẫu orchestration** (subagent + worktree + tích hợp). Engine bọc thêm state, touches, evidence, resume |

**Loại** (phần engineering thuộc về Addy): `tdd`, `code-review`, `diagnosing-bugs`, `implement`, `codebase-design`, `improve-codebase-architecture` (xem lại ở S10), `prototype`, `pr`, `triage`, `wayfinder`, `wizard`, `research`, `retro`, `ask-matt`, `setup-matt-pocock-skills` và các skill productivity khác.

### 7.2 Addy Osmani (`addyosmani/agent-skills`, MIT, v0.6.15): engineering execution và quality

| Dùng | Gắn vào |
|---|---|
| `incremental-implementation`, `test-driven-development` | frontend, backend, database engineer |
| `frontend-ui-engineering` | frontend-engineer, ui-reviewer |
| `api-and-interface-design` | backend-engineer, architect, database-engineer |
| `browser-testing-with-devtools` | qa-engineer, ui-reviewer |
| `security-and-hardening` | security-reviewer |
| `performance-optimization` | qa-engineer (perf layer) |
| `code-review-and-quality` | code-reviewer |
| `debugging-and-error-recovery` | mọi implementer (vòng fix) |
| `git-workflow-and-versioning` | orchestrator |
| `ci-cd-and-automation`, `shipping-and-launch` | bước 15 |
| `documentation-and-adrs` | architect, bước 17 |

**Loại** (trùng vai với L2 và Pocock): `spec-driven-development`, `planning-and-task-breakdown`, `interview-me`, `idea-refine`. `/build auto` chỉ dùng làm tham khảo cho vòng lặp một task.
**Xem xét sau** [O]: `observability-and-instrumentation`, `context-engineering`, `source-driven-development`, `constraint-driven-development`, `doubt-driven-development`, `deprecation-and-migration` (có thể dùng cho brownfield), `code-simplification`.

### 7.3 Vendor và đồng bộ [C D-17 / P cơ chế]

```
plugins/aidw/vendor/
  pocock/<skill>/...   addy/<skill>/...
  LICENSE.pocock  LICENSE.addy          (MIT notice goc)
  UPSTREAM.md                           repo, commit sha, ngay sync, danh sach skill chon
aidw vendor sync [pocock|addy]  -> clone upstream tam, diff voi ban vendor,
                                   hien thay doi tung skill, nguoi dung chon nhan/bo, cap nhat UPSTREAM.md
```

- **Chống tranh việc:** skill vendor **không** đăng ký như skill cấp plugin tự kích hoạt. Chúng chỉ được nạp qua trường `skills:` của agent, hoặc được skill engine gọi tường minh. [P, cách hiện thực cần kiểm chứng ở S2: có thể phải đặt ngoài `skills/` của plugin để không tự load]
- **Adapter:** mỗi skill dùng ở bước 2–7 có một wrapper của engine. Wrapper nêu output đích và format, còn nội dung kỹ thuật thì giữ nguyên của upstream.

### 7.4 Skill do engine tự viết [P]

`aidw:init`, `aidw:start` (bước 1–9), `aidw:approve`, `aidw:run` (bước 10–17, orchestrator), `aidw:resume`, `aidw:status`, `aidw:deliver`, `aidw:design-mode`, `aidw:quality` (runner cho các layer), cùng các adapter cho skill của Pocock.

---

## 8. Agent roster [C Q4 / P chi tiết]

> **Cập nhật S3 (D-23, đóng OPEN-10):** task được cắt theo lát dọc (Pocock `to-tickets`), nên phần thực thi dùng
> **hai agent**: `aidw:implementer` (một lát, context mới, skill chọn theo task) và `aidw:reviewer` (chỉ đọc,
> context mới). Các vai chuyên môn trong bảng dưới không còn là agent riêng khi implement: chúng trở thành
> **bộ skill** do `aidw skills` chọn theo `touches`/`risk`/`verify`. Các reviewer chuyên biệt (ui, security,
> qa) vẫn là kế hoạch cho S4/S7. Chi tiết ở §24.

**Orchestrator = phiên chính** chạy skill `aidw:run`, **không phải subagent** [P-01]. Lý do:
1. Phiên chính spawn được subagent và nói chuyện được với người dùng khi có escalation.
2. State nằm hoàn toàn trong `bin/aidw`.

| Agent | Skill nạp sẵn | Tool | Quyền ghi (hook theo `agent_type`) |
|---|---|---|---|
| architect | Addy api-design, docs-adrs | Read, Grep, Glob, Write | `.aidw/architecture/**`, `.aidw/decisions/**` |
| frontend-engineer | Addy frontend-ui, incremental, TDD | đủ bộ | theo `touches` của task |
| backend-engineer | Addy api-design, incremental, TDD | đủ bộ | theo `touches` |
| database-engineer | Addy api-design + profile DB | đủ bộ | `touches`. Migration chỉ chạy local (bậc 1) |
| qa-engineer | Addy browser-testing, TDD, performance | đủ bộ | `tests/**`, `e2e/**`, `.aidw/changes/*/evidence/**` |
| ui-reviewer | Addy frontend-ui, browser-testing | Read, Bash (playwright) | chỉ evidence |
| security-reviewer | Addy security-and-hardening | Read, Grep, Bash (read-only) | chỉ evidence |
| code-reviewer | Addy code-review-and-quality | Read, Grep, Glob | chỉ evidence |

- Agent chỉ được tạo khi project cần [C Q4].
- **Implementer không tự xác nhận.** Evidence của các layer test, UI, security và review phải do agent khác tạo ra [C Q5].
- Subagent của plugin bỏ qua `permissionMode` (theo tài liệu). Vì vậy giới hạn quyền đặt ở `tools`/`disallowedTools` và **hook cấp plugin theo `agent_type`** [V spike: input của hook có `agent_type`].
- Context truyền cho subagent chỉ gồm task contract, các requirement/scenario liên quan, `constitution.md`, phần `design/` liên quan và ADR liên quan. **Không truyền lịch sử chat.**

---

## 9. Orchestration, scheduler và worktree [C Q4, D-19 / P chi tiết]

### 9.1 Task contract (`tasks.yaml`, độc lập runtime theo Q8)

```yaml
- id: T07
  title: Booking API - create appointment
  role: backend-engineer
  specs: [booking/create-appointment]          # requirement ids
  scenarios: [booking/create-appointment/slot-taken]
  depends_on: [T03, T05]
  touches: ["app/api/bookings/**", "lib/booking/**"]
  risk: normal                                 # normal | high (high -> tuan tu)
  verify:
    - pnpm vitest run lib/booking
    - pnpm tsc --noEmit
  status: pending        # pending|running|review|done|failed|blocked|escalated
  attempts: 0
  max_attempts: 3
  evidence: evidence/tasks/T07.md
```

### 9.2 Lập lịch

```
loop:
  ready = { t | t.status=pending, moi depends_on da done }
  wave  = tap con lon nhat cua ready sao cho:
            touches doi mot KHONG giao nhau, risk != high, <= N agent (cau hinh)
  neu |wave| >= 2:  moi task -> subagent isolation: worktree, nhanh rieng
                    xong -> code-reviewer -> merge vao nhanh change theo thu tu id
  nguoc lai:        chay tuan tu tren nhanh change
  sau wave: INTEGRATION VERIFY (build + test bi anh huong) -> fail -> task sua loi
  moi task done: commit + `aidw checkpoint T07` (cap nhat tasks.yaml)
```

- **Merge conflict:** trước hết code-reviewer hoặc orchestrator thử giải quyết. Không được thì bỏ nhánh, đặt task về `pending` với `risk: high` và chạy lại tuần tự trên nhánh change mới nhất.
- Mặc định tối đa khoảng 20 subagent chạy đồng thời. Có thể cấu hình độ sâu lồng nhau (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). [Tài liệu]
- [O] `isolation: worktree` có hoạt động với **plugin** agent không: cần kiểm chứng ở S8.

---

## 10. Design modes [C Q3 / P cách làm]

| Mode | Trước gate | Sau gate | Chuẩn cho UI review |
|---|---|---|---|
| Existing Design | Đọc Figma (Figma MCP), ảnh chụp hoặc design system, lưu vào `design/` | Implement bám theo design | So khớp layout, pixel với tham chiếu |
| Claude Design | **Người dùng thiết kế trong Claude Design** rồi export ("Send to local coding agent"), engine nhận bundle vào `design/` [P-04] | Implement theo bundle | Bundle |
| AI Design & Implement | AI viết design direction (tokens, bố cục chính, tính cách thị giác) **đưa vào Analysis để duyệt** | Implement trực tiếp | Direction và tokens |
| Hybrid | Ghi rõ phần nào lấy theo tham chiếu, phần nào AI làm | | Kết hợp hai nguồn |

[O] Claude Design không có API công khai (nguồn thứ cấp). Cần xác nhận định dạng bundle khi tới S6.

---

## 11. Quality layers [C Q5 / P cơ chế]

~~Mỗi layer là một thư mục `plugins/aidw/quality/<layer>/layer.yaml`.~~ **Đổi ở S4 (D-24):** layer là các mục trong `.aidw/changes/<id>/quality.yaml` của từng project (tên tùy ý, chạy theo thứ tự), nằm trong package được duyệt. Hướng dẫn và lệnh gợi ý theo stack ở `plugins/aidw/profiles/quality-layers.md`. Thêm layer mới không cần sửa core. Xem §25.

| Layer | Công cụ / agent | Evidence |
|---|---|---|
| code | eslint, prettier --check, tsc, build | log + exit code |
| unit | vitest | report |
| integration | vitest + Supabase local: API, DB, auth, RLS/permissions | report |
| e2e | Playwright, mỗi Scenario một test (có ID) | report + trace |
| ui-ux | ui-reviewer: screenshot nhiều viewport so với `design/`, responsive | ảnh + nhận xét |
| a11y | axe-core qua Playwright + kiểm tra keyboard | report |
| security | npm audit, quét secret, security-reviewer (OWASP, authz, RLS) | report |
| performance | Lighthouse (Core Web Vitals), bundle size, thời gian API | report |
| review | code-reviewer độc lập | nhận xét |

- **Quality profile** (duyệt trong Analysis) quyết định layer nào chạy và ngưỡng của từng layer.
- Vòng sửa lỗi: `fail → debugging-and-error-recovery → fix → chạy lại layer bị ảnh hưởng`. Có giới hạn số lần thử. Quá giới hạn thì `escalated`, ghi trung thực vào quality report, **không lặng lẽ bỏ qua**.
- **Cưỡng chế:** `aidw checkpoint` từ chối đánh dấu `done` nếu thiếu evidence bắt buộc. [O] Nên gắn thêm vào hook `TaskCompleted` hoặc `SubagentStop`, chọn ở S4.
- **Converge (bước 14):** `aidw converge` đối chiếu mọi Scenario ID với kết quả test. Scenario nào chưa có test pass thì sinh task bổ sung.

---

## 12. Permissions và cưỡng chế [C D-08 / V spike / P chi tiết]

| Bậc | Ví dụ | Cơ chế |
|---|---|---|
| 0 | sửa code, npm install, test, commit nhánh riêng | allow sau approve |
| 1 | Supabase local, migration local, seed giả | allow sau approve |
| 2 | Supabase project dev, Vercel preview, env preview | allow **chỉ khi có trong allowlist** của Analysis đã duyệt |
| 3 | tốn tiền, production, domain, email/payment thật, xóa dữ liệu cloud, push repo khách | `ask` / escalated |
| x | đọc secret ngoài `.env` của project, credential cá nhân | luôn `deny` |

**Các lớp cưỡng chế:**
1. **PreToolUse (Write|Edit|Bash)** do plugin hook gọi `aidw gate`:
   - `.aidw/**` → `allow` (vượt qua permission prompt khi chạy headless) [V]
   - chưa approve mà ghi ra ngoài `.aidw/` → `deny` [V cả phiên chính lẫn subagent của plugin]
   - Bash có dấu hiệu ghi file khi chưa approve → `deny` [V với `echo >`]
   - deny list cho lệnh nguy hiểm, deploy production, đọc secret
   - kiểm tra theo `agent_type` (ví dụ reviewer không được ghi) và theo `touches` của task đang chạy [P]
2. **Stop hook (lưới an toàn):** `git status` → báo cáo thay đổi ngoài `.aidw/` khi chưa approve, hoặc ngoài `touches` khi đã approve [V: bắt được `python3` ghi file lọt qua heuristic]
3. **PostToolUse `bashEditDiff`** (nếu có) để ghi nhận file bị Bash thay đổi [O]

**Giới hạn được thừa nhận:** heuristic cho Bash **không** chặn được mọi cách ghi file (ví dụ `python3 -c`) [V]. Nguyên tắc vì vậy là chặn càng nhiều càng tốt ở PreToolUse, và **phát hiện chắc chắn** ở Stop hook. Thay đổi ngoài phạm vi bị phát hiện thì revert hoặc escalate.

---

## 13. Lỗi, retry, resume, quota [C D-10 / P chi tiết]

- **Checkpoint:** mỗi task một commit. Trạng thái nằm trong `tasks.yaml` và `change.yaml`. Bị ngắt giữa task thì làm lại task đó từ commit trước.
- **Retry:** `attempts < max_attempts` thì debugging rồi thử lại. Quá giới hạn thì `escalated`.
- **Hết quota:** hook `StopFailure` (matcher `rate_limit`) ghi `.aidw/run/paused.json` [Tài liệu: có các giá trị error `rate_limit`, `overloaded`...]. Phục hồi theo hai mức:
  - Mức 1 (mốc A): người dùng gõ `/aidw:resume`.
  - Mức 2 (S9): runner `aidw run` chạy headless `claude -p --resume <session> --permission-mode <...>`, chờ hoặc backoff rồi chạy tiếp. Chạy `-p` thì phải truyền lại permission mode.
- **Context dài:** mọi thứ cần để chạy tiếp nằm trong `.aidw/`, nên auto-compact không làm mất tiến độ.

---

## 14. Complete Delivery Package [C Q10, D-14]

`changes/<id>/delivery/`, kèm `docs/` cho khách nếu được yêu cầu:
- README và handoff notes, template `.env`, hướng dẫn deploy, hướng dẫn sử dụng
- Analysis report, kế hoạch, trạng thái task
- Quality report (mọi layer, có evidence, nêu rõ cả phần fail và giới hạn)
- Screenshots (không có demo video)
- ADR và các quyết định kỹ thuật
- Known issues, next steps
- Trạng thái deploy và URL

---

## 15. Stack profiles [C Q9, D-05..D-07 / P cơ chế]

`plugins/aidw/profiles/<id>/`: `profile.yaml` (detect rules, lệnh scaffold, lệnh cho từng quality layer), conventions, skill riêng của stack.
Profile đầu tiên là `nextjs-supabase-vercel` (fallback). Các profile tiếp theo: `vite-react`, `nestjs`, `express`, `prisma`/`drizzle`, `mongodb`, cùng các deploy target `railway`, `cloudflare`, `docker`.
Với brownfield, engine **suy ra** profile từ code hiện có và không tự ý migrate.

---

## 16. `bin/aidw` CLI (Node/TS) [C D-13 / P lệnh]

| Lệnh | Việc |
|---|---|
| `aidw init` | Tạo `.aidw/`, phát hiện brownfield, chọn profile |
| `aidw status [--json]` | State của change, task, wave, paused |
| `aidw validate` | Kiểm tra cấu trúc, ngữ pháp spec, chạy thử merge |
| `aidw analyze` | Kiểm tra nhất quán giữa requirement, spec, task, scenario và test plan |
| `aidw approve` | Băm hash package, chuyển state |
| `aidw gate` | Entry point cho PreToolUse hook (đọc stdin, trả decision) |
| `aidw next` | Tính ready set và wave tiếp theo |
| `aidw checkpoint <task>` | Kiểm tra evidence rồi đánh dấu task done |
| `aidw evidence add/check` | Quản lý evidence |
| `aidw converge` | Đối chiếu Scenario với test, sinh task bổ sung |
| `aidw archive` | Merge delta vào specs, chuyển change vào archive |
| `aidw pause/resume-info` | Quota, thông tin resume |
| `aidw run` | Runner headless có chờ khi hết quota (S9) |
| `aidw vendor sync` | Đồng bộ skill upstream có diff |
| `aidw deliver` | Dựng delivery package |

Yêu cầu: ít dependency, có unit test (đặc biệt merge, validate, hash, gate), output `--json` cho skill và hook đọc.

---

## 17. Cấu trúc repo [P]

```
product-development-workflow/
+-- .claude-plugin/marketplace.json       repo = marketplace
+-- plugins/aidw/
|   +-- .claude-plugin/plugin.json
|   +-- skills/        (aidw:init, start, approve, run, resume, status, deliver, ...)
|   +-- agents/        (architect, frontend-engineer, ..., code-reviewer)
|   +-- hooks/hooks.json
|   +-- bin/aidw       (build tu src/)
|   +-- quality/<layer>/   profiles/<stack>/   templates/
|   +-- vendor/pocock/  vendor/addy/  (+ LICENSE.*, UPSTREAM.md)
+-- src/               TypeScript cua aidw CLI
+-- tests/             unit test CLI + hook
+-- evals/fixtures/    greenfield-jd/, brownfield-app/ (sau)
+-- docs/              blueprint-v1.md, decisions-log.md
```

Vòng dev: `claude --plugin-dir ./plugins/aidw` trong thư mục fixture. Cài thật: `claude plugin marketplace add <repo>` rồi `claude plugin install aidw --scope user` [V CLI có các lệnh này].

---

## 18. Thứ tự xây và tiêu chí [C D-15, D-22]

| Slice | Nội dung | Exit |
|---|---|---|
| S1 | `aidw` CLI: format `.aidw/`, validate, merge, hash, status + unit test | Test pass, merge deterministic. **Xong 2026-11-08**: init, change new, status, validate, approve, approval check, transition, merge, archive; 31 test |
| S2 | `init`, `start` (adapter Pocock), analysis package, `analyze`, `approve`, gate hook | Tiêu chí [1][2][3]. **Code xong 2026-11-08** (xem §23); [2][3] có test, [1] chờ chạy thật |
| S3 | Orchestrator tuần tự, task contract, checkpoint, `/aidw:resume` | [4][5]. **Code xong 2026-11-08** (xem §24); [4][5] có test và chạy thử bằng bin, chờ chạy với Claude Code thật |
| S4 | Quality: code/unit/integration/e2e, preview deploy | [6]. **Code xong 2026-11-08** (xem §25); có test và chạy thử bằng bin với deploy giả, chờ project Next.js thật + Vercel thật |
| S5 | Converge, archive/merge, deliver | [7][8] → **Mốc A**. **Code xong 2026-11-08** (xem §26); cả 8 tiêu chí có test và đã chạy thử trọn bằng bin, chờ một lần chạy thật với Claude Code |
| S6 | 4 design mode + tuân thủ thiết kế và Analysis (D-26) | code xong (§28) |
| S7 | Các layer ui-ux, a11y, security, perf và reviewers (D-28) | code xong (§30), chờ trial-3 |
| S8 | Song song + worktree + integration verify (D-29) | code xong (§31), chờ trial-3 |
| S9 | Auto-resume khi hết quota (`aidw run`, D-30) | code xong (§31), chờ trial-3 |
| S10 | Brownfield: assessment, lazy baseline spec, profile detect, fixture brownfield (D-31) | code xong (§31), chờ trial-3 → **Mốc B = v1.0** |

**Tiêu chí mốc A** (chạy từ project rỗng với một JD fixture):
1. `/aidw:start <JD>` sinh intake và analysis đầy đủ (stack đúng thứ tự ưu tiên, có danh sách quyền bậc 2).
2. Ghi ra ngoài `.aidw/` bị chặn trước khi approve.
3. Sửa analysis sau approve thì hash lệch và bị chặn lại.
4. Sau approve, chạy hết task graph tuần tự, mỗi task một commit.
5. Kill phiên giữa chừng, `/aidw:resume` chạy tiếp đúng task.
6. Build, unit và E2E luồng chính pass. Deploy được lên Vercel preview.
7. Archive: delta được merge vào `specs/`, validate pass.
8. Delivery package đủ checklist.

---

## 19. Kế hoạch đánh giá [P]

- Unit test cho `bin/aidw` (merge, validate, analyze, hash, gate).
- Test hook bằng input giả lập (như spike v2).
- `claude plugin eval` với các eval case trong `evals/` [V lệnh có sẵn].
- Fixture `greenfield-jd/` (JD booking phòng khám, hoặc thay bằng JD thật). Từ S10 thêm `brownfield-app/`.
- Chỉ số đo (chưa phải mục tiêu cứng): thời gian chạy, số lần can thiệp sau approve (mục tiêu 0 ngoài bậc 3), số task phải chạy lại, tỷ lệ quality layer pass ngay lần đầu, số Scenario còn thiếu ở bước converge.

---

## 20. Kết quả spike (2026-11-08)

| # | Kiểm chứng | Kết quả |
|---|---|---|
| a | CLI: `plugin marketplace add <path\|github>`, `install --scope user\|project\|local`, `--plugin-dir`, `plugin validate`, `plugin eval`, `-w/--worktree` | [V] có đủ |
| b | Plugin chứa skills, agents, `hooks/hooks.json`, `bin/` (nằm trên PATH), `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `dependencies` | Tài liệu. Plugin thử qua được `validate` |
| c1 | PreToolUse của plugin chặn Write ở phiên chính | [V] |
| c2 | PreToolUse của plugin chặn Write trong **subagent của plugin**, input có `agent_type` | [V] |
| c3 | Hook trả `allow` cho `.aidw/**` vượt qua permission prompt khi chạy `-p --permission-mode acceptEdits` | [V] (nếu không có allow thì bị từ chối) |
| c4 | Heuristic Bash chặn `echo >` | [V] |
| c5 | `python3 -c` ghi file lọt heuristic. Stop hook `git status` bắt được | [V] |
| d | `StopFailure` có matcher `rate_limit`. `-p --resume` hoạt động nhưng phải truyền lại permission mode | Tài liệu, chưa chạy thật |
| e | Subagent `isolation`, nesting depth, giới hạn khoảng 20 đồng thời | Tài liệu. [O] cho plugin agent |
| f | Claude Design: export bundle sang Claude Code, `/design-sync`. Không tìm thấy API | Nguồn thứ cấp |
| g | Pocock và Addy đều MIT, đều là Claude Code plugin, cập nhật trong tuần | [V] qua GitHub API |
| h | Plugin agent bỏ qua `permissionMode` | Tài liệu |

Spike nằm ở scratchpad của phiên, không nằm trong repo. Khi làm S2 sẽ viết lại thành test chính thức.

---

## 21. Câu hỏi mở (OPEN)

1. Tên sản phẩm (thay cho `aidw`).
2. Cách ngăn skill vendor tự kích hoạt: đặt ngoài `skills/`, hay chỉnh description (§7.3).
3. Gắn kiểm tra evidence vào hook nào: `TaskCompleted`, `SubagentStop` hay chỉ `aidw checkpoint` (§11).
4. ~~`isolation: worktree` có hoạt động với plugin agent không~~: **đóng bởi D-29**, aidw tự tạo worktree nên không phụ thuộc.
5. ~~Runner auto-resume: thời điểm reset hay backoff~~: **đóng bởi D-30**, đọc thời điểm reset trong lỗi, không có thì backoff 5→60 phút.
6. Định dạng bundle export của Claude Design (§10).
7. Vai của `improve-codebase-architecture` (Pocock) và `deprecation-and-migration` (Addy) cho brownfield (S10).
8. JD thật để làm fixture số 1.
9. `bashEditDiff` ở PostToolUse có dùng được trong permission mode của workflow không (§12).
10. ~~Lát dọc và agent theo chuyên môn~~: **đóng bởi D-23** (§24).
11. ~~Giá trị thật của `agent_type`~~: **đóng** sau lần chạy thật (§27). Giá trị là `aidw:implementer` và `aidw:reviewer`, kèm `agent_id`.
12. Input của hook `StopFailure` (tên field lỗi): `aidw stop-failure` đọc `error`, nếu không có thì ghi `stop_failure`. Cần xác nhận khi chạy thật. **Đóng** (§28): Claude Code 2.1.319 gửi `error`, `error_details` và `last_assistant_message`, và chỉ gửi ở session chính.

## 23. Nhật ký triển khai S2 (2026-11-08)

**Đã làm:**
- CLI: `analyze`, `ids`, `gate`, `backstop`, `vendor-path`, `plugin-path`. `change new` sinh sẵn khung `analysis.md` (có `TODO(aidw)`) và ghi baseline git vào `.aidw/run/baseline.json`.
- `analyze` (Spec Kit analyze) kiểm tra: đủ 12 section bắt buộc, không còn `TODO(aidw)`, có dòng `Source:` và `Mode:`, `## Permissions` là danh sách hoặc ghi "None"; mọi task trỏ tới requirement/scenario có thật; **mọi requirement và scenario bị change chạm tới đều có task phủ**. Lệnh này chạy cùng validate trước `awaiting_approval` và trước `approve`.
- ID ổn định: `<capability>/<slug(requirement)>[/<slug(scenario)>]`.
- Gate (`src/gate.ts`, `src/policy.ts`):
  - Ngoài project có `.aidw/` thì không làm gì (plugin cài ở scope user).
  - Nếu gate tự lỗi thì trả deny (fail closed).
  - **Đóng băng package đã duyệt** (intake, analysis, specs, design, constitution) trong lúc thực thi. `tasks.yaml` và `run/` vẫn ghi được. Trạng thái `escalated` mở khóa để sửa.
  - `aidw approve` do agent gọi luôn thành `ask`, tức người dùng phải bấm xác nhận.
  - Lệnh ghi file được nhận diện **ở vị trí lệnh**, nên các lệnh như `grep install` không bị chặn nhầm.
- Backstop: chỉ báo các thay đổi ngoài `.aidw/` và ngoài baseline, khi gate đang đóng. **Không bao giờ revert** (file có thể là của người dùng). Chặn Stop một lần, các lần sau chỉ cảnh báo để tránh lặp.
- Plugin: `hooks/hooks.json`, các skill `init` / `start` / `approve` / `status`, `profiles/stack-pool.md`, `policies/permissions.md`.
- Vendor: `scripts/vendor.mjs` + `scripts/vendor.config.json`. Pocock 7 skill @ `4ae2317`, Addy 13 skill @ `301b02b`, giữ MIT LICENSE và ghi `UPSTREAM.md`.
- Fixture `evals/fixtures/greenfield-jd/JD.md`. Bộ test tăng lên 49.

**Lệch so với blueprint (P, cần biết):**
- Đồng bộ vendor là **script dev của repo** (`node scripts/vendor.mjs <upstream>`), không phải lệnh `aidw vendor sync` cho người dùng cuối. Lý do: vendor là nội dung của repo engine.
- Skill vendor nằm ở `plugins/aidw/vendor/`, ngoài `skills/`, nên Claude Code **không tự load** chúng. Điều này đóng OPEN-2. Skill của aidw đọc chúng qua `aidw vendor-path`.
- Thêm role `fullstack-engineer` cho task cắt lát dọc theo `to-tickets` (xem OPEN-10).

**Chạy thử S2 (agent do Claude đóng vai, gate được gọi bằng input giả lập, không có Claude Code lồng bên trong):** đi trọn từ JD fixture tới archive.
- Analysis: 4 capability, 12 requirement, 17 scenario, 8 task cắt lát dọc.
- `analyze` bắt được một scenario phân quyền bị quên chưa có task phủ.
- Gate đúng ở tất cả các trường hợp: trước approve, sau approve, khi package bị khóa, ở tier 2/3/x, và khi drift.
- Phục hồi sau drift chạy được: escalated → analyzing → approve lại. Archive merge 4 spec, `validate --strict` sạch.
- Lỗ hổng phát hiện và **đã sửa**: domain, architecture và requirements chưa nằm trong hash và chưa bị khóa.
- Chưa kiểm chứng được: hook nối vào Claude Code thật (sandbox chặn đăng nhập), phần grilling với người thật, backstop với git thật.

**OPEN-10:** `to-tickets` (Pocock) cắt task theo lát dọc (một task đi qua DB, API, UI và test), trong khi danh sách agent ở §8 chia theo chuyên môn (frontend/backend/database). Cần chốt ở S3: dùng một implementer fullstack nạp nhiều skill Addy cho mỗi lát, hay tách lát thành các task con theo chuyên môn.

## 22. Rủi ro chính

| Rủi ro | Giảm thiểu |
|---|---|
| Analysis dài nên gate thành hình thức | Tóm tắt 1 trang, làm nổi bật rủi ro và giả định, có bước Analyze tự kiểm tra |
| Lỗi cộng dồn trong 2–3 giờ chạy | Integration verify sau mỗi wave, Converge, giới hạn retry rồi escalate trung thực |
| Skill vendor tự kích hoạt tranh việc | Chỉ vendor đúng danh sách, nạp qua `skills:` của agent (OPEN-2) |
| Upstream thay đổi | `aidw vendor sync` có diff, ghi `UPSTREAM.md` |
| Chi phí token khi chạy song song | Chỉ chạy song song khi `touches` tách biệt và đáng giá, context gọn |
| Ghi file lọt qua Bash | Stop hook phát hiện, revert hoặc escalate [V] |
| Thay đổi nền tảng Claude Code | Gom phần phụ thuộc runtime vào plugin layer. `.aidw/` và task contract độc lập runtime (Q8) |

## 24. Nhật ký triển khai S3 (2026-11-08)

**Quyết định (D-23, phương án a+):**
1. **Orchestrator mỏng ở phiên chính** (`/aidw:run`), không đọc/viết code. Mỗi task chạy trong **một subagent mới**
   (`aidw:implementer`), chỉ nhận đường dẫn brief. Đây là mẫu `implement-spec` của Pocock (frontier, subagent mới
   mỗi ticket, giao tiếp qua context pointer) cộng governance của aidw. Chạy **tuần tự**; song song để S8.
2. **Skill chọn theo task** (`src/skills.ts`, tất định): lõi `incremental-implementation` + `test-driven-development`;
   UI → `frontend-ui-engineering`; API/data → `api-and-interface-design`; auth/payment/permissions/RLS hoặc
   `risk: high` → `security-and-hardening`; verify có playwright/cypress/e2e → `browser-testing-with-devtools`;
   retry → `debugging-and-error-recovery`; `skills:` trong task để thêm tay. **Không có tín hiệu thì không nạp**
   (lần chạy thử phát hiện luật "fullstack thì nạp cả frontend lẫn API" là lãng phí, đã bỏ). Reviewer:
   `code-review-and-quality` (+ security khi nhạy cảm). Thường 2–4 skill mỗi task thay vì 13.
3. **Bằng chứng theo scenario do máy kiểm** (`aidw checkpoint`): mỗi scenario id của task phải xuất hiện
   nguyên văn trong một file test (khớp đúng biên, chỉ trong file test, bỏ qua node_modules/build), và mọi lệnh
   `verify` phải pass. Kết quả, danh sách file đổi so với base commit và **file ngoài `touches`** được ghi vào
   `.aidw/changes/<id>/evidence/<task>.json` (lịch sử mọi checkpoint và review, dùng cho delivery package).
4. **Reviewer độc lập, chỉ đọc** (`aidw:reviewer`, context mới). Trả `VERDICT: pass|fix`. `fix` đưa nguyên văn ghi
   chú vào brief lần sau. Tổng số lần thử của task giới hạn bởi `max_attempts` (mặc định 3, gồm cả checkpoint
   fail và review fix); hết thì task `escalated`, chỉ người dùng cấp lại được (`aidw task retry`).
5. **Một commit mỗi task**, do `aidw review <T> pass` tạo (code + `tasks.yaml` + evidence trong cùng commit;
   `.aidw/run/` bị gitignore). Không phải git repo thì bỏ qua commit và cảnh báo.

**Vòng đời task:** `pending → running → review → done`, nhánh `failed` (retry) và `escalated`. Trường runtime mới:
`base` (commit lúc bắt đầu, để reviewer xem đúng diff của cả task). Mọi trường runtime nằm ngoài approval hash,
nên tiến độ không bao giờ tính là drift (có test).

**Resume (tiêu chí [5]):** mọi trạng thái nằm trong `tasks.yaml`, evidence và git. Task đang `running` khi phiên
chết được `aidw next` trả về là `interrupted`; `task start` lần nữa không tính thêm lần thử; brief có mục
`## Resuming` khi working tree có thay đổi so với base. Hook `StopFailure` (`aidw stop-failure`) chuyển change
đang chạy sang `paused` kèm lý do; `/aidw:resume` gỡ pause rồi vào lại vòng lặp.

**Gate theo vai (`agent_type`):** reviewer không được ghi file hay chạy lệnh ghi; implementer không được ghi
`.aidw/`, không chạy `aidw checkpoint/review/task/transition/...`, không commit. Orchestrator (phiên chính) làm
được tất cả. **Vá thêm lỗ hổng S2:** lệnh `aidw ...` từng được cho qua nguyên dòng, nên `aidw status && echo x >
src/a.ts` lọt gate trước approve. Giờ lệnh aidw có nối lệnh (`; & | > <` hoặc `$(`) phải qua đủ kiểm tra.
Đánh đổi: `--reason "a > b"` bị chặn nhầm trước approve (an toàn, agent viết lại là xong).

**Lưu ý governance:** lệnh `verify` chạy bên trong tiến trình `aidw checkpoint`, tức không đi qua gate từng lệnh.
Điều này chấp nhận được vì `verify` nằm trong `tasks.yaml` đã được duyệt (thuộc hash). Task do converge thêm
(`origin: converge`, S5) nằm ngoài hash, nên S5 phải kiểm `verify` của chúng trước khi chạy.

**Kiểm chứng:**
- 63 test (thêm 13): vòng lặp đủ, retry với ghi chú review, hết lần thử → escalate → retry do người dùng cấp,
  resume sau khi bị ngắt, StopFailure → paused → resume, brief, chọn skill, glob, gate theo vai, commit bằng
  **git thật**, và **backstop với git thật** (đóng điểm còn treo của S2).
- Plugin và marketplace qua `claude plugin validate` (agents và hook `StopFailure` được chấp nhận).
- Chạy thử bằng bin đã bundle trên project có git: 2 task, bị kill giữa T01 rồi resume, reviewer bị chặn sửa
  code, T02 bị review yêu cầu sửa rồi pass. Kết quả: 2 commit đúng tên task, working tree sạch, approval vẫn hợp lệ.
- Chưa kiểm chứng: chạy với Claude Code thật (sandbox chặn đăng nhập của Claude lồng bên trong); giá trị
  `agent_type` và input `StopFailure` thật (OPEN-11, OPEN-12).

## 25. Nhật ký triển khai S4 (2026-11-08)

**Quyết định (D-24):**
1. **`quality.yaml`** (trong change, cạnh `tasks.yaml`): `layers` (tên, `setup`, `run`), `deploy` (`target`
   none|local|preview, `command`, `smoke`), `permissions` (key tài nguyên bậc 2), `max_fix_rounds`. Đây là phần
   máy đọc của ba section Quality profile, Deploy strategy, Permissions. File nằm trong **approval hash và bị
   đóng băng**, vì mọi lệnh trong đó sẽ chạy không hỏi. Validate từ chối: production, lệnh deploy tier 3, lệnh
   deploy không nhận diện được, lệnh deploy thiếu key trong `permissions`, key lạ. Thiếu layer `code`/`unit`/`e2e`
   là warning (Q5). `analyze` bắt mọi key phải được nêu trong `## Permissions`.
2. **`aidw verify`** (state verifying): chạy các layer theo thứ tự, dừng ở layer lỗi đầu tiên, **bỏ qua layer đã
   pass trên code hiện tại**. Kết quả chỉ còn giá trị nếu mới hơn task xong gần nhất và (khi có git) chạy trên đúng
   HEAD. Nhờ vậy verify bị kill giữa chừng chạy tiếp được, và code đổi thì mọi layer phải chạy lại.
3. **Layer lỗi → task sửa** `Qnn` (`origin: quality`, `layer`, `touches: ["**"]`, `verify` = lệnh của layer,
   `problem` = lệnh lỗi + tail output). Change quay về `executing`, task đi qua đúng vòng S3 (brief có mục
   `## Problem to fix` và skill debugging, checkpoint, reviewer, commit). Task thêm sau duyệt (`origin` quality
   hoặc converge) nằm ngoài hash. Quá `max_fix_rounds` (mặc định 3) mỗi layer thì `escalated`.
4. **`aidw deploy`** (state deploying): chạy đúng lệnh preview đã duyệt, lấy URL deployment từ output (bỏ qua
   link dashboard như `Inspect: https://vercel.com/...`), chạy `smoke` với `AIDW_DEPLOY_URL`. Target none/local thì
   ghi nhận là không deploy. Lịch sử ở `evidence/deploy.json`.
5. **Allowlist bậc 2 trong gate:** tách `ASK_COMMANDS` (bậc 3, luôn hỏi) khỏi `TIER2_COMMANDS` (key
   `vercel-preview`, `netlify-preview`, `supabase-dev`). Lệnh bậc 2 được `allow` khi một change đang mở (approved
   → deploying, approval hợp lệ, **không** tính paused/escalated) có key đó, và lệnh không nối với lệnh khác; còn lại
   thì `ask`. Subagent không bao giờ được chạm tài nguyên cloud. Nhận diện thêm `pnpm dlx`/`npx`/`bunx`... trước CLI.
6. **Guard cứng khi chuyển state** (không lặng lẽ bỏ qua): `verifying` cần mọi task `done`; `converging` cần mọi
   layer pass trên code hiện tại; `delivered` cần một `aidw deploy` thành công. Resume từ paused không bị guard.
7. **Delivered tự commit `.aidw/`** (chỉ pathspec `.aidw`, không đụng file khác của người dùng), để evidence của
   verify/deploy và state cuối nằm trong lịch sử.

**Kiểm chứng:**
- 71 test (thêm 8): validate `quality.yaml`, hash và analyze, vòng verify → task sửa → verify lại → deploy (với
  một `vercel` giả trên PATH, gồm cả trường hợp output không có URL) → delivered, hết fix round → escalate, target
  none, commit `.aidw/` khi delivered (git thật), allowlist bậc 2 (allow, chuỗi lệnh → ask, prod → ask, chưa có key
  → ask, subagent → deny, paused → ask).
- Chạy thử bằng bin trên project Node có git: một bug thật ở server làm e2e fail → `Q01` với stack trace → sửa → 2
  commit task + 1 commit delivered, verify lần 2 chạy lại mọi layer vì HEAD đổi, deploy lấy đúng URL preview, working
  tree sạch.
- **Lần thử bắt được 2 lỗi, đã sửa:** URL deploy bị lấy nhầm là link dashboard Vercel; evidence verify/deploy chưa
  được commit sau delivered.
- Chưa kiểm chứng: Next.js + Playwright + Supabase local + Vercel thật (cần đăng nhập và Docker), thời gian chạy
  thật của các layer so với giới hạn 10 phút của Bash tool (skill hướng dẫn chạy nền khi cần).

## 26. Nhật ký triển khai S5 (2026-11-08) — đóng code mốc A

**Quyết định (D-25):**
1. **`aidw converge`** (state converging) xét mọi scenario do change thêm hoặc sửa. Bằng chứng:
   - **junit** (khi layer khai báo `reports`): `aidw verify` đọc JUnit XML ngay sau khi layer chạy và lưu test case
     vào evidence của layer. Scenario pass khi có test case mang đúng id ở trạng thái pass, từ layer còn mới trên
     code hiện tại. Fail hoặc skip đều là gap. Vitest, Playwright, `node --test`, jest-junit đều xuất định dạng này.
   - **presence** (không có report): có dòng test **không bị skip** nêu id, và mọi layer đã pass. Quality report ghi
     rõ đây là bằng chứng yếu hơn (test sai assertion không bị bắt ở đây; reviewer từng task đã xem assertion).
2. **Gap → task `Cnn`** (`origin: converge`, `scenarios: [id]`, `verify` = setup+run của các layer test đã duyệt,
   không gồm `code`; `problem` nói rõ thiếu hay fail/skip ở đâu). Change quay về executing → verify → converge lại.
   Scenario vẫn là gap sau khi đã có task converge cho nó → **escalated**, không lặp vô hạn.
3. **Guard:** deploying cần một converge pass **trên code hiện tại** (mới hơn task xong gần nhất, cùng HEAD).
4. **`aidw deliver`** (state delivered) ghi `.aidw/changes/<id>/delivery/`: `README.md` (mục lục, trạng thái deploy,
   tóm tắt), `quality-report.md` (mọi layer, số vòng sửa, scenario và loại bằng chứng, **phần không được phủ**:
   layer chuẩn bị bỏ, layer của các slice sau như ui-ux/a11y/security/performance, report thiếu; nhận xét
   non-blocking của reviewer; deploy), `tasks.md` (task, nguồn gốc plan/quality/converge, số lần thử, review,
   commit, file ngoài touches), `decisions.md`, và skeleton `handoff.md` (chỉ tạo khi chưa có). Phần sinh tự động
   được sinh lại mỗi lần chạy.
5. **`aidw deliver --check`** cưỡng chế checklist §14: đủ file; `handoff.md` có đủ 7 mục (Overview, Run locally,
   Environment, Deploy, Usage, Known issues, Next steps), không còn `TODO(aidw)`; có biến môi trường thì phải có
   `.env.example`; change có task UI thì phải có screenshot; converge đã pass. **`aidw archive` từ chối package thiếu**,
   rồi merge spec, chuyển change vào archive và commit `.aidw/`.
6. Sau delivered gate đóng với code, **chỉ mở cho `.env.example`**. Script chụp màn hình đặt trong `.aidw/run/`.
   Skill `start` yêu cầu task scaffold tạo sẵn `.env.example` và cấu hình JUnit reporter.
7. Skill `/aidw:deliver` nạp Addy `documentation-and-adrs` và `shipping-and-launch` (đúng phân vai §7.2, bước 17).

**Lỗ hổng tìm thấy và đã sửa:** checkpoint của S3 tính cả `test.skip("<id>")`/`test.todo` là có test. Giờ checkpoint
và converge dùng chung luật nhận diện test bị skip.

**Kiểm chứng:**
- 76 test (thêm 5 file test converge, mở rộng test archive): parse JUnit (entity, failure, skipped, `>` trong
  thuộc tính), presence (skip → gap → C01 → pass), escalate khi gap lặp lại, junit (report nói skip thì là gap dù
  source có test), report cũ không được tính, checkpoint bỏ qua test bị skip, delivery package thiếu thì archive bị
  chặn, gate sau delivered chỉ cho `.env.example`.
- Chạy thử trọn mốc A bằng bin trên project Node có git: approve → T01 → verify fail (bug thật) → Q01 → verify lại →
  **converge junit** từ report thật của `node --test` → deploy (vercel giả) → delivered → deliver báo thiếu → viết
  handoff → package đạt → archive (merge spec, commit) → `validate --strict` sạch, working tree sạch. Lịch sử git:
  approved analysis, T01, Q01, delivered, archive.

**Trạng thái tiêu chí mốc A:**

| # | Tiêu chí | Đã có |
|---|---|---|
| 1 | `/aidw:start` sinh intake + analysis đầy đủ | skill + `analyze`; **chờ chạy thật** (grilling cần người) |
| 2 | Chặn ghi ngoài `.aidw/` trước approve | test + spike v2 (Claude Code thật) |
| 3 | Sửa analysis sau approve → drift, bị chặn | test |
| 4 | Chạy hết task graph tuần tự, mỗi task một commit | test + chạy thử bằng bin |
| 5 | Kill giữa chừng, resume đúng task | test + chạy thử bằng bin |
| 6 | Build/unit/E2E pass, deploy preview | test + chạy thử với deploy giả; **chờ Next.js + Vercel thật** |
| 7 | Archive merge delta, validate pass | test + chạy thử bằng bin |
| 8 | Delivery package đủ checklist | test + chạy thử bằng bin |

Việc còn lại để đóng mốc A: **một lần chạy thật** với Claude Code (hook thật, subagent thật, `agent_type` thật,
grilling với người, Next.js + Playwright + Vercel preview thật).

## 27. Lần chạy thật mốc A (2026-11-09)

**Project:** `aidw-trial`, ứng dụng Next.js 16 "Pomodoro + ghi chú" (localStorage), Claude Code 2.1.319, permission mode
auto, sandbox bật, `AIDW_HOOK_LOG` bật. Ghi được 269 lần gọi hook.

**Kết quả:**
- Luồng chạy trọn: init → start (grilling 16 câu với người) → approve → run (6 task) → escalate vì môi trường →
  sửa Analysis → approve lại → run → verify (e2e fail) → Q01 → pause/resume do người dùng → verify pass →
  converge junit (36/36 scenario) → deploy `local` → delivered → deliver (5 ảnh chụp) → archive.
- `validate --strict` sạch, working tree sạch, mỗi task một commit.
- Mỗi task mất 2–10 phút. Tổng khoảng 2 giờ, đã trừ 20 phút pause.

**Đã xác nhận trên Claude Code thật:**
- `agent_type` = `aidw:implementer` / `aidw:reviewer` (OPEN-11 đóng).
- Lệnh approve thành permission prompt, và chỉ thành prompt.
- Subagent chạy nền, orchestrator chờ notification. Checkpoint báo file ngoài `touches`, reviewer quyết định file đó
  có hợp lý không.

**Lỗi tìm thấy và đã sửa:**
1. Bin `aidw` không nằm trên PATH. Sửa bằng hook SessionStart ghi `CLAUDE_ENV_FILE`, cộng đường dẫn tuyệt đối dự phòng
   trong skill, và gate nhận lệnh gọi bằng đường dẫn có dấu nháy.
2. Backstop báo nhầm các file mà build đã duyệt tạo ra, sau khi change đi `escalated → analyzing`. Giờ lượt
   chuyển này ghi lại baseline.
3. Gate chặn redirect vào `$TMPDIR`, lý do in ra cũng sai ("not approved" trong khi change đã `delivered`).
   Giờ redirect vào thư mục tạm được phép, và trạng thái delivered có lý do riêng.
4. Brief của task Qnn chỉ có phần cuối output (toàn dòng pass), nên orchestrator phải tự chèn gợi ý vào prompt.
   Giờ brief liệt kê các test fail kèm message lấy từ JUnit.
5. Sandbox chặn tải và chạy Chromium, `pnpm` shim hỏng. Cả hai chỉ lộ ra ở checkpoint T01, tức là sau khi đã
   duyệt. Thêm bước *environment preflight* vào `/aidw:start` (bước 8) và ghi chú trong profile quality-layers.

**Chuyển sang slice sau:**
- **S6/S7:** UI không theo `design/direction.md` (màu chủ đạo chưa dùng) mà không reviewer hay test nào bắt
  được. Cần kiểm design compliance và layer ui-ux.
- **Lệch so với Analysis đã duyệt nhưng không bị phát hiện:** key localStorage, README cũ còn ghi lệnh không dùng.
  Đáng thêm vào checklist của reviewer và deliver.
- **Môi trường người dùng:** hook của plugin context-mode sửa prompt của Agent, khiến auto mode bắt gửi lại mỗi
  lần spawn. Không phải lỗi aidw, nhưng tốn một lượt gọi mỗi task.
- **Chưa kiểm:** Vercel preview thật (tiêu chí 6) và input StopFailure (OPEN-12).

## 28. Nhật ký triển khai S6 (2026-11-09)

**Quyết định (D-26):** Mọi thứ đã duyệt phải kiểm được sau khi duyệt, không chỉ phần hành vi. Mục tiêu là sửa ba lỗi lần chạy thật bỏ lọt:
UI không theo direction, code lệch quyết định trong Analysis, README cũ.

**Đã làm:**
- `src/design.ts`:
  - `tokens.yaml` gồm 8 kind và luật `use` bắt buộc;
  - so màu theo dạng chuẩn: hex 3/4/6/8 ký tự, `rgb()` (cả cú pháp có dấu cách), `hsl()`, `oklch()`;
  - `missingTokens` và `hardcodedColors` (bỏ qua file test và output build);
  - `taskShots` lấy ảnh mới hơn lần checkpoint trước.
- `aidw analyze`:
  - bắt buộc `## Decisions to honor`, gồm các dòng `- D<n>: ...` hoặc `None`;
  - bắt buộc `tokens.yaml` hợp lệ khi có task UI.
- Checkpoint task UI:
  - fail nếu token không có trong code hoặc không có ảnh mới;
  - evidence `design { missing_tokens, hardcoded_colors, screenshots }`.
- Brief:
  - mục *Decisions to honor* và bảng *Design tokens*;
  - luật cho implementer: lệch thì báo blocker, chụp ảnh vào thư mục shots;
  - checklist reviewer có thêm mục 4 (decisions) và mục 5 (design, mở từng ảnh).
- Gate: implementer chỉ được ghi `.aidw/run/shots/`; sau delivered được ghi `README.md`.
- Deliver:
  - `staleReadmeCommands` báo các lệnh `npm run` / `pnpm <script>` không có trong package.json;
  - commit archive gồm cả `README.md` và `.env.example`.
- OPEN-12 đóng nhờ đọc mã Claude Code. Input là `{ error, error_details, last_assistant_message }`, và hook không
  chạy trong subagent. Lý do pause giờ có cả `error_details`.
- Skill:
  - start bước 5 (token theo từng mode) và bước 9 (Decisions to honor);
  - profile `design-tokens.md`;
  - agent implementer và reviewer;
  - run: subagent chỉ nhận đường dẫn brief, gửi lại input bị hook sửa một lần;
  - deliver: README.
- Test: 93 pass. Có bộ `tests/design.test.ts` mới.

**Chưa kiểm trên Claude Code thật:**
- implementer có tự chụp ảnh không;
- reviewer có đọc ảnh và bắt lệch thiết kế không;
- Vercel preview.

Đây là mục tiêu của lần chạy thử thứ hai.

## 29. Lần chạy thử 2 và các sửa đổi (2026-11-10)

**Kết quả** (`aidw-trial-2`, habit tracker, ai_design, Vercel preview). 8 task đều qua review, mỗi task một commit.
Verify đạt cả 4 tầng, converge đạt 33/33 kịch bản. Thời gian chạy khoảng 55 phút (09:58 → 10:51).
Cuối cùng dừng ở `escalated` vì smoke check của deploy fail.

| # | Tiêu chí | Kết quả |
|---|---|---|
| 11 | Decisions to honor và tokens trước approve | Đạt. Reviewer T01 bắt được lệch D22 (JUnit) và trả `fix` |
| 12 | Preflight bắt lỗi môi trường trước approve | Đạt một phần. Bắt được việc sandbox chặn Chromium, nhưng mất khoảng 30 phút thử. Người dùng chốt dùng Chrome qua CDP |
| 13 | Implementer chụp ảnh | Đạt. Mọi task UI đều có ảnh, nhưng tới 12–20 ảnh mỗi task |
| 14 | Reviewer mở ảnh | Đạt một phần. Mỗi lần review chỉ mở 2–3 ảnh. UI đúng token |
| 15 | README | Chưa tới bước deliver |
| 16 | Vercel preview | Fail. Lần deploy đầu bị đẩy lên production. aidw lấy URL alias (404). Smoke bằng curl thường thì vướng Deployment Protection |

**Lỗi và cách sửa (D-27):**
- Gate chặn lệnh probe có `'data:text/html,<p>ok</p>'`, vì coi `>` trong dấu nháy là redirect. Sửa: thêm `maskQuotedAngles`.
- T01 dừng chờ người dùng `kill`: server do subagent mở để chụp ảnh vẫn chạy và giữ cổng e2e, subagent không kill được.
  Sửa: brief và agent bắt buộc dừng mọi process đã tự mở, và chụp ảnh qua `webServer` của Playwright.
- Lần thử T01 thứ 2 fail mà không in lý do, vì không có ảnh mới. Implementer tưởng ảnh cũ vẫn dùng được.
  Sửa: checkpoint in `design:` và `PROBLEM ...`. Brief ghi rõ mỗi lần thử phải chụp lại ảnh, tối đa 6 ảnh.
- Deploy: URL lấy từ `url` trong JSON của Vercel, bỏ qua các dòng alias. Profile dùng
  `vercel deploy --yes --environment=preview`, và smoke bằng `vercel curl`.
  `--environment/--target production` được tính là tier 3.
- Backstop báo `.gitignore` (dòng `.vercel` do Vercel CLI thêm) và còn nói sai là "chưa approve".
  Sửa: deploy ghi baseline, commit archive gồm `.gitignore`, và lý do gate đóng phản ánh đúng `escalated`/`paused`.
- Preflight e2e mặc định dùng Chrome qua CDP: kiểm `127.0.0.1:9222` từ trong session. Profile có fixture mẫu.
- Ngoài aidw:
  - plugin context-mode vẫn sửa prompt của mọi subagent, tốn thêm một lượt gọi mỗi lần;
  - mở lại `claude` mà không có `--plugin-dir` thì mất `/aidw:*` và mất log hook.
    Hướng dẫn chạy thử nay dùng alias.

**Hoàn tất lần chạy 2** (2026-11-10). Agent làm từ chỗ `escalated`, người dùng chỉ tự approve lại:
- escalated → analyzing. Sửa phần deploy trong `quality.yaml` và `analysis.md` (D25, R4).
- Người dùng approve lại. Agent bị chặn tự duyệt (*Self-Approval*), đúng như mong muốn.
- Verify: các tầng đã đạt trên cùng commit. Converge 33/33.
- Deploy lần đầu fail vì Vercel CLI cần làm mới token, mà sandbox chặn ghi file auth (`"err" is out of range`).
  Người dùng chạy `vercel whoami` ngoài sandbox, sau đó deploy preview đạt và smoke `vercel curl` đạt.
- Delivered → deliver → archive (`5fada47`). Tiêu chí 15 (README sạch) và 16 (Vercel preview) đều đạt.

**Lỗi tìm thêm trong lúc hoàn tất, và cách sửa:**
- `aidw deploy` giải thích các lỗi deploy đã biết (`deployHint`: token Vercel, chưa login). Skill run dặn
  giữ change ở `deploying` và chờ người dùng, thay vì escalate.
- Verify in tầng đã đạt trên commit hiện tại là "skipped", trông như chưa chạy. Giờ in là `ok (passed earlier on this commit)`.
- Orchestrator ghi review `pass` không kèm notes, nên mất toàn bộ nhận xét non-blocking của 8 reviewer.
  Quality report vì thế ghi "None recorded". Sửa: skill run luôn ghi reply bằng `--notes-file`, CLI nhắc khi
  pass mà không có notes. Lần này đã khôi phục các nhận xét từ transcript vào handoff.
- `aidw deliver` tự lấy ảnh đã review (2 ảnh mỗi task UI) vào `delivery/screenshots/`, nên không phải mở
  trình duyệt trong sandbox. `deliver --check` cảnh báo khi project không có README.

Test: 102 pass. Có thêm bộ `tests/trial2.test.ts`.

## 30. Nhật ký triển khai S7 (2026-11-10)

**Quyết định (D-28):** Lần chạy thử 2 cho thấy reviewer từng task không bắt được lỗi chỉ lộ ra khi nhìn cả sản phẩm:
nút theme nháy khi tải, lưới icon tràn 8px ở 390px, ô ngày không đều. S7 thêm tầng kiểm cho **cả change** mà vẫn giữ
cơ chế D-24: mọi tầng là một mục trong `quality.yaml`, Analysis chọn, người dùng duyệt.

**Đã làm:**
- `quality.yaml`: tầng có thể mang `review: ui | security` và `artifacts: [glob]`. Tầng review có thể không có `run`.
  `parseQuality` kiểm kind, glob tương đối, cảnh báo `artifacts` không đi với `review`.
- `aidw verify`: với tầng review, chạy `run` như thường; đạt thì viết brief
  `.aidw/run/briefs/<change>/<layer>.layer-review.md`, ghi summary `status: review` và dừng (`REVIEW: ...`, in agent,
  brief và prompt). Gọi lại `verify` không chạy lại lệnh khi tầng vẫn chờ trên cùng commit.
- `aidw layer-review <layer> pass|fix [--notes-file]`: `pass` lưu reply và tầng thành `pass`; `fix` thành task `Qnn`
  mang nguyên nhận xét (tách `addFixTask` dùng chung với tầng lệnh), hết `max_fix_rounds` thì escalate. Từ chối khi
  tầng không ở trạng thái chờ review trên code hiện tại.
- Brief tầng (`src/layers.ts`): phạm vi (`git diff <base của task đầu>`), artifact đã resolve (mở từng file), ảnh
  từng task, danh sách task UI, output các lệnh của tầng, Decisions to honor, bảng token (ui), checklist riêng
  cho ui (design compliance, responsive 320–390, states, consistency, hierarchy) và security (authz, input/output,
  secrets, data/RLS, session, dependencies), skill Addy tương ứng.
- Agent mới: `plugins/aidw/agents/ui-reviewer.md`, `security-reviewer.md` (Read, Grep, Glob, Bash; chỉ đọc).
- Gate: mọi `*-reviewer` là reviewer. `AIDW_STATE_COMMAND` thêm `layer-review`, `verify`, `converge`, `deploy`, `deliver`.
- Deliver: quality report có cột Review (verdict của reviewer tầng), nhận xét non-blocking của tầng, và liệt kê
  tầng khuyến nghị bị bỏ là "not covered" (thay câu "slice sau").
- Profile `quality-layers.md`: mục *Recommended layers* với lệnh và file mẫu: `shots.spec.ts` (3 viewport × theme),
  `a11y.spec.ts` (axe + keyboard), security (`pnpm audit` + `git grep` secret), performance (Lighthouse `--port=9222`
  gắn vào Chrome CDP, `start-server-and-test`, `scripts/lh-budget.mjs`). Playwright chia project `e2e`/`a11y`/`shots`,
  JUnit theo `PLAYWRIGHT_JUNIT_OUTPUT_NAME`.
- Skill: start bước 8 (khi nào thêm tầng nào, preflight `lighthouse --version`); run §3 nhánh `REVIEW`.
- Test: 108 pass. Bộ mới `tests/layers.test.ts`.

**Chưa kiểm trên Claude Code thật (mục tiêu trial-3):**
- ui-reviewer có mở hết ảnh và bắt được lỗi kiểu trial-2 không;
- Lighthouse có gắn được vào Chrome CDP từ trong sandbox không (chrome-launcher dùng lại Chrome đang nghe cổng 9222);
- `start-server-and-test` dừng server sạch trong sandbox;
- thời gian thêm của 4 tầng.

## 31. Nhật ký triển khai S8, S9, S10 (2026-11-10)

Ba slice cuối của mốc B được làm một lượt theo yêu cầu của người dùng, rồi kiểm chung trong trial-3
(`docs/trial-3.md`).

### S8: song song, worktree, integration verify (D-29)

- `src/parallel.ts`: `globsOverlap` (prefix tĩnh, bảo thủ), `planWave`, worktree (`ensureWorktree`, `removeWorktree`,
  `mergeWorktree`), `integrate`.
- `aidw next` có thêm hai action: `wave` (≥2 task) và `integrate` (wave đã merge mà chưa kiểm chung). Task `Inn`
  của integration chạy trước mọi task mới.
- `aidw task start <T> --worktree`: tạo worktree tại base của task, chạy `parallel.setup`; setup fail thì task
  `sequential: true`. Trường runtime mới (không tính drift): `worktree`, `branch`, `merged_at`, `sequential`.
- Checkpoint, brief, review làm theo thư mục của task. Brief có mục *Working directory*.
- `aidw review <T> pass` với task trong worktree: commit trong worktree (`<T> (worktree): ...`, không gồm `.aidw/`),
  `merge --no-ff --no-commit`, commit `<T>: <title>` kèm state `.aidw/`, rồi xóa worktree và nhánh. Conflict:
  `merge --abort`, bỏ nhánh, task về `pending` + `sequential`, attempts về 0.
- Guard: `verifying` cần wave cuối đã integrate. Gate: ghi code trong worktree theo luật như project, chặn `.aidw/`
  bản sao; `findProject` từ trong worktree trả về checkout chính.
- Skill run có nhánh `wave` (spawn implementer song song trong một message, checkpoint lần lượt) và `integrate`.

### S9: `aidw run` (D-30)

- `src/runner.ts`: vòng `claude -p "/aidw:resume <id>"` (state `delivered` thì `/aidw:deliver`), `waitMs` đọc thời
  điểm reset hoặc backoff, `fingerprint` (state + hash các file tiến độ, bỏ timestamp) để phát hiện session không
  tiến triển. Output có chữ rate limit/429/529 mà change chưa pause thì cũng chờ.
- Kết quả: `archived` (exit 0), `escalated`/`needs_user` (exit 2), `no_progress`/`max_runs`/`claude_failed` (exit 1).
- Gate chặn `aidw run` trong session; CLI cũng từ chối khi `CLAUDECODE=1`.

### S10: brownfield (D-31)

- `src/detect.ts`: framework, UI, styling, components, ORM, database, auth, test runner, deploy; package manager
  (field `packageManager`, lockfile); ngôn ngữ; lệnh layer gợi ý từ `scripts` (`code`, `unit`, `e2e`).
- `aidw init` ghi `kind`, stack và `detected:` vào `project.yaml`. `aidw detect` in lại.
- Analysis: `## Existing system` bắt buộc khi `kind: brownfield` (template sinh sẵn). Spec gốc có `TODO(aidw)` làm
  analyze báo lỗi.
- `aidw baseline <capability>`: skeleton spec hành vi hiện tại, chỉ trước approve, không ghi đè.
- Hash approve gồm spec gốc mà delta áp vào; gate khóa nó trong lúc change chạy.
- Skill start bước 1b (assessment: đọc code, health baseline, conventions, giữ stack), bước 4 (lazy baseline,
  characterization test), bước 7–8 (touches gọn để chạy song song, `parallel`), profile quality-layers (brownfield).
- Fixture `evals/fixtures/brownfield-app` (Next.js todo, có test và vercel.json); `vitest.config.ts` giới hạn
  test của repo trong `tests/`.

**Test:** 125 pass. Bộ mới `tests/parallel.test.ts` (git thật: wave, merge, conflict, integration fail, setup fail,
gate), `tests/runner.test.ts` (claude giả), `tests/brownfield.test.ts`.

**Chưa kiểm trên Claude Code thật (trial-3):**
- Agent tool chạy nhiều implementer song song trong một message, mỗi cái `cd` vào worktree của mình;
- `next build`/Turbopack trong worktree lồng trong project (node_modules ở thư mục cha, nhiều lockfile);
- `claude -p "/aidw:resume"` gọi được skill `disable-model-invocation`, `--permission-mode auto` chạy headless,
  hook StopFailure có chạy trong `-p` không;
- brownfield: chất lượng assessment, baseline spec, health baseline trên project thật.

