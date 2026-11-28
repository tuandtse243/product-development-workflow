import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "../../src/ui/Button";
import { Dialog } from "../../src/ui/Dialog";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} title="Example" onClose={() => setOpen(false)}>
        <Button>First</Button>
        <Button>Last</Button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens named by its title, with focus on its first control", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("keeps Tab inside while open", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
