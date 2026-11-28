import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { taskConsultable } from "../src/consult.js";
import { checkEvals, loadEvalCases } from "../src/evals.js";
import { pathsFor } from "../src/project.js";
import { checkRoster, generateAgents, loadRole, loadRuleTable, parseRoleText, parseRulesTable, RULE_CHECKERS, skillFile } from "../src/roles.js";
import { buildBrief } from "../src/run.js";
import { parseTasks } from "../src/tasks.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

// The fullstack Role to the frontend pattern (plan T20, fullstack design): seam rules X1-X7, two authored skills,
// contract-tests moved to the shared library, the five backend and five frontend scripts listed by condition.
const plugin = join(__dirname, "..", "plugins", "aidw");
const rulesFile = join(plugin, "roles", "fullstack", "rules.md");
const skillsDir = join(plugin, "roles", "fullstack", "skills");
const AUTHORED = ["seam-test", "server-to-client-data"];
const SKILLS = [...AUTHORED, "library/contract-tests", "library/react-rules", "library/external-api", "library/resilient-integration"];
const BACKEND_SCRIPTS = ["route-inventory", "env-names", "error-shape-probe", "query-count", "leak-and-timeout-scan"];
const FRONTEND_SCRIPTS = ["token-literals", "a11y-names", "public-env-scan", "fetch-waterfalls", "route-guard-inventory"];
const BACKEND_SKILLS = ["endpoint-test-matrix", "transactions-and-races", "repeat-safe-writes", "effects-after-commit", "server-logs-and-errors", "query-shape"];
const FRONTEND_SKILLS = ["screen-states", "accessible-interactions", "testing-through-the-user", "client-data-and-state", "forms-from-the-contract"];

describe("fullstack rules.md", () => {
  const rules = loadRuleTable(plugin, "fullstack") ?? [];

  it("parses as one table with no problems and ids X1 to X7 in order", () => {
    expect(parseRulesTable(readFileSync(rulesFile, "utf8")).problems).toEqual([]);
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 7 }, (_, i) => `X${i + 1}`));
  });

  it("every row has a rule, an applies-when and only known checkers", () => {
    for (const r of rules) {
      expect(r.rule.length, r.id).toBeGreaterThan(20);
      expect(r.appliesWhen.length, r.id).toBeGreaterThan(5);
      expect(r.checkedBy.length, r.id).toBeGreaterThan(0);
      for (const c of r.checkedBy) expect(RULE_CHECKERS, `${r.id}: ${c}`).toContain(c);
    }
  });

  it("every Role a rule says to ask is one fullstack may consult", () => {
    const consults = loadRole(plugin, "fullstack")!.consults;
    const asked = rules.flatMap((r) => [...r.rule.matchAll(/ask `([a-z-]+)`/g)].map((m) => m[1]!));
    expect(new Set(asked)).toEqual(new Set(["api-designer"]));
    for (const a of asked) expect(consults, a).toContain(a);
  });

  it("says the backend and frontend tables bind through follows_rules and the X rules need both halves", () => {
    const text = readFileSync(rulesFile, "utf8");
    expect(text).toMatch(/B1 to B15/);
    expect(text).toMatch(/F1 to F16/);
    expect(text).toMatch(/follows_rules/);
    expect(text).toMatch(/both a server half and a client half/);
  });
});

describe("fullstack role.md", () => {
  const role = loadRole(plugin, "fullstack")!;

  it("consults and reads are the decided lists", () => {
    expect(role.consults).toEqual(["api-designer", "database-architect", "software-architect", "ui-ux-designer", "research"]);
    expect(parseRoleText(readFileSync(join(plugin, "roles", "fullstack", "role.md"), "utf8"))!.header.reads).toEqual(["tasks", "delta-specs", "constitution", "design-direction", "design-tokens"]);
    expect(role.follows_rules).toEqual(["backend", "frontend"]);
    expect(role.includes).toEqual(["library/implement-a-task.md"]);
  });

  it("indexes the two authored skills and four library skills, each with a condition and a file", () => {
    expect(role.skills.map((s) => s.name)).toEqual(SKILLS);
    for (const s of role.skills) {
      expect(s.when, s.name).toMatch(/^when /);
      expect(existsSync(join(plugin, skillFile("fullstack", s.name))), s.name).toBe(true);
    }
    expect(role.skills.find((s) => s.name === "library/react-rules")!.when).toBe(loadRole(plugin, "frontend")!.skills.find((s) => s.name === "library/react-rules")!.when);
  });

  it("has the sections in order, a 12-line report with a Seam and a Found line", () => {
    const headings = [...role.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.slice(0, 8)).toEqual(["Responsibility", "Boundaries and hand-off", "Procedure", "Scaffold task", "Done when", "Report", "Whom to ask", "Scripts"]);
    const block = /^## Report[\s\S]*?```\n([\s\S]*?)```/m.exec(role.body)![1]!;
    expect(block.trim().split("\n").length).toBeLessThanOrEqual(12);
    for (const k of ["Works now", "Server", "Screens", "Seam", "Files", "Verify", "Rules", "Scripts", "Asked", "Owed", "Found"]) expect(block, k).toMatch(new RegExp(`^${k}: `, "m"));
    expect(role.body).toMatch(/at most 12 lines/);
  });

  it("works outside in: the seam test is written before the server half and the screen", () => {
    const proc = /## Procedure[\s\S]*?(?=\n## )/.exec(role.body)![0];
    const at = (re: RegExp) => proc.search(re);
    expect(at(/^4\. Write the seam test first/m)).toBeGreaterThan(-1);
    expect(at(/^4\. Write the seam test first/m)).toBeLessThan(at(/^5\. Build the server half/m));
    expect(at(/^5\. Build the server half/m)).toBeLessThan(at(/^6\. Build the screen/m));
    expect(proc).toMatch(/CONSULT <request path>/);
  });

  it("reads F11 and F14 through X5 in the boundaries table, and sends only a split Slice to integration", () => {
    const table = /## Boundaries and hand-off[\s\S]*?(?=\n## )/.exec(role.body)![0];
    expect(table).toMatch(/X5 reads F11 and F14/);
    expect(table).toMatch(/\| `integration` \|/);
    expect(table).toMatch(/Slice split into backend, frontend and `integration` tasks/);
    expect(table).toMatch(/ask `database-architect` \(B15\)/);
    expect(table).toMatch(/ask `ui-ux-designer` as a Consultation \(F2\)/);
  });

  it("lists the ten scripts by path with a condition, and every one exists", () => {
    expect(role.body).toContain("aidw plugin-path roles/<role>/scripts/<name>.mjs");
    const scripts = /## Scripts[\s\S]*?(?=\n## )/.exec(role.body)![0];
    for (const [r, names] of [["backend", BACKEND_SCRIPTS], ["frontend", FRONTEND_SCRIPTS]] as const) {
      expect(scripts, r).toContain(`roles/${r}/scripts/`);
      for (const n of names) {
        expect(scripts, n).toMatch(new RegExp(`^- \`${n}\`: when `, "m"));
        expect(existsSync(join(plugin, "roles", r, "scripts", `${n}.mjs`)), n).toBe(true);
      }
    }
  });

  it("keeps pointers to the six backend and five frontend skills", () => {
    for (const s of BACKEND_SKILLS) expect(role.body, s).toContain(`aidw plugin-path roles/backend/skills/${s}.md`);
    for (const s of FRONTEND_SKILLS) expect(role.body, s).toContain(`aidw plugin-path roles/frontend/skills/${s}.md`);
  });

  it("has a short scaffold section: one Verify for both halves, a harness each, env names, no feature code", () => {
    const s = /## Scaffold task[\s\S]*?(?=\n## )/.exec(role.body)![0];
    expect(s).toMatch(/one Verify command that runs the tests of both halves/);
    expect(s).toMatch(/\.env\.example/);
    expect(s).toMatch(/no feature code/);
  });

  it("the committed fullstack and integration agents are what role.md and rules.md generate", () => {
    const gen = generateAgents(plugin);
    for (const n of ["fullstack.md", "integration.md"]) expect(readFileSync(join(plugin, "agents", n), "utf8"), n).toBe(gen[n]);
    expect(gen["fullstack.md"]).toContain("| X7 |");
  });
});

describe("fullstack skills", () => {
  const parse = (file: string) => {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
    if (!m) throw new Error(`${file}: no front matter`);
    return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
  };

  it("ships exactly the two authored skills", () => {
    expect(readdirSync(skillsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort()).toEqual([...AUTHORED].sort());
  });

  it.each(AUTHORED)("%s has a name, a description, Steps, a right/wrong pair and Sources last", (name) => {
    const { meta, body } = parse(join(skillsDir, `${name}.md`));
    expect(meta.name).toBe(name);
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings).toEqual(["Steps", "Right and wrong", "Sources"]);
    const pair = body.slice(body.indexOf("## Right and wrong"), body.indexOf("## Sources"));
    expect(pair).toMatch(/^Right\b/m);
    expect(pair).toMatch(/^Wrong\b/m);
    expect(body).toMatch(/Serves rules? X\d+/);
  });

  it("seam-test serves X1 and X6 and names the three stack families; the other serves X3, X4 and X7", () => {
    const seam = readFileSync(join(skillsDir, "seam-test.md"), "utf8");
    expect(seam).toMatch(/Serves rules X1 and X6/);
    for (const w of ["MSW", "Next.js", "SvelteKit and Nuxt"]) expect(seam, w).toContain(w);
    expect(readFileSync(join(skillsDir, "server-to-client-data.md"), "utf8")).toMatch(/Serves rules X3, X4 and X7/);
  });
});

describe("rule ids cited by fullstack", () => {
  it("every B, F and X id in role.md and its skills is a row of the backend, frontend or fullstack table", () => {
    const ids = new Set(["backend", "frontend", "fullstack"].flatMap((r) => (loadRuleTable(plugin, r) ?? []).map((x) => x.id)));
    const files = [join(plugin, "roles", "fullstack", "role.md"), ...AUTHORED.map((n) => join(skillsDir, `${n}.md`))];
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/\b[BFX]\d+ to [BFX]\d+/g, "");
      for (const m of text.matchAll(/\b([BFX]\d+)\b/g)) expect(ids, `${f}: ${m[1]}`).toContain(m[1]);
    }
  });
});

describe("contract-tests in the shared library", () => {
  it("lives at library/skills/contract-tests/SKILL.md and the old path is gone", () => {
    expect(existsSync(join(plugin, "library", "skills", "contract-tests", "SKILL.md"))).toBe(true);
    expect(existsSync(join(plugin, "roles", "integration", "skills", "contract-tests.md"))).toBe(false);
    expect(skillFile("integration", "library/contract-tests")).toBe("library/skills/contract-tests/SKILL.md");
  });

  it("resolves for both integration and fullstack", () => {
    for (const id of ["integration", "fullstack"]) {
      const s = loadRole(plugin, id)!.skills.find((x) => x.name === "library/contract-tests");
      expect(s, id).toBeDefined();
      expect(s!.when, id).toMatch(/^when /);
      expect(existsSync(join(plugin, skillFile(id, "library/contract-tests"))), id).toBe(true);
    }
    expect(loadRole(plugin, "integration")!.skills.find((x) => x.name === "library/contract-tests")!.when).toBe("when the client and the server meet over an HTTP or RPC contract, to prove they agree");
  });
});

// ---------------------------------------------------------------- acceptance: cases, roster, consult gate, briefs

describe("fullstack level 1 cases and the roster", () => {
  it("ships nine cases that together cover X1 to X7 and every skill role.md lists", () => {
    const { cases, diags } = loadEvalCases(plugin, "fullstack");
    expect(diags.errors).toEqual([]);
    expect(cases).toHaveLength(9);
    const covered = new Set(cases.flatMap((c) => c.covers));
    for (const r of loadRuleTable(plugin, "fullstack")!) expect(covered, r.id).toContain(r.id);
    for (const s of loadRole(plugin, "fullstack")!.skills) expect(covered, s.name).toContain(s.name);
  });

  it("the roster and the eval checks report no error", () => {
    expect(checkRoster(plugin).errors).toEqual([]);
    expect(checkEvals(plugin).errors).toEqual([]);
  });
});

describe("X5 reads F11 and F14 when the server half is in Touches", () => {
  it("the X5 row and the boundaries row say the access check and a named computed field are fullstack's", () => {
    const x5 = loadRuleTable(plugin, "fullstack")!.find((r) => r.id === "X5")!;
    expect(x5.rule).toMatch(/Touches hold the server half/);
    expect(x5.rule).toMatch(/F11 and F14/);
    expect(x5.rule).toMatch(/access check is always yours/);
    expect(x5.rule).toMatch(/computed field the contract names is yours/);
    expect(x5.rule).toMatch(/ask `api-designer` only when/);
    expect(x5.appliesWhen).toMatch(/F11 or F14/);
    const row = loadRole(plugin, "fullstack")!.body.split("\n").find((l) => l.includes("X5 reads F11 and F14"))!;
    expect(row).toMatch(/when the server half is in Touches/);
    expect(row).toMatch(/access check is always yours/);
  });
});

describe("contract-tests through aidw plugin-path", () => {
  it("the new path resolves and the old one does not", () => {
    const pp = (rel: string) => {
      let out = "";
      let err = "";
      const code = run(["plugin-path", rel], {}, plugin, { out: (s) => (out += s), err: (s) => (err += s) });
      return { code, out: out.trim(), err };
    };
    const ok = pp("library/skills/contract-tests/SKILL.md");
    expect(ok.code, ok.err).toBe(0);
    expect(existsSync(ok.out)).toBe(true);
    expect(pp("roles/integration/skills/contract-tests.md").code).not.toBe(0);
  });
});

const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
const vendor = join(plugin, "library", "vendor");
const ID = "2026-11-24-booking";
const OK = `node -e "process.exit(0)"`;
const FS_TASKS = `tasks:
  - id: T01
    title: Reschedule a booking
    role: fullstack
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["app/api/**", "app/(site)/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Booking page
    role: frontend
    type: feat
    depends_on: []
    touches: ["app/(site)/**"]
    verify: ['${OK}']
    status: pending
`;
const cli = (rootDir: string, ...argv: string[]) => {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", rootDir], {}, rootDir, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
};

function fullstackProject(): string {
  const rootDir = tempProject();
  temps.push(rootDir);
  expect(cli(rootDir, "init").code).toBe(0);
  write(rootDir, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(rootDir, "change", "new", ID, "--title", "Booking").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(rootDir, `${c}/analysis.md`, ANALYSIS_MD);
  write(rootDir, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(rootDir, ".aidw/design/direction.md", "# Direction\n");
  write(rootDir, `${c}/tasks.yaml`, FS_TASKS);
  write(rootDir, `${c}/quality.yaml`, QUALITY_YAML);
  write(rootDir, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(rootDir, ".aidw/architecture/overview.md", "# Architecture\n");
  write(rootDir, "package.json", JSON.stringify({ name: "x", dependencies: { react: "^19.0.0", vite: "^6.0.1", express: "^5.1.0" } }));
  planReviewed(rootDir, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const t = cli(rootDir, "transition", ID, s);
    expect(t.code, t.err + t.out).toBe(0);
  }
  const approved = cli(rootDir, "approve", ID);
  expect(approved.code, approved.err + approved.out).toBe(0);
  expect(cli(rootDir, "transition", ID, "executing").code).toBe(0);
  return rootDir;
}

describe("the consult gate for fullstack", () => {
  const taskOf = (rootDir: string, id: string) => parseTasks(readFileSync(join(rootDir, ".aidw/changes", ID, "tasks.yaml"), "utf8")).tasks.find((t) => t.id === id)!;

  it("offers ui-ux-designer to a fullstack task once the design exists, and database-architect once a data model does", () => {
    const rootDir = fullstackProject();
    write(rootDir, `.aidw/changes/${ID}/data-model.md`, "# Data model\n");
    const offered = taskConsultable(pathsFor(rootDir), ID, taskOf(rootDir, "T01"), plugin);
    expect(offered.role).toBe("fullstack");
    expect(offered.roles).toContain("ui-ux-designer");
    expect(offered.roles).toContain("database-architect");
  });

  it("records a Consultation from fullstack to ui-ux-designer and spawns it", () => {
    const rootDir = fullstackProject();
    expect(cli(rootDir, "task", "start", "T01").code).toBe(0);
    const file = write(rootDir, `.aidw/changes/${ID}/consult/T01.request.md`, `---\nfrom: fullstack\ntask: T01\nto: ui-ux-designer\n---\n\n## Question\n\nWhat does the reschedule button show while the request is in flight?\n\n## Progress\n\nDone so far: the seam test.\nNext step: the screen.\nFiles touched: app/api/bookings/route.ts\n`);
    const r = cli(rootDir, "consult", file);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/C01 recorded: fullstack \(T01\) asks ui-ux-designer/);
    expect(r.out).toMatch(/SPAWN aidw:ui-ux-designer/);
  });

  it("still refuses a Role fullstack does not declare", () => {
    const rootDir = fullstackProject();
    expect(cli(rootDir, "task", "start", "T01").code).toBe(0);
    const file = write(rootDir, `.aidw/changes/${ID}/consult/T01.request.md`, `---\nfrom: fullstack\ntask: T01\nto: qa\n---\n\n## Question\n\nWhich layer?\n\n## Progress\n\nDone so far: nothing.\nNext step: tests.\nFiles touched: none\n`);
    const r = cli(rootDir, "consult", file);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/fullstack does not consult qa/);
  });
});

describe("briefs of a fullstack task", () => {
  const rulesOf = (r: string) => join(plugin, "roles", r, "rules.md");

  it("the review brief points at fullstack's, backend's and frontend's rules.md, each a table with ids", () => {
    const rootDir = fullstackProject();
    const text = buildBrief(pathsFor(rootDir), ID, "T01", "review", vendor).text;
    expect(text).toContain("## Rules of the Role that built it (fullstack)");
    for (const r of ["fullstack", "backend", "frontend"]) expect(text, r).toContain(`\`${rulesOf(r)}\`: rules of ${r}, one per row with an id.`);
    expect(text).toMatch(/cite its id \(for example `X1`\)/);
  });

  it("the implement brief points at the backend and frontend rules it follows, not its own (they are in its profile)", () => {
    const rootDir = fullstackProject();
    const text = buildBrief(pathsFor(rootDir), ID, "T01", "implement", vendor).text;
    expect(text).toContain("## Rules of the Roles yours follows");
    for (const r of ["backend", "frontend"]) expect(text, r).toContain(`\`${rulesOf(r)}\``);
    expect(text).not.toContain(`\`${rulesOf("fullstack")}\``);
  });

  it("names the React skill and the UI skills as the frontend brief does, plus the API pair for its server half", () => {
    const rootDir = fullstackProject();
    const ids = (t: string) => buildBrief(pathsFor(rootDir), ID, t, "implement", vendor).skills.map((s) => s.id);
    const fs = ids("T01");
    const fe = ids("T02");
    expect(fe).toContain("aidw/react-rules");
    expect(fs).toContain("aidw/react-rules");
    for (const s of fe.filter((x) => x !== "anthropic/frontend-design")) expect(fs, s).toContain(s);
    expect(fs).toContain("aidw/api-design-rules");
    for (const s of buildBrief(pathsFor(rootDir), ID, "T01", "implement", vendor).skills) expect(existsSync(s.path), s.path).toBe(true);
  });

  it("the generated fullstack agent names each of its skills with a resolvable plugin path", () => {
    const agent = readFileSync(join(plugin, "agents", "fullstack.md"), "utf8");
    for (const s of loadRole(plugin, "fullstack")!.skills) {
      expect(agent, s.name).toContain(`- \`${s.name}\`: ${s.when}`);
      const rel = skillFile("fullstack", s.name);
      expect(agent, s.name).toContain(`aidw plugin-path ${rel}`);
      expect(existsSync(join(plugin, rel)), rel).toBe(true);
    }
  });
});
