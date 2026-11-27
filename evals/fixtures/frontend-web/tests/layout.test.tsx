import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderAt } from "./render";

afterEach(() => localStorage.clear());

describe("the page frame", () => {
  it("links the pages, and Billing only when the sign-in app stored the owner role", async () => {
    renderAt("/login");
    expect(screen.getByRole("link", { name: "Notices" })).toHaveAttribute("href", "/notices");
    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
  });

  it("shows the Billing link to an owner", async () => {
    localStorage.setItem("role", "owner");
    renderAt("/login");
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/billing");
  });
});
