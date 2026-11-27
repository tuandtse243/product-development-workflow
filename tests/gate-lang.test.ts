/** F7 (D6): the gate sections the CLI makes take their headings and labels from the page `lang`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { gateLabels } from "../src/labels.js";
import { ANALYSIS_MD, MAIN_SPEC, PROGRAM_DESIGN_MD, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "booking-lang";
const C = `.aidw/changes/${ID}`;
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const gate = (lang: string) => {
  write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nlang: ${lang}\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
  const r = cli("page", "render", "gate");
  expect(r.code, r.err).toBe(0);
  return readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
};

beforeEach(() => {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID, "--workflow", "feature").code).toBe(0);
  write(root, `${C}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${C}/tasks.yaml`, TASKS_YAML);
  write(root, `${C}/quality.yaml`, QUALITY_YAML);
  write(root, `${C}/program-design.md`, PROGRAM_DESIGN_MD);
  write(root, `${C}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
});

describe("CLI-made gate sections follow the page lang", () => {
  it("draws Vietnamese headings and labels for lang: vi, and keeps paths and ids", () => {
    const html = gate("vi");
    for (const s of ["Thiết kế chương trình", "Kế hoạch", "Quyền được cấp cho Change này", "Trước", "Sau", "Phạm vi quyền", "Giai đoạn rộng nhất"]) expect(html).toContain(s);
    expect(html).toContain("app/api/bookings/route.ts");
    expect(html).toContain("T01");
    expect(html).not.toContain("Grants for this Change");
    expect(html).not.toContain(">Program Design<");
  });

  it("fills both Before and After columns on a vi page with the right lines", () => {
    const html = gate("vi");
    const panel = (side: string) => new RegExp(`<div class="panel ${side}"><div class="k">[^<]+</div><ul>(.*?)</ul>`, "s").exec(html)?.[1] ?? "";
    expect(panel("before")).toContain("A patient phones the clinic and waits on hold to book.");
    expect(panel("after")).toContain("A patient picks a free slot on their phone.");
    expect(panel("before")).not.toContain("picks a free slot");
  });

  it("stays in English for lang: en", () => {
    const html = gate("en");
    for (const s of ["Program Design", ">Plan<", "Grants for this Change", "Before / After", "Widest stage", "Permission envelope"]) expect(html).toContain(s);
    expect(html).not.toContain("Kế hoạch");
  });

  it("falls back to English labels for any other lang", () => {
    expect(gateLabels("fr")).toBe(gateLabels("en"));
    expect(gateLabels(undefined).plan).toBe("Plan");
    expect(gateLabels("vi").checksForYou).toBe("Checks for you (việc bạn cần kiểm tra)");
    expect(gateLabels("vi").patterns).toBe("Mẫu cần theo");
    expect(gateLabels("vi").decisionPoints).toBe("Các điểm quyết định");
  });
});

describe("the gate intro says what really happens (D6)", () => {
  const plugin = join(__dirname, "..", "plugins", "aidw");
  const read = (p: string) => readFileSync(join(plugin, p), "utf8").replace(/\s+/g, " ");

  it("step 9 says the orchestrator runs aidw approve, Claude Code asks, and /aidw:approve is the headless way", () => {
    const s = read("skills/start/SKILL.md");
    expect(s).toMatch(/once they agree to every section, you run `aidw approve` and Claude Code asks them to confirm/);
    expect(s).toMatch(/if it cannot ask \(a headless session\), they type `\/aidw:approve`/);
    expect(s).not.toMatch(/the build starts by itself/);
  });

  it("step 10 and the approve skill agree with it", () => {
    expect(read("skills/start/SKILL.md")).toMatch(/if Claude Code cannot ask, a headless session, tell the user to type `\/aidw:approve`/);
    expect(read("skills/approve/SKILL.md")).toMatch(/cannot ask \(a headless session\)[^.]*`\/aidw:approve`/);
  });

  it("the Before / After lines are in the user's language, the heading stays", () => {
    expect(read("roles/product-manager/role.md")).toMatch(/user's language, the `lang` of the gate page[^.]*keep the headings `## Before \/ After`/);
    expect(read("skills/start/SKILL.md")).toMatch(/in the user's language \(the page `lang`; the headings stay in English/);
  });
});
