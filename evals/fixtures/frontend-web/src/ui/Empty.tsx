import type { ReactNode } from "react";

/** What a list shows when it has nothing in it. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
