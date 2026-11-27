import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { digestOf } from "../src/planreview.js";
import { writeAgents } from "../src/roles.js";

export const MAIN_SPEC = `# Booking

## Purpose

Lets patients book, view and cancel appointments with the clinic's practitioners.

## Requirements

### Requirement: Create appointment
The system SHALL let a patient book a free slot with a practitioner.

#### Scenario: Slot is free
- **WHEN** a patient books a free slot
- **THEN** the appointment is created and the slot is no longer free

### Requirement: Cancel appointment
The system SHALL let a patient cancel an upcoming appointment.

#### Scenario: Cancel upcoming
- **WHEN** a patient cancels an appointment that starts in more than 24 hours
- **THEN** the appointment is cancelled and the slot becomes free again

## Notes

Kept verbatim by merge.
`;

export const REQ = (name: string, extra = "") => `### Requirement: ${name}
The system SHALL ${name.toLowerCase()}.${extra}

#### Scenario: ${name} works
- **WHEN** it is triggered
- **THEN** it happens
`;

/**
 * Puts the backend Role of a plugin copy back to its shape before the rules table, whatever backend holds today: no
 * rules.md, no skills index, only its two original cases with no `covers:` or `expect:` and no result file, and
 * fullstack without `follows_rules`, and frontend without its rules table or `covers:`. Tests of the rules table (T12)
 * build their own table Role from this.
 */
export function bareBackend(root: string): void {
  const dir = join(root, "roles", "backend");
  rmSync(join(dir, "rules.md"), { force: true });
  const role = join(dir, "role.md");
  writeFileSync(role, readFileSync(role, "utf8").replace(/^skills:\n(?:[ \t]+-.*\n)*/m, ""));
  const evals = join(dir, "evals");
  const kept = ["entity-is-not-a-response.md", "validates-authorizes-and-does-not-leak.md"];
  for (const f of readdirSync(evals)) if (!kept.includes(f)) rmSync(join(evals, f), { recursive: true, force: true });
  for (const f of kept) writeFileSync(join(evals, f), readFileSync(join(evals, f), "utf8").replace(/^(covers|expect): .*\n/gm, ""));
  const fullstack = join(root, "roles", "fullstack", "role.md");
  if (existsSync(fullstack)) writeFileSync(fullstack, readFileSync(fullstack, "utf8").replace(/^follows_rules: .*\n/m, ""));
  // frontend's table (T20) would otherwise ask for its own results.json: these tests study backend alone
  const frontend = join(root, "roles", "frontend");
  rmSync(join(frontend, "rules.md"), { force: true });
  const fevals = join(frontend, "evals");
  if (existsSync(fevals)) for (const f of readdirSync(fevals).filter((n) => n.endsWith(".md"))) writeFileSync(join(fevals, f), readFileSync(join(fevals, f), "utf8").replace(/^---\n[\s\S]*?\n---\n/, (fm) => fm.replace(/^(# .*|covers: .*)\n/gm, "")));
  writeAgents(root);
}

export function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "aidw-test-"));
}

export function write(root: string, rel: string, content: string): string {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/**
 * The scope round of the discovery interview (a \`product\` change records it word for word from the \`scope\` page).
 * Part of ANALYSIS_MD because a change created on a greenfield project, with or without --workflow, is a product
 * change that records scope_round: true. Tests of a change that owes no round strip it (scoperound.test.ts).
 */
export const SCOPE_ROUND = `
## Appendix: discovery Q&A

### Scope round

vision Who it is for: clinics whose patients book by phone today
scope Capabilities in scope: booking, rescheduling
mvp The first cut: booking and rescheduling; cancelling comes with staff tools
out Out of scope: payments
`;

export const ANALYSIS_MD = `# Analysis: Booking

## Summary

Clinic booking app. Patients book, reschedule and cancel; staff manage slots.

## Decisions to honor

- D1: Times are stored in UTC and shown in the clinic's timezone.
- D2: Booking state lives in Supabase; no client-side cache of slots.

## Requirements and scope

In: booking, rescheduling. Out: payments.

## Domain

Patient, Practitioner, Slot, Appointment.

## Stack

Source: fallback

Next.js + Supabase + Tailwind/shadcn + Vercel; the client stated no stack.

## Design

Mode: ai_design

Calm clinical palette, mobile first.

## Architecture

Next.js app router, Supabase Postgres with RLS.

## Specs

booking: +1 requirement.

## Plan

2 tasks, 2 waves.

## Quality profile

code, unit, integration, e2e, review. a11y is left out: the fixture has no axe.

## Deploy strategy

Vercel preview.

## Permissions

- \`vercel-preview\`: Vercel preview deployment for the client demo.

## Risks and assumptions

Assumes one clinic, one timezone.
${SCOPE_ROUND}`;

export const TOKENS_YAML = `tokens:
  - name: accent
    kind: color
    value: "#E5533D"
    dark: "#FF7A66"
    use: primary buttons and the selected slot
  - name: surface
    kind: color
    value: "#FAF5EC"
    use: page background
  - name: body
    kind: font
    value: Inter, sans-serif
    use: all body text
`;

export const QUALITY_YAML = `layers:
  - name: code
    run: ["pnpm build"]
  - name: unit
    run: ["pnpm vitest run"]
  - name: e2e
    run: ["pnpm playwright test"]
deploy:
  target: preview
  command: vercel deploy --yes
  smoke: ['curl -fsS "$AIDW_DEPLOY_URL"']
permissions: [vercel-preview]
`;

export const TASKS_YAML = `tasks:
  - id: T01
    title: Booking API
    role: backend-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["app/api/bookings/**"]
    verify: ["pnpm vitest run lib/booking"]
    status: pending
  - id: T02
    title: Booking page
    role: frontend-engineer
    type: feat
    depends_on: [T01]
    touches: ["app/(site)/book/**"]
    verify: ["pnpm playwright test booking"]
    status: pending
`;

export const PLAN_REVIEW_PASS = "VERDICT: pass\n";

/**
 * The independent review before the gate (D4) as if it had run and passed: the code-reviewer's verdict and the CLI's
 * record of round 1. Tests that are not about the review call it before \`transition awaiting_approval\`.
 */
export function planReviewed(root: string, id: string): void {
  write(root, `.aidw/run/review-plan-${id}.md`, PLAN_REVIEW_PASS);
  write(root, `.aidw/changes/${id}/plan-review.yaml`, YAML.stringify({ rounds: [{ round: 1, verdict: "pass", digest: digestOf(PLAN_REVIEW_PASS), at: "2026-11-24T00:00:00.000Z", findings: [] }] }));
}
