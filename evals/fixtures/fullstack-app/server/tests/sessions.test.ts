import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("POST /api/sessions", () => {
  it("signs a known email in with the sid cookie, and the cookie then opens the API", async () => {
    const ana = await t.seed.user("ana");
    const res = await t.http().post("/api/sessions").send({ email: ana.email });
    expect(res.status).toBe(201);
    const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
    expect(cookie).toMatch(/^sid=/);
    expect((await t.http().get("/api/teams").set("Cookie", cookie)).status).toBe(200);
  });

  it("refuses an unknown email", async () => {
    const res = await t.http().post("/api/sessions").send({ email: "nobody@example.test" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid-credentials");
  });

  it("refuses a body that is not an email", async () => {
    const res = await t.http().post("/api/sessions").send({ email: "nope" });
    expect(res.status).toBe(400);
  });
});
