import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Popover } from "../../src/ui/Popover";

describe("Popover", () => {
  it("opens from its button and closes on Escape with focus back on the button", async () => {
    const user = userEvent.setup();
    render(<Popover label="Help">Call the front desk.</Popover>);
    const trigger = screen.getByRole("button", { name: "Help" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Call the front desk.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Call the front desk.")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
