import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "../routes";

/** The whole app at `path`, in a memory router, with a user-event instance to drive it. */
export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  return { user, router, ...render(<RouterProvider router={router} />) };
}
