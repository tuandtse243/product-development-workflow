import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { db } from "../msw/handlers";
import { server } from "../msw/server";
import { renderAt } from "../render";

const box = () => screen.getByRole("searchbox", { name: "Search by name" });

describe("search people", () => {
  it("people/search-people/nothing-typed-yet: says to type a name", async () => {
    renderAt("/people");
    expect(screen.getByText("Type a name to search.")).toBeInTheDocument();
  });

  it("people/search-people/search-waiting: says it is searching until the answer arrives", async () => {
    server.use(http.get("/api/people", async () => (await delay(50), HttpResponse.json([]))));
    const { user } = renderAt("/people");
    await user.type(box(), "abel");
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    await screen.findByText(/No one matches/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("people/search-people/people-matching-the-text: lists each match with the name and the title", async () => {
    const { user } = renderAt("/people");
    await user.type(box(), "abe");
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Abel OrtizNurse", "Abella CruzReceptionist", "Abe LindqvistPharmacist"]);
  });

  it("people/search-people/latest-text-wins: a slow answer to an earlier text never replaces the latest one", async () => {
    server.use(
      http.get("/api/people", async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        await delay(q === "abe" ? 10 : 200);
        return HttpResponse.json(db.people.filter((p) => p.name.toLowerCase().includes(q)).map(({ id, name, title }) => ({ id, name, title })));
      }),
    );
    const { user } = renderAt("/people");
    await user.type(box(), "ab");
    await user.type(box(), "e");
    await screen.findByText("Abe Lindqvist");
    await delay(300);
    expect(screen.queryByText("Abigail Chen")).not.toBeInTheDocument();
  });

  it("people/search-people/clear-the-box: emptying it goes back to the first state and the late answer is not shown", async () => {
    server.use(http.get("/api/people", async () => (await delay(150), HttpResponse.json(db.people))));
    const { user } = renderAt("/people");
    await user.type(box(), "ab");
    await user.clear(box());
    expect(screen.getByText("Type a name to search.")).toBeInTheDocument();
    await delay(250);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("people/search-people/nobody-matches: says no one matches the text", async () => {
    const { user } = renderAt("/people");
    await user.type(box(), "zzq");
    expect(await screen.findByText("No one matches “zzq”.")).toBeInTheDocument();
  });

  it("people/search-people/search-fails: an alert with Retry, which searches again", async () => {
    server.use(http.get("/api/people", () => new HttpResponse(null, { status: 503 }), { once: true }));
    const { user } = renderAt("/people");
    await user.type(box(), "m");
    expect(await screen.findByRole("alert")).toHaveTextContent("The search failed.");
    expect(screen.queryByText(/No one matches/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Maria Santos")).toBeInTheDocument();
  });
});
