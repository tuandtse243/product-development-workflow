import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "./render";

describe("doctors", () => {
  it("lists every doctor with a link to their calendar", async () => {
    const { user } = renderAt("/");
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    await user.click(await screen.findByRole("link", { name: "Dr. Ana Lima" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dr. Ana Lima" })).toBeInTheDocument();
  });

  it("shows a doctor's days with the number of open slots", async () => {
    renderAt("/doctors/d1");
    expect(await screen.findByText("Mon 7 Jan 2030")).toBeInTheDocument();
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("Tue 8 Jan 2030")).toBeInTheDocument();
    expect(screen.getByText("General practice")).toBeInTheDocument();
  });
});
