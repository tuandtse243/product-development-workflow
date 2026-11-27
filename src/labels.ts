/**
 * The headings and fixed labels of the gate sections the CLI makes itself, in the language of the page (`lang`, D6).
 * English is the default for any other lang. Only headings and fixed words are translated here: never a file path,
 * an id, code or the content of an Artifact.
 */
export type Lang = "en" | "vi";

export interface GateLabels {
  beforeAfterBody: string;
  before: string;
  after: string;
  programDesign: string;
  programDesignBody: (changeId: string, file: string) => string;
  decisionPoints: string;
  open: string;
  noReason: string;
  plan: string;
  patterns: string;
  docs: string;
  forYouToCheck: string;
  stage: string;
  tasks: string;
  stages: string;
  widestStage: string;
  checksForYou: string;
  docsBriefs: string;
  docsBriefsNote: string;
  planChecksNote: string;
  grants: string;
  grantsBody: string;
  pushAndPr: string;
  envelope: string;
  cap: string;
  neverAutomatic: string;
  openFindings: string;
  unanswered: string;
}

const EN: GateLabels = {
  beforeAfterBody: "What the user sees today, and what they will see once this Change is built.",
  before: "Before",
  after: "After",
  programDesign: "Program Design",
  programDesignBody: (id, file) =>
    `The files this Change adds, changes and removes, and its main signatures and contracts (.aidw/changes/${id}/${file}). You approve it with the package: code that differs from it is a Deviation, decided by the Software Architect and listed in the pull request.`,
  decisionPoints: "Decision Points",
  open: "open",
  noReason: "no reason recorded",
  plan: "Plan",
  patterns: "Patterns",
  docs: "Docs",
  forYouToCheck: "For you to check",
  stage: "stage",
  tasks: "Tasks",
  stages: "Stages",
  widestStage: "Widest stage",
  checksForYou: "Checks for you",
  docsBriefs: "Docs Briefs",
  docsBriefsNote: "what the official documentation says, written by Research",
  planChecksNote: "The build does not stop for these; delivery lists them under \"Checks for you\":",
  grants: "Grants for this Change",
  grantsBody:
    "Recorded in quality.yaml `grants` and approved with the package; the branch and the remote's URL are fixed when you approve. Mark it for a change to grant or withdraw any of them.",
  pushAndPr: "Push and pull request",
  envelope: "Permission envelope",
  cap: "Cap",
  neverAutomatic: "Never automatic",
  openFindings: "Open findings of the independent review",
  unanswered: "Questions no Role could answer",
};

const VI: GateLabels = {
  beforeAfterBody: "Điều người dùng thấy hôm nay, và điều họ sẽ thấy khi Change này được build xong.",
  before: "Trước",
  after: "Sau",
  programDesign: "Thiết kế chương trình",
  programDesignBody: (id, file) =>
    `Các tệp Change này thêm, sửa và xóa, cùng chữ ký và hợp đồng chính của nó (.aidw/changes/${id}/${file}). Bạn duyệt nó cùng gói: code khác với nó là một Deviation, do Software Architect quyết định và ghi trong pull request.`,
  decisionPoints: "Các điểm quyết định",
  open: "đang mở",
  noReason: "chưa ghi lý do",
  plan: "Kế hoạch",
  patterns: "Mẫu cần theo",
  docs: "Tài liệu",
  forYouToCheck: "Bạn cần kiểm tra",
  stage: "giai đoạn",
  tasks: "Task",
  stages: "Giai đoạn",
  widestStage: "Giai đoạn rộng nhất",
  checksForYou: "Việc bạn cần kiểm tra",
  docsBriefs: "Docs Brief",
  docsBriefsNote: "tài liệu chính thức nói gì, do Research viết",
  planChecksNote: "Việc build không dừng vì những mục này; lúc giao, aidw liệt kê chúng ở \"Checks for you\":",
  grants: "Quyền được cấp cho Change này",
  grantsBody:
    "Ghi trong `grants` của quality.yaml và được duyệt cùng gói; nhánh và URL của remote được chốt khi bạn duyệt. Đánh dấu cần đổi để cấp thêm hoặc rút lại bất kỳ quyền nào.",
  pushAndPr: "Push và pull request",
  envelope: "Phạm vi quyền",
  cap: "Giới hạn",
  neverAutomatic: "Không bao giờ tự động",
  openFindings: "Phát hiện còn mở của lượt review độc lập",
  unanswered: "Câu hỏi không Role nào trả lời được",
};

export function gateLabels(lang?: string): GateLabels {
  return lang === "vi" ? VI : EN;
}
