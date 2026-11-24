import { describe, expect, it } from "vitest";
import { handlesSecretSerialization } from "../src/skills.js";

// False negatives of the sentry/secret-serialization signal found probing T14 (left failing for the author).
const task = (title: string) => ({ id: "T", title, role: "backend", type: "feat", verify: [], touches: ["src/x/**"] }) as never;

describe("secret-serialization signal gaps", () => {
  it("loads for a task that logs to a sink with the verb 'log' (not 'log in')", () => {
    expect(handlesSecretSerialization(task("Log failed webhook deliveries"))).toBe(true);
  });

  it("treats 'environment' as a holder, like 'env'", () => {
    expect(handlesSecretSerialization(task("Read the OpenAI key from the environment"))).toBe(true);
  });

  it("loads for a connection string, which only ever lives on a config or client object", () => {
    expect(handlesSecretSerialization(task("Rotate the database connection string"))).toBe(true);
  });
});
