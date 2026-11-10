# Decisions Log

Nhật ký quyết định của **AI Fullstack Autonomous Development Workflow** (tên sản phẩm tạm: `aidw`).

- **CONFIRMED**: người dùng đã chốt rõ ràng.
- **PROPOSED**: đề xuất kỹ thuật, có thể sửa.
- **OPEN**: chưa quyết hoặc chưa kiểm chứng.

Một quyết định chỉ chuyển sang CONFIRMED khi người dùng xác nhận. Quyết định mới hơn ghi đè lên quyết định cũ, và cột "Thay thế" ghi lại điều đó.

---

## A. Discovery gốc (Q1–Q10)

| ID | Hạng mục | Quyết định | Trạng thái |
|---|---|---|---|
| Q1 | Input | Hỗ trợ mọi loại input: idea/prompt, PRD, Upwork JD/client request, codebase có sẵn | CONFIRMED |
| Q2 | Autonomy | Analysis-Gated Autonomous Development: người dùng chỉ duyệt Analysis, sau đó AI tự chạy trong phạm vi đã duyệt | CONFIRMED |
| Q3 | Design | Design mode là một quyết định nằm trong Analysis: Existing Design / Claude Design / AI Design & Implement (+ Hybrid) | CONFIRMED |
| Q4 | Agents | Hybrid multi-agent. Orchestrator quyết định chạy song song hay tuần tự, dùng specialist agents | CONFIRMED |
| Q5 | Quality | Comprehensive: code, unit, integration, E2E, UI/UX, a11y, security, performance. Quality gate là các lớp độc lập. Implementer không tự xác nhận công việc của mình | CONFIRMED |
| Q6 | Deployment | Configurable. Strategy được xác định và duyệt trong Analysis. Production cần duyệt riêng | CONFIRMED |
| Q7 | Memory | Spec-driven Living Memory, gồm Requirements, Architecture, Domain Model, Specs, Decisions, Implementation, Synchronization | CONFIRMED |
| Q8 | Runtime | Claude Code trước, kiến trúc mở rộng được. Task contract độc lập với runtime | CONFIRMED |
| Q9 | Stack | Project có sẵn giữ nguyên stack. Project mới thì AI đề xuất trong Analysis để người dùng duyệt | CONFIRMED (chi tiết ở D-05) |
| Q10 | Delivery | Complete Delivery Package | CONFIRMED (bỏ demo video, xem D-13) |

## B. Quyết định trong phiên thiết kế 2026-11-08

| ID | Hạng mục | Quyết định | Trạng thái | Thay thế |
|---|---|---|---|---|
| D-01 | Repo | Repo này **là sản phẩm** (workflow engine), không phải workspace phát triển. Đã gỡ OpenSpec khỏi repo | CONFIRMED | |
| D-02 | Người dùng | Trước mắt chỉ dùng cá nhân, chưa chia sẻ. Kiến trúc để ngỏ public: core trung lập, profile tách riêng, không có dữ liệu cá nhân hay khách hàng trong repo | CONFIRMED | |
| D-03 | Phạm vi | Mọi loại project web | CONFIRMED | |
| D-04 | Golden path | Input chính là idea/JD → greenfield. Brownfield vẫn có trong phạm vi nhưng làm sau | CONFIRMED | |
| D-05 | Stack | Thứ tự ưu tiên: **khách yêu cầu > AI đề xuất > fallback**. AI chọn *trong tập quen dùng*, chỉ ra ngoài khi có lý do và phải ghi lý do | CONFIRMED | Làm rõ Q9 |
| D-06 | Tập stack quen dùng | FE: Next.js, Vite + React · BE: Next.js API routes, NestJS, Express · Data: Postgres + Prisma/Drizzle, Supabase, MongoDB · UI: Tailwind, shadcn/ui · Test: Vitest, Playwright · Deploy: Vercel, Railway, Cloudflare, VPS/Docker | CONFIRMED | |
| D-07 | Fallback stack | Next.js + Supabase + Tailwind/shadcn + Vercel. Auth/Payment do AI quyết theo từng project | CONFIRMED | |
| D-08 | Quyền | 5 bậc: 0 (code/npm/test/commit nhánh riêng) và 1 (Supabase local, migration local) tự do · 2 (tài nguyên cloud miễn phí, preview deploy) phải liệt kê trong Analysis · 3 (tốn tiền, production, domain, email/payment thật, xóa dữ liệu cloud, push repo khách) luôn hỏi · x (secret ngoài `.env` của project, credential cá nhân) cấm | CONFIRMED | |
| D-09 | Run mode | Phiên Claude Code local có người theo dõi. Một project chạy khoảng 2–3 giờ, có thể nhanh hoặc chậm hơn, không đặt ngân sách thời gian cứng | CONFIRMED | |
| D-10 | Resume | Bắt buộc. Khi hết token/quota thì chờ tới khi có lại rồi chạy tiếp phần đang dở | CONFIRMED | |
| D-11 | Cài đặt | Claude Code plugin cài ở scope user. Repo này đồng thời là marketplace. **Không** khóa version engine theo project | CONFIRMED | |
| D-12 | Spec system | Tự xây theo mô hình OpenSpec, **không phụ thuộc OpenSpec**. Thư mục `.aidw/` trong project | CONFIRMED | Thay vai OpenSpec trong baseline §4 |
| D-13 | Deterministic core | Script Node/TypeScript `bin/aidw` đi kèm plugin (status/validate/analyze/approve/merge/resume...) | CONFIRMED | |
| D-14 | Phạm vi v1.0 | Mọi thứ **trừ demo video**: song song + worktree, security/perf/a11y, UI review, 4 design mode, brownfield, auto-resume | CONFIRMED | Thay khuyến nghị MVP hẹp trong baseline §7 |
| D-15 | Thứ tự xây | S1→S10, mốc A (golden path greenfield) và mốc B (v1.0) | CONFIRMED | |
| D-16 | Skill bên ngoài | Clone về dùng, giữ ý tưởng gốc, kéo update upstream khi phù hợp, **theo phân vai trong baseline §4**: Pocock cho product/requirements/domain/tickets/orchestration pattern, Addy cho engineering execution & quality | CONFIRMED | |
| D-17 | Cách tích hợp skill | Vendor **có chọn lọc** vào `vendor/` (giữ MIT notice) + `aidw vendor sync` hiện diff upstream. Không dùng plugin dependency | CONFIRMED | |
| D-18 | Định vị | Lõi tự viết là **orchestration + governance** (state, gate, tiers, scheduler, evidence, resume, delivery). Phần bề mặt ghép từ Pocock, Addy, OpenSpec, Spec Kit | CONFIRMED | |
| D-19 | `implement-spec` (Pocock) | Thuộc lớp orchestration. Engine bọc thêm governance, không loại bỏ | CONFIRMED | |
| D-20 | Spec Kit | Không dùng như một dependency. Hấp thụ 4 cơ chế: constitution, clarify, analyze, converge | CONFIRMED | |
| D-21 | Nguyên tắc "đơn giản trước" | **Đã gỡ bỏ.** Đó là nguyên tắc AI tự suy ra, người dùng không đặt | CONFIRMED (gỡ) | |
| D-22 | Tiêu chí mốc A | [1]–[8] trong blueprint §18 | CONFIRMED | |
| D-28 | Tầng review và reviewer chuyên biệt (S7) | Các tầng ui-ux, a11y, security, performance vẫn là mục trong `quality.yaml` (D-24), do Analysis chọn và người dùng duyệt; bỏ tầng nào phải nêu lý do, quality report ghi "not covered". Tầng có **`review: ui | security`** là **tầng review**: lệnh `run` (tùy chọn) tạo artifact, đạt rồi `aidw verify` dừng với một brief và orchestrator spawn agent chỉ đọc **`aidw:ui-reviewer`** / **`aidw:security-reviewer`**, rồi ghi phán quyết bằng **`aidw layer-review <layer> pass|fix --notes-file`**. `fix` thành task `Qnn` mang nguyên nhận xét, trong `max_fix_rounds`; `pass` lưu reply, nhận xét non-blocking vào quality report. Mọi `*-reviewer` bị gate coi là reviewer (không ghi, không chạy lệnh đổi state aidw; `verify`, `deploy`, `converge`, `deliver`, `layer-review` nay cũng là lệnh đổi state). a11y chạy axe qua Playwright (JUnit), performance chạy Lighthouse gắn vào Chrome CDP cổng 9222 với script ngân sách. Nguồn: lần chạy thử 2 để lọt lỗi UI mà reviewer từng task không thấy | CONFIRMED | |
| D-27 | Sửa sau lần chạy thử 2 | **E2E mặc định dùng Chrome qua CDP** (cổng 9222, `E2E_CDP_URL`): Chrome do người dùng tự mở ngoài sandbox, mỗi test tạo context riêng. Lựa chọn này do người dùng chốt trong lần chạy thử 2. Deploy Vercel dùng `--environment=preview`. Smoke dùng `vercel curl`, vì curl thường bị Deployment Protection chặn. URL lấy từ trường `url` trong JSON, không lấy alias. `--environment/--target production` được tính là tier 3. Sau khi deploy, aidw ghi baseline. Commit archive gồm cả `.gitignore`. Checkpoint in rõ lý do fail. Mỗi lần thử phải chụp ảnh mới (tối đa 6 ảnh) và dừng mọi server đã tự mở. Gate không coi `<`, `>` trong chuỗi có dấu nháy là redirect. Lý do gate đóng khi escalated hoặc paused được nói đúng. Lỗi deploy đã biết có kèm gợi ý cho người dùng, và change chờ ở `deploying`. Review `pass` luôn ghi reply của reviewer (`--notes-file`). `deliver` tự lấy ảnh đã review vào gói bàn giao. Nguồn: §29 | CONFIRMED | |
| D-26 | Design modes và tuân thủ cái đã duyệt (S6) | Bốn design mode đều kết thúc bằng **`.aidw/design/tokens.yaml`** (token + luật `use`, đóng băng cùng `design/**`), bắt buộc khi kế hoạch có task UI. Với task UI, **checkpoint** kiểm mỗi token màu/font có trong code, liệt kê màu viết cứng ngoài token cho reviewer, và **bắt buộc ảnh chụp mới** trong `.aidw/run/shots/<change>/<task>/` (chỗ duy nhất trong `.aidw/` implementer được ghi). Reviewer mở từng ảnh, đối chiếu luật `use`. Analysis có mục **`## Decisions to honor`** (`- D<n>: ...`). Mục này được chép nguyên vào brief; lệch phải escalate, không tự đổi; reviewer kiểm. `deliver --check` kiểm lệnh trong README của project có script thật; sau delivered gate cho ghi `README.md`, và commit archive gồm cả `README.md` và `.env.example`. Nguồn: lần chạy thật mốc A (§27) | CONFIRMED | |
| D-25 | Converge, delivery, archive (S5) | **Converge** chỉ xét scenario do change thêm/sửa; bằng chứng mạnh nhất là **JUnit report** của layer (pass/fail/skip thật theo scenario id), không có report thì rơi về "test không bị skip có nêu id + layer pass" và quality report ghi rõ là bằng chứng yếu hơn. Gap → task `Cnn` (origin: converge, verify = các layer test đã duyệt); gap vẫn còn sau task converge → escalate, không lặp. **Delivery package** = phần engine sinh từ evidence (README, quality report, tasks, decisions) + `handoff.md` do agent viết (7 mục bắt buộc) + screenshots khi có UI + `.env.example` khi có biến môi trường; `aidw deliver --check` cưỡng chế, **archive từ chối package thiếu**. Sau delivered gate chỉ cho ghi `.env.example` trong project | CONFIRMED | |
| D-24 | Quality, deploy và allowlist bậc 2 (S4) | `quality.yaml` trong change là phần máy đọc của Quality profile, Deploy strategy và Permissions; **thuộc package được duyệt** (hash, đóng băng), nên lệnh trong đó chạy không hỏi. Layer lỗi thành **task sửa (origin: quality)** đi qua đúng vòng S3, tối đa `max_fix_rounds` rồi escalate. Bậc 2 có **key tài nguyên**; gate tự cho qua khi key nằm trong allowlist của change đang mở. Production không bao giờ tự động. **Guard cứng** khi chuyển state: verifying cần mọi task done, converging cần mọi layer pass trên code hiện tại, delivered cần deploy thành công | CONFIRMED | Thay `layer.yaml` trong plugin ở blueprint §11 |
| D-23 | Thực thi task (OPEN-10) | **(a+)**: mỗi lát dọc do **một implementer fullstack** làm, trong **context mới** (orchestrator mỏng ở phiên chính, chỉ truyền đường dẫn brief). Skill Addy **chọn theo task** (lõi incremental + TDD; thêm theo touches/risk/verify; debugging khi retry), không nạp sẵn. **Bằng chứng theo scenario do máy kiểm** (test mang đúng scenario id + verify pass). **Reviewer độc lập, chỉ đọc**, context mới; fix tối đa theo `max_attempts` (mặc định 3) rồi escalate. Một commit mỗi task | CONFIRMED | Thay bảng agent theo chuyên môn ở blueprint §8 |

## C. Đề xuất đang chờ triển khai (PROPOSED)

| ID | Đề xuất | Ghi chú |
|---|---|---|
| P-01 | Orchestrator chạy ở **phiên chính** dưới dạng skill `aidw:run`, không phải subagent | Lệch khỏi baseline §5 (`orchestrator.md` là agent) |
| P-02 | `.aidw/` là nguồn sự thật duy nhất. `docs/` cho khách do bước Deliver sinh ra | Lệch khỏi baseline §5 (`docs/`, `.ai/` tách riêng) |
| P-03 | Gate hook trả `allow` cho `.aidw/**` và `deny` cho phần còn lại khi chưa approve | Đã kiểm chứng ở spike v2 |
| P-04 | Claude Design là bước người dùng làm **trước gate**, engine nhận bundle export | Không có API công khai |
| P-05 | Scheduler lập lịch dựa trên `depends_on` + `touches` (glob file). Song song chỉ khi `touches` rời nhau | |

## D. Câu hỏi mở (OPEN)

Xem blueprint §21.
