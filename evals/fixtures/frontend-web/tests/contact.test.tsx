import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "./render";

describe("contact", () => {
  it("sends a message and says so", async () => {
    const { user } = renderAt("/contact");
    await user.type(screen.getByPlaceholderText("Your name"), "Rosa");
    await user.type(screen.getByPlaceholderText("Message"), "Is the clinic open on Monday?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Message sent")).toBeInTheDocument();
  });

  it("tells a refusal in the same place", async () => {
    const { user } = renderAt("/contact");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("The message is empty")).toBeInTheDocument();
  });
});
