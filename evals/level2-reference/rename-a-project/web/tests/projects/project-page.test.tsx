import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw/server";
import { renderAt } from "../render";

// The page's loads with answers the server is made to give: a 404 has the body the server really sends.
describe("the project page", () => {
  it("shows the name of the project it loads", async () => {
    server.use(http.get("/api/projects/p1", () => HttpResponse.json({ id: "p1", teamId: "t1", name: "Apollo", createdAt: "2026-03-02T09:30:00.000Z" })));
    renderAt("/projects/p1");
    expect(await screen.findByRole("heading", { name: "Apollo" })).toBeInTheDocument();
  });

  it("shows the message of a project that is not there", async () => {
    server.use(http.get("/api/projects/p2", () => HttpResponse.json({ error: { code: "project-not-found", message: "No such project" } }, { status: 404 })));
    renderAt("/projects/p2");
    expect(await screen.findByRole("alert")).toHaveTextContent("No such project");
  });

  it("shows the status text of an answer that has no message", async () => {
    server.use(http.get("/api/projects/p3", () => new HttpResponse(null, { status: 503, statusText: "Service Unavailable" })));
    renderAt("/projects/p3");
    expect(await screen.findByRole("alert")).toHaveTextContent("Service Unavailable");
  });
});
