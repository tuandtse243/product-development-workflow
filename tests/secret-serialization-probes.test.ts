import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handlesSecretSerialization, SKILLS_WITH_NOTES } from "../src/skills.js";

// Probes of the sentry/secret-serialization signal (plan T14) with realistic task titles, and the notes every
// vendored skill with a different setup must have.
const task = (title: string, role = "backend", touches = ["src/x/**"]) => ({ id: "T", title, role, type: "feat", verify: [], touches }) as never;

describe("secret-serialization signal probes", () => {
  it.each([
    "Add structured logging to the checkout route",
    "Store the Stripe API key in config",
    "Add OpenTelemetry spans to the booking service",
    "Store the webhook signing secret in env",
    "Validate the Sentry DSN in config",
  ])("loads for %s", (title) => {
    expect(handlesSecretSerialization(task(title))).toBe(true);
    expect(handlesSecretSerialization(task(title, "fullstack"))).toBe(true);
  });

  it.each(["Refresh the session token", "Show password strength", "Add a config page for theme colors", "Change the log in button", "Add a /health endpoint"])(
    "stays out of %s",
    (title) => expect(handlesSecretSerialization(task(title))).toBe(false),
  );

  it("a config path in Touches loads it only with a credential word in the title, never from Touches alone", () => {
    expect(handlesSecretSerialization(task("Theme colors", "backend", ["src/config/theme.ts"]))).toBe(false);
    expect(handlesSecretSerialization(task("Session", "backend", ["src/auth/tokens.ts", "src/config/**"]))).toBe(false);
    expect(handlesSecretSerialization(task("Session signing secret", "backend", ["src/auth/**", "src/config/**"]))).toBe(true);
  });

  it.each(["frontend", "database", "devops"])("never loads for a %s task, even on a sink", (role) => {
    expect(handlesSecretSerialization(task("Add structured logging to the checkout route", role))).toBe(false);
  });
});

describe("vendored-skill notes", () => {
  const notes = readFileSync(join(__dirname, "..", "plugins", "aidw", "library", "vendored-skill-notes.md"), "utf8");
  const headings = [...notes.matchAll(/^## (.+)$/gm)].map((m) => m[1]!);
  it.each([...SKILLS_WITH_NOTES])("%s has a section in vendored-skill-notes.md", (id) => {
    const [up, name] = id.split("/") as [string, string];
    expect(headings.some((h) => h.startsWith(`${up}/`) && h.includes(name))).toBe(true);
  });
});
