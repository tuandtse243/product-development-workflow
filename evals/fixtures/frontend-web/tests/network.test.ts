import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, getJson, postJson } from "../src/api/client";
import { server } from "./msw/server";

describe("the tests' network (MSW, in-process)", () => {
  it("answers the API's paths", async () => {
    const doctors = await getJson<{ id: string }[]>("/api/doctors");
    expect(doctors.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("turns a problem body into an ApiError with its status and type", async () => {
    await expect(postJson("/api/bookings", { slotId: "s3" })).rejects.toMatchObject({ status: 409, type: "slot-taken" });
    await expect(getJson("/api/doctors/nobody")).rejects.toBeInstanceOf(ApiError);
  });

  it("lets a test override one answer", async () => {
    server.use(http.get("/api/doctors", () => new HttpResponse(null, { status: 503 }), { once: true }));
    await expect(getJson("/api/doctors")).rejects.toMatchObject({ status: 503, type: "internal-error" });
    expect(await getJson<unknown[]>("/api/doctors")).toHaveLength(2);
  });

  it("refuses a request no handler answers", async () => {
    await expect(getJson("/api/not-in-the-api")).rejects.toThrow();
  });
});
