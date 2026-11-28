import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderAt } from "./render";

describe("notices", () => {
  it("lists the notices that have not expired", async () => {
    renderAt("/notices");
    expect(await screen.findByText("Closed on 1 January")).toBeInTheDocument();
    expect(screen.getByText("New opening hours")).toBeInTheDocument();
    expect(screen.queryByText("Flu clinic last year")).not.toBeInTheDocument();
  });

  it("narrows them by topic", async () => {
    const { user } = renderAt("/notices");
    await screen.findByText("Closed on 1 January");
    await user.selectOptions(screen.getByLabelText("Topic"), "hours");
    expect(await screen.findByText("New opening hours")).toBeInTheDocument();
    expect(screen.queryByText("Closed on 1 January")).not.toBeInTheDocument();
  });
});
