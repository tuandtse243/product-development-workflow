import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("POST /api/sessions", () => {
  it("signs in with the right password", async () => {
    const u = await t.seed.user("ana");
    const res = await t.http().post("/api/sessions").send({ email: u.email, password: "pw" });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
  });

  it("refuses a wrong password with a problem body", async () => {
    const u = await t.seed.user("ana");
    const res = await t.http().post("/api/sessions").send({ email: u.email, password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ type: "wrong-credentials", title: "Email or password is wrong", status: 401 });
  });

  it("refuses unknown fields", async () => {
    const res = await t.http().post("/api/sessions").send({ email: "a@example.test", password: "pw", admin: true });
    expect(res.status).toBe(400);
    expect(res.body.type).toBe("invalid-request");
  });

  it("answers malformed JSON with invalid-request", async () => {
    const res = await t.http().post("/api/sessions").set("content-type", "application/json").send("{");
    expect(res.status).toBe(400);
    expect(res.body.type).toBe("invalid-request");
  });
});
