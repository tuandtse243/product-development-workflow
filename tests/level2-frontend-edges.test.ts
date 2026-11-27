import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Diags } from "../src/diag.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, noScreenshotsBrief, prepareCopy, removeTree, runCheck, runLevel2, type AgentRunner, type Level2Case } from "../src/evallevel2.js";

/**
 * Edge tests for the frontend level 2 case book-a-slot-screen and its harness, with no model: plausible wrong solutions
 * each of which must fail a check or a held-out test, plausible correct ones that must pass, `screenshots: off` on odd
 * briefs, the custom jsdom environment's `{ signal }` handling, the restore list, and determinism.
 * A test named "LIMIT: ..." pins a documented limit of the case (see its case.md), not a defect.
 * Needs the fixture's packages in the cache (AIDW_FIXTURE_CACHE) and the built plugin bin; skipped without them.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "frontend-web");
const reference = join(repo, "evals", "level2-reference");
const CASE = "book-a-slot-screen";
const noInstall = () => {
  throw new Error("not installed");
};
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "frontend-web", process.env, noInstall).nodeModules;
} catch {
  nodeModules = null;
}
const ready = !!nodeModules && existsSync(join(plugin, "bin", "aidw"));
const scriptsReady = ["a11y-names", "token-literals"].every((s) => existsSync(join(plugin, "roles", "frontend", "scripts", `${s}.mjs`)));

const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
const pilot = (): Level2Case => loadLevel2Cases(plugin, "frontend").cases.find((c) => c.name === CASE)!;

type Prep = ReturnType<typeof prepareCopy>;
function commands(c: Level2Case, prep: Prep) {
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => runCheck(c.checks.find((ch) => name.test(ch.name))!, prep.project, env);
  const sh = (cmd: string) => {
    const r = spawnSync("sh", ["-c", cmd], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  const heldOut = () => sh(`npm test --silent -- ${c.heldOut.join(" ")}`);
  return { prep, project: prep.project, env, check, sh, heldOut };
}
type G = ReturnType<typeof commands>;

/** A prepared copy with the reference solution laid over it and the held-out files copied in. */
function graded(): G {
  const c = pilot();
  const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-edge-"), "project"));
  cpSync(join(reference, CASE), prep.project, { recursive: true });
  cpSync(join(plugin, c.dir, "held-out"), prep.project, { recursive: true });
  return commands(c, prep);
}

const failedTests = (out: string) => [...new Set([...out.matchAll(/(?:×|FAIL) .*?> ([^\n]+)$/gm)].map((m) => m[1]!.split(" > ").pop()!.replace(/\s+\d+ms\s*$/, "").trim()))];
const put = (g: G, rel: string, text: string) => {
  mkdirSync(dirname(join(g.project, rel)), { recursive: true });
  writeFileSync(join(g.project, rel), text);
};
/** Replaces text in a file of the copy; throws when there is nothing to replace (a variant that silently changed nothing would pass). */
const swap = (g: G, rel: string, from: string | RegExp, to: string) => {
  const p = join(g.project, rel);
  const s = readFileSync(p, "utf8");
  const t = s.replace(from, to);
  if (t === s) throw new Error(`nothing to replace for ${String(from)} in ${rel}`);
  writeFileSync(p, t);
};
const SCREEN = "src/booking/BookSlotScreen.tsx";
const LIST = "src/booking/SlotList.tsx";

// ------------------------------------------------------------------------------------------------ variants

const slotList = (open: string, close: string, extra = "") => `import type { Slot } from "./api";
import { Icon } from "../ui/Icon";

export interface SlotListProps {
  slots: Slot[];
  onPick: (slot: Slot, opener: HTMLButtonElement) => void;
}

export function SlotList({ slots, onPick }: SlotListProps) {
  return (
    <ul className="slot-list">
      {slots.map((slot) => (
        <li key={slot.id}>
          {slot.booked ? (
            <span className="slot slot--booked"${extra}>
              <Icon name="icon-check" />
              {slot.time} <span className="slot__state">Booked</span>
            </span>
          ) : (
            ${open}
              <Icon name="icon-clock" />
              {slot.time}
            ${close}
          )}
        </li>
      ))}
    </ul>
  );
}
`;
const PICK = "onPick(slot, e.currentTarget as unknown as HTMLButtonElement)";

const PLAIN_DIALOG = `import { useEffect, useId, useRef, type ReactNode } from "react";

/** A dialog of the screen's own: focus goes in, Escape closes; Tab is not trapped. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}
`;

const FOCUS_DIALOG = `import { useEffect, useRef } from "react";
import { Dialog, type DialogProps } from "../ui/Dialog";

/** The shared Dialog, and focus back on what had it when the dialog opened. */
export function FocusDialog(props: DialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (props.open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
  useEffect(() => {
    if (!props.open && wasOpen.current) opener.current?.focus();
    wasOpen.current = props.open;
  }, [props.open]);
  return <Dialog {...props} />;
}
`;

interface Variant {
  name: string;
  edit: (g: G) => void;
  /** held-out tests that must fail (their words); none: all 8 pass */
  fails?: RegExp[];
  passes?: RegExp[];
  a11y?: boolean;
  tokens?: boolean;
  touches?: boolean;
}

const WRONG: Variant[] = [
  {
    name: "slots are <a href> links, not buttons",
    edit: (g) => put(g, LIST, slotList(`<a href="#" className="slot" onClick={(e) => { e.preventDefault(); ${PICK}; }}>`, "</a>")),
    fails: [/every open slot is a button/, /picking a slot opens a dialog/],
    passes: [/a day with no slots/],
  },
  {
    name: 'slot buttons named aria-label="slot" (not the time)',
    edit: (g) => put(g, LIST, slotList(`<button type="button" aria-label="slot" className="slot" onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>")),
    fails: [/every open slot is a button/, /picking a slot opens a dialog/],
  },
  {
    name: "slots are role=listbox options (the case asks for buttons)",
    edit: (g) => {
      put(g, LIST, slotList(`<button type="button" role="option" aria-selected="false" className="slot" onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>"));
      swap(g, LIST, '<ul className="slot-list">', '<ul className="slot-list" role="listbox" aria-label="Slots">');
    },
    fails: [/every open slot is a button/],
  },
  {
    name: "focus goes to the heading, not the slot, after Escape",
    edit: (g) => swap(g, SCREEN, /if \(el\?\.isConnected && !el\.disabled\) el\.focus\(\);\n\s+else heading\.current\?\.focus\(\);/, "heading.current?.focus();"),
    fails: [/Escape closes the dialog without booking and puts focus back on the slot/],
    passes: [/picking a slot opens a dialog/, /confirming sends the booking/],
  },
  {
    name: "the load error is a plain <div>, no role=alert",
    edit: (g) => swap(g, SCREEN, '<div role="alert" className="booking__error">', '<div className="booking__error">'),
    fails: [/a failed load is an alert/],
    passes: [/a day with no slots/, /Escape closes the dialog/],
  },
  {
    name: "Retry is a <span onClick>",
    edit: (g) => swap(g, SCREEN, "<Button onClick={retry}>Retry</Button>", "<span onClick={retry}>Retry</span>"),
    fails: [/a failed load is an alert/],
  },
  {
    name: "Retry is an <a href>",
    edit: (g) => swap(g, SCREEN, "<Button onClick={retry}>Retry</Button>", '<a href="#retry" onClick={(e) => { e.preventDefault(); retry(); }}>Retry</a>'),
    fails: [/a failed load is an alert/],
  },
  {
    name: "a booking does not update the list (no markBooked after the POST)",
    edit: (g) => swap(g, SCREEN, /await bookSlot\(slot\.id\);\n\s+markBooked\(slot\.id\);/, "await bookSlot(slot.id);"),
    fails: [/confirming sends the booking/],
    passes: [/picking a slot opens a dialog/],
  },
  {
    name: "a hardcoded color in style={{}}",
    edit: (g) => put(g, LIST, slotList(`<button type="button" className="slot" style={{ color: "#d12b2b" }} onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>")),
    tokens: false,
  },
  {
    name: "a numeric padding in style={{}} (13 means 13px)",
    edit: (g) => put(g, LIST, slotList(`<button type="button" className="slot" style={{ padding: 13 }} onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>")),
    tokens: false,
  },
  {
    name: "a px literal in a new CSS module",
    edit: (g) => put(g, "src/booking/extra.module.css", ".x {\n  padding: 13px;\n}\n"),
    tokens: false,
  },
  {
    name: "a px literal behind a local custom property",
    edit: (g) => swap(g, "src/booking/booking.css", ".slot {\n", ".slot {\n  --slot-gap: 73px;\n  margin: var(--slot-gap);\n"),
    tokens: false,
  },
  {
    name: "a hex color inside a styled string of a Tailwind class",
    edit: (g) => put(g, LIST, slotList(`<button type="button" className="slot bg-[#d12b2b]" onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>")),
    tokens: false,
  },
  {
    name: "fixes the Dialog's focus return in src/ui/Dialog.tsx (outside Touches)",
    edit: (g) => swap(g, "src/ui/Dialog.tsx", "const titleId = useId();", "const titleId = useId();\n  const from = useRef<Element | null>(null);\n  if (open && !from.current) from.current = document.activeElement;"),
    touches: false,
  },
  {
    name: "adds a token to src/styles/tokens.css for its literal (outside Touches)",
    edit: (g) => {
      swap(g, "src/styles/tokens.css", ":root {\n", ":root {\n  --size-slot-min: 73px;\n");
      swap(g, "src/booking/booking.css", ".slot {\n", ".slot {\n  min-width: var(--size-slot-min);\n");
    },
    touches: false,
  },
];

const CORRECT: Variant[] = [
  {
    name: "focus return done in src/booking by wrapping the shared Dialog",
    edit: (g) => {
      put(g, "src/booking/FocusDialog.tsx", FOCUS_DIALOG);
      swap(g, SCREEN, 'import { Dialog } from "../ui/Dialog";', 'import { FocusDialog as Dialog } from "./FocusDialog";');
      swap(g, SCREEN, /const close = \(\) => \{[\s\S]*?\n {2}\};/, "const close = () => setPending(null);");
    },
  },
  {
    name: "a CSS variable through var(--token) in style={{}}",
    edit: (g) => put(g, LIST, slotList(`<button type="button" className="slot" style={{ color: "var(--color-text-muted)", padding: "var(--space-2)" }} onClick={(e) => onPick(slot, e.currentTarget)}>`, "</button>")),
  },
  {
    name: "native buttons named by aria-label with the time, hidden icon, different structure",
    edit: (g) =>
      put(
        g,
        LIST,
        `import type { Slot } from "./api";

export function SlotList({ slots, onPick }: { slots: Slot[]; onPick: (slot: Slot, opener: HTMLButtonElement) => void }) {
  return (
    <ul className="slot-list">
      {slots.map((s) => (
        <li key={s.id}>
          {s.booked ? (
            <p className="slot slot--booked">{s.time} - Booked</p>
          ) : (
            <button type="button" className="slot" aria-label={\`Book \${s.time}\`} onClick={(e) => onPick(s, e.currentTarget)}>
              {s.time}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
`,
      ),
  },
  {
    name: "a plain <button> for Retry and <p role=alert> for the error",
    edit: (g) => swap(g, SCREEN, /<div role="alert" className="booking__error">[\s\S]*?<\/div>\n\s+\)\}\n\s+\{state\.status === "ready"/, '<p role="alert" className="booking__error">Something went wrong.</p>\n      )}\n      {state.status === "error" && <button type="button" onClick={retry}>Try again</button>}\n      {state.status === "ready"'),
  },
];

const verdict = (g: G) => {
  const t = g.heldOut();
  return { t, failed: failedTests(t.out).join("\n"), a11y: g.check(/a11y-names/), tokens: g.check(/token-literals/), touches: g.check(/nothing outside Touches/) };
};

describe.skipIf(!ready || !scriptsReady)(`level 2 ${CASE}: plausible wrong solutions (no model)`, () => {
  for (const v of WRONG) {
    it(`fails a check or a held-out test: ${v.name}`, () => {
      const g = graded();
      v.edit(g);
      const r = verdict(g);
      const heldFails = !!v.fails;
      if (heldFails) {
        expect(r.t.status, r.t.out).not.toBe(0);
        for (const f of v.fails!) expect(r.failed, r.t.out).toMatch(f);
        for (const p of v.passes ?? []) expect(r.failed, r.t.out).not.toMatch(p);
      } else {
        expect(r.t.status, r.t.out).toBe(0);
      }
      if (v.a11y === false) expect(r.a11y.pass).toBe(false);
      if (v.tokens === false) expect(r.tokens, JSON.stringify(r.tokens)).toMatchObject({ pass: false });
      if (v.touches === false) expect(r.touches.pass).toBe(false);
      // every wrong variant is caught by at least one of the three
      const caught = heldFails || r.a11y.pass === false || r.tokens.pass === false || r.touches.pass === false;
      expect(caught).toBe(true);
    }, 600_000);
  }

  for (const v of CORRECT) {
    it(`passes held-out tests, a11y-names, token-literals and Touches: ${v.name}`, () => {
      const g = graded();
      v.edit(g);
      const r = verdict(g);
      expect(r.t.status, r.t.out).toBe(0);
      expect(r.t.out).toMatch(/8 passed/);
      expect(r.a11y, JSON.stringify(r.a11y)).toMatchObject({ pass: true });
      expect(r.tokens, JSON.stringify(r.tokens)).toMatchObject({ pass: true });
      expect(r.touches, JSON.stringify(r.touches)).toMatchObject({ pass: true });
    }, 600_000);
  }

  /** A probe test a reviewer would add: written into the copy, not part of the case. */
  const TAB_PROBE = `import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderAt } from "../render";

it("Tab and Shift+Tab stay inside the open dialog", async () => {
  const { user } = renderAt("/doctors/d1/days/2030-01-07");
  await user.click(await screen.findByRole("button", { name: /09:00/ }));
  const dialog = await screen.findByRole("dialog", { name: /09:00/ });
  for (let i = 0; i < 5; i++) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  for (let i = 0; i < 5; i++) {
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
});
`;
  const tabProbe = (g: G) => {
    put(g, "tests/booking/tab-probe.test.tsx", TAB_PROBE);
    return g.sh("npm test --silent -- tests/booking/tab-probe.test.tsx");
  };

  it("the Tab probe passes on the reference (the shared Dialog traps Tab) and fails on a dialog of the screen's own that does not", () => {
    const ok = graded();
    const t1 = tabProbe(ok);
    expect(t1.status, t1.out).toBe(0);
    const g = graded();
    put(g, "src/booking/PlainDialog.tsx", PLAIN_DIALOG);
    swap(g, SCREEN, 'import { Dialog } from "../ui/Dialog";', 'import { Dialog } from "./PlainDialog";');
    const t2 = tabProbe(g);
    expect(t2.status, t2.out).not.toBe(0);
  }, 600_000);

  it("LIMIT: a dialog that does not trap Tab passes every grader (no scenario of the Change states a Tab trap, see case.md)", () => {
    const g = graded();
    put(g, "src/booking/PlainDialog.tsx", PLAIN_DIALOG);
    swap(g, SCREEN, 'import { Dialog } from "../ui/Dialog";', 'import { Dialog } from "./PlainDialog";');
    const r = verdict(g);
    expect(r.t.status === 0 && r.a11y.pass && r.tokens.pass && r.touches.pass, "the solution passes every machine grader").toBe(true);
  }, 600_000);

  it("a screen with no loading indication fails a held-out test (scenario slots-loading)", () => {
    const g = graded();
    swap(g, SCREEN, '{state.status === "loading" && <Spinner label="Loading slots…" />}', "");
    const r = verdict(g);
    expect(r.t.status, "the held-out tests fail").not.toBe(0);
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------ screenshots: off

const BRIEF = ["# Task T01", "", "- **Design**: style through the tokens below", "- **Screenshots**: when it works, save at most 6 PNG", "- Take screenshots with Playwright", "", "## Design tokens", ""].join("\n");

describe("screenshots: off on briefs of other wording", () => {
  it("drops exactly the two lines and keeps the rest, also with CRLF line ends", () => {
    expect(noScreenshotsBrief(BRIEF)).toBe(["# Task T01", "", "- **Design**: style through the tokens below", "", "## Design tokens", ""].join("\n"));
    const crlf = noScreenshotsBrief(BRIEF.replace(/\n/g, "\r\n"));
    expect(crlf).not.toMatch(/Screenshots|Playwright/);
    expect(crlf).toContain("- **Design**: style through the tokens below\r");
  });

  it.each([
    ["no screenshot line at all", BRIEF.split("\n").filter((l) => !/creenshot/.test(l)).join("\n"), /no screenshot line to drop/],
    ["only one of the two", BRIEF.replace("- Take screenshots with Playwright\n", ""), /exactly the two screenshot lines.*1 lines/],
    ["a third matching line", `${BRIEF}- **Screenshots**: again\n`, /exactly the two screenshot lines.*3 lines/],
    ["the label reworded with the colon inside the bold", BRIEF.replace("**Screenshots**:", "**Screenshots:**"), /exactly the two.*1 lines/],
    ["indented as a nested bullet", BRIEF.replace("- **Screenshots**", "  - **Screenshots**"), /exactly the two.*1 lines/],
    ["the Playwright line reworded to lower case", BRIEF.replace("Take screenshots with Playwright", "take screenshots with playwright"), /exactly the two.*1 lines/],
    ["an empty brief", "", /no screenshot line to drop/],
  ])("throws, never silently keeps a screenshot line: %s", (_n, text, why) => {
    expect(() => noScreenshotsBrief(text)).toThrow(why);
  });

  it("does not touch a prose mention of screenshots elsewhere, and says so only by the two exact lines", () => {
    const text = `${BRIEF}\nA screenshot of the old screen is in docs/.\n`;
    expect(noScreenshotsBrief(text)).toContain("A screenshot of the old screen");
  });

  /** A plugin root holding one frontend level 2 case with the given front matter lines. */
  const caseRoot = (front: string[]) => {
    const root = temp("aidw-l2fe-root-");
    const dir = join(root, "roles", "frontend", "evals", "level2", "c1");
    mkdirSync(join(dir, "held-out", "tests"), { recursive: true });
    writeFileSync(join(dir, "held-out", "tests", "a.test.ts"), "// held out\n");
    writeFileSync(join(dir, "case.md"), `---\ncase: c1\nfixture: frontend-web\ntask: T01\n${front.join("\n")}\n---\n## Situation\n\nx\n\n## Criteria\n\n- must do it\n`);
    return root;
  };
  it.each([
    ["off", false, 0],
    ["on", true, 0],
    ["false", false, 0],
    ["true", true, 0],
    ['"off"', false, 0],
    ["OFF", true, 1],
    ["no", true, 1],
    ["0", true, 1],
    ['""', true, 1],
    ["", true, 1],
  ])("the front matter key `screenshots: %s` reads as %s with %i error(s)", (raw, shots, errors) => {
    const { cases, diags } = loadLevel2Cases(caseRoot([`screenshots: ${raw}`]), "frontend");
    expect(diags.errors).toHaveLength(errors);
    expect(cases[0]!.screenshots).toBe(shots);
  });

  it("a case without the key keeps the screenshot lines", () => {
    expect(loadLevel2Cases(caseRoot([]), "frontend").cases[0]!.screenshots).toBe(true);
  });

  it.skipIf(!ready)("prepareCopy fails loudly when the brief has no screenshot lines to drop (screenshots: off on a backend case, no screen)", () => {
    const b = loadLevel2Cases(plugin, "backend").cases[0]!;
    const fb = join(fixturesDir(plugin), b.fixture);
    let nm: string;
    try {
      nm = ensureFixturePackages(fb, b.fixture, process.env, noInstall).nodeModules;
    } catch {
      return; // the backend fixture's packages are not cached here
    }
    expect(() => prepareCopy(plugin, { ...b, screenshots: false }, fb, nm, join(temp("aidw-l2fe-nt-"), "project"))).toThrow(/screenshots: off, but the brief has no screenshot line to drop/);
  }, 120_000);

  it.skipIf(!ready)("the off brief asks for no screenshot, PNG, Playwright or browser; only two generic .aidw/ rules still say 'screenshots' (gap: harmless remnants)", () => {
    const prep = prepareCopy(plugin, pilot(), fixture, nodeModules as string, join(temp("aidw-l2fe-brief-"), "project"));
    const lines = prep.briefText.split("\n").filter((l) => /screenshot|playwright|\bpng\b|browser/i.test(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/Do not edit anything under `\.aidw\/` \(except the files this brief names: the report note, screenshots, a Consultation request\)/);
    expect(lines[1]).toMatch(/the only \.aidw file you may write besides screenshots/);
    expect(prep.briefText).not.toMatch(/playwright|\bpng\b|browser|take screenshots|save .*screenshot/i);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------ the jsdom environment

const PROBE = `import { afterEach, describe, expect, it, vi } from "vitest";

const target = () => document.createElement("div");
const fire = (t: EventTarget, type = "x") => t.dispatchEvent(new Event(type, { bubbles: true }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("jsdom-node-abort", () => {
  it("a listener with { signal } runs, and not after the signal aborts", () => {
    const ac = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: ac.signal });
    fire(t);
    ac.abort();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("{ signal, once: true } runs once", () => {
    const ac = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: ac.signal, once: true });
    fire(t);
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("once, then abort: nothing throws and nothing runs again", () => {
    const ac = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: ac.signal, once: true });
    fire(t);
    expect(() => ac.abort()).not.toThrow();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("an already aborted signal adds nothing (AbortSignal.abort())", () => {
    const t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: AbortSignal.abort() });
    fire(t);
    expect(fn).not.toHaveBeenCalled();
  });
  it("removing the listener by hand, before and after the abort, never throws", () => {
    const ac = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: ac.signal });
    t.removeEventListener("x", fn);
    fire(t);
    expect(fn).not.toHaveBeenCalled();
    expect(() => ac.abort()).not.toThrow();
    expect(() => t.removeEventListener("x", fn)).not.toThrow();
    const bc = new AbortController();
    t.addEventListener("x", fn, { signal: bc.signal });
    bc.abort();
    expect(() => t.removeEventListener("x", fn)).not.toThrow();
  });
  it("AbortSignal.timeout removes the listener when it fires", async () => {
    const t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: AbortSignal.timeout(30) });
    fire(t);
    await sleep(120);
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("AbortSignal.any (when Node has it) removes the listener when any source aborts", () => {
    if (typeof AbortSignal.any !== "function") return;
    const a = new AbortController(), b = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: AbortSignal.any([a.signal, b.signal]) });
    fire(t);
    b.abort();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a capture listener with { signal } is removed with its capture flag", () => {
    const ac = new AbortController(), parent = target(), child = document.createElement("span"), fn = vi.fn();
    parent.appendChild(child);
    parent.addEventListener("x", fn, { capture: true, signal: ac.signal });
    fire(child);
    ac.abort();
    fire(child);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  const takesSignal = (t: EventTarget) => {
    const ac = new AbortController(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: ac.signal });
    fire(t);
    ac.abort();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  };
  it("elements take { signal }", () => takesSignal(target()));
  it("a detached text node and a document fragment take { signal }", () => {
    takesSignal(document.createTextNode("t"));
    takesSignal(document.createDocumentFragment());
  });
  it("document and document.body take { signal }", () => {
    takesSignal(document);
    takesSignal(document.body);
  });
  it("window takes { signal }", () => takesSignal(window));
  it("one signal removes every listener added with it", () => {
    const ac = new AbortController(), t = target(), a = vi.fn(), b = vi.fn();
    t.addEventListener("x", a, { signal: ac.signal });
    t.addEventListener("y", b, { signal: ac.signal });
    ac.abort();
    fire(t, "x");
    fire(t, "y");
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
  it("{ signal: undefined } and plain boolean options still work", () => {
    const t = target(), a = vi.fn(), b = vi.fn();
    t.addEventListener("x", a, { signal: undefined });
    t.addEventListener("x", b, true);
    fire(t);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("an event object listener ({ handleEvent }) works with { signal }", () => {
    const ac = new AbortController(), t = target(), handleEvent = vi.fn();
    t.addEventListener("x", { handleEvent }, { signal: ac.signal });
    fire(t);
    expect(handleEvent).toHaveBeenCalledTimes(1);
  });
  it("AbortSignal and AbortController are Node's, so fetch and Request accept the signal", async () => {
    const ac = new AbortController();
    expect(() => new Request("http://localhost/x", { signal: ac.signal })).not.toThrow();
    ac.abort();
    await expect(fetch("http://localhost/x", { signal: ac.signal })).rejects.toBeTruthy();
  });
  it("the same listener added twice with two signals survives the abort of the second (the second add is ignored)", () => {
    const a = new AbortController(), b = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: a.signal });
    t.addEventListener("x", fn, { signal: b.signal });
    b.abort();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a listener removed by hand and added again without a signal survives the abort of the old signal", () => {
    const a = new AbortController(), t = target(), fn = vi.fn();
    t.addEventListener("x", fn, { signal: a.signal });
    t.removeEventListener("x", fn);
    t.addEventListener("x", fn);
    a.abort();
    fire(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => vi.restoreAllMocks());
`;

describe.skipIf(!ready)("the custom jsdom environment (tests/environment.ts) and { signal }", () => {
  let out: { status: number | null; out: string } | null = null;
  const run = () => {
    if (out) return out;
    const c = pilot();
    const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fe-env-"), "project"));
    const g = commands(c, prep);
    put(g, "tests/env-probe.test.ts", PROBE);
    out = g.sh("npm test --silent -- tests/env-probe.test.ts");
    return out;
  };

  it("handles { signal } with once, manual removal, AbortSignal.timeout and AbortSignal.any like a browser", () => {
    const r = run();
    const failed = failedTests(r.out).filter((n) => !/^(window takes|the same listener added twice|a listener removed by hand and added again)/.test(n));
    expect(failed, r.out).toEqual([]);
    expect(r.out).toMatch(/\d+ passed/);
  }, 300_000);

  it("window takes { signal } like an element and the document do", () => {
    const r = run();
    const failed = failedTests(r.out).filter((n) => /^window takes/.test(n));
    expect(failed, r.out).toEqual([]);
  }, 300_000);

  it("a duplicate add with a second signal is ignored by the browser, and the second signal's abort must not remove the listener", () => {
    const r = run();
    expect(failedTests(r.out), r.out).not.toContain("the same listener added twice with two signals survives the abort of the second (the second add is ignored)");
  }, 300_000);

  it("a listener removed by hand has no abort left behind: re-adding it without a signal must survive the old signal's abort", () => {
    const r = run();
    expect(failedTests(r.out), r.out).not.toContain("a listener removed by hand and added again without a signal survives the abort of the old signal");
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------ restore list and determinism

describe.skipIf(!ready || !scriptsReady)("the restore list and determinism", () => {
  it("a session that rewrites the test harness and the configs to hide its failures is still graded on the real ones", () => {
    const c = pilot();
    // lay over: the solution that does not return focus (fails held-out test 3), a broken test, a type error, a literal
    const sabotage: AgentRunner = (i) => {
      cpSync(join(reference, `${CASE}-no-focus-return`), i.cwd, { recursive: true });
      cpSync(join(reference, CASE), i.cwd, { recursive: true, force: false });
      const at = (rel: string, text: string) => {
        mkdirSync(dirname(join(i.cwd, rel)), { recursive: true });
        writeFileSync(join(i.cwd, rel), text);
      };
      at("tests/booking/broken.test.ts", 'import { expect, it } from "vitest";\nit("is broken", () => expect(1).toBe(2));\n');
      at("src/booking/typo.ts", 'export const n: number = "not a number";\n');
      // the configs: nothing is collected and nothing is checked
      at("vitest.config.ts", 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: [], passWithNoTests: true } });\n');
      const pkg = JSON.parse(readFileSync(join(i.cwd, "package.json"), "utf8")) as { scripts: Record<string, string> };
      pkg.scripts.test = "true";
      pkg.scripts.typecheck = "true";
      at("package.json", JSON.stringify(pkg, null, 2));
      at("tsconfig.json", '{ "compilerOptions": { "noEmit": true }, "files": [] }\n');
      // the harness: Escape also focuses a slot, so the missing focus return does not show
      const setup = join(i.cwd, "tests", "setup.ts");
      writeFileSync(setup, `${readFileSync(setup, "utf8")}\ndocument.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelector<HTMLElement>("button.slot")?.focus(); }, true);\n`);
      const tokens = join(i.cwd, ".aidw", "design", "tokens.yaml");
      writeFileSync(tokens, readFileSync(tokens, "utf8") + "\n  - name: size-slot-min\n    kind: size\n    value: 73px\n    use: x\n");
      const css = join(i.cwd, "src", "booking", "booking.css");
      writeFileSync(css, readFileSync(css, "utf8") + "\n.slot {\n  min-width: 73px;\n}\n");
      writeFileSync(i.logFile, JSON.stringify({ type: "result", subtype: "success", result: "all green" }));
      return { exit: 0, timedOut: false, turnLimit: false, turns: 1 };
    };
    const [r] = runLevel2({ root: plugin, role: "frontend", runs: 1, agent: sabotage, exec: () => "[]", install: noInstall, runsDir: temp("aidw-l2fe-runs-") }, c.name);
    const steps = r!.results[0]!.steps;
    const by = (n: string) => steps.find((s) => s.step === n)!;
    expect(r!.results[0]!.error).toBeUndefined();
    // the held-out Escape test fails: the restored setup.ts has no hack, the restored vitest.config collects the held-out file
    expect(by("tests").pass).toBe(false);
    expect(by("tests").failed.join("\n")).toMatch(/puts focus back on the slot/);
    expect(by("tests").failed.join("\n")).not.toMatch(/ran 0 of/);
    const checks = by("checks").failed.join("\n");
    expect(checks, checks).toMatch(/the whole suite passes/); // package.json and vitest.config restored: the broken test runs
    expect(checks).toMatch(/the typecheck passes/); // package.json and tsconfig restored: the type error is seen
    expect(checks).toMatch(/no literal that is not a token.*73px/s); // tokens.yaml restored
    // and each file the session touched is named by Touches
    const touches = checks.slice(checks.indexOf("nothing outside Touches"));
    for (const f of ["vitest.config.ts", "package.json", "tsconfig.json", "tests/setup.ts", ".aidw/design/tokens.yaml"]) expect(touches, f).toContain(f);
    expect(r!.pass).toBe(false);
  }, 900_000);

  it("a session that fixes the shared Dialog fails Touches and, with a machine grader failed, the model is not asked", () => {
    const c = pilot();
    const prompts: string[] = [];
    const agent: AgentRunner = (i) => {
      cpSync(join(reference, CASE), i.cwd, { recursive: true });
      const f = join(i.cwd, "src", "ui", "Dialog.tsx");
      writeFileSync(f, readFileSync(f, "utf8").replace("const titleId = useId();", "const titleId = useId();\n  // focus return fixed here"));
      const reads = [i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1"), ...c.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
      const lines = [
        ...reads.map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
        { type: "result", subtype: "success", result: "Works now. I fixed the focus return in src/ui/Dialog.tsx." },
      ];
      writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
      return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
    };
    const [r] = runLevel2({ root: plugin, role: "frontend", runs: 1, agent, exec: (p) => (prompts.push(p), JSON.stringify([{ n: 1, pass: true, reason: "ok" }])), install: noInstall, runsDir: temp("aidw-l2fe-runs-") }, c.name);
    const steps = r!.results[0]!.steps;
    expect(steps.find((s) => s.step === "checks")!.failed.join("\n")).toMatch(/nothing outside Touches.*src\/ui\/Dialog\.tsx/s);
    expect(steps.find((s) => s.step === "tests")!.pass).toBe(true);
    expect(r!.pass).toBe(false);
    expect(prompts).toHaveLength(0);
  }, 900_000);

  it("the reference and the held-out tests five times in a row in one copy: 8 passed every time, and no state or file is left behind", () => {
    const g = graded();
    const before = g.sh("git status --porcelain").out;
    const runs = Array.from({ length: 5 }, () => g.heldOut());
    for (const t of runs) {
      expect(t.status, t.out).toBe(0);
      expect(t.out).toMatch(/8 passed/);
    }
    // the shapes of the outputs agree: the same tests, in the same count
    expect(new Set(runs.map((t) => (/(\d+) passed/.exec(t.out) ?? [])[1])).size).toBe(1);
    expect(g.sh("git status --porcelain").out).toBe(before);
  }, 900_000);

  it("the held-out tests give the same verdict in the reverse and a shuffled file order (no leak across files)", () => {
    const g = graded();
    put(g, "tests/z-first.test.tsx", 'import { expect, it } from "vitest";\nimport { db } from "./msw/handlers";\nit("leaves a mess", () => { db.bookings.push({ id: "bX", slotId: "s1" }); db.slots[0]!.booked = true; db.doctors[0]!.name = "Dr. Leak"; });\n');
    const t = g.sh(`npm test --silent -- tests/z-first.test.tsx ${pilot().heldOut.join(" ")} --sequence.shuffle`);
    expect(t.status, t.out).toBe(0);
    expect(t.out).toMatch(/9 passed/);
  }, 600_000);
});
