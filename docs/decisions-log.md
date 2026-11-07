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
