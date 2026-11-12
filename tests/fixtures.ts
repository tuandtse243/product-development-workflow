import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

export function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "aidw-test-"));
}

export function write(root: string, rel: string, content: string): string {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

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

code, unit, integration, e2e, review.

## Deploy strategy

Vercel preview.

## Permissions

- \`vercel-preview\`: Vercel preview deployment for the client demo.

## Risks and assumptions

Assumes one clinic, one timezone.
`;

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
