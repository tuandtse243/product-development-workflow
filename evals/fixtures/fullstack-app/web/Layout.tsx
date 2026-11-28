import { Link, Outlet } from "react-router";

/** The role the sign-in app left for this browser (it keeps `role` in localStorage). */
const roleOfBrowser = (): string | null => {
  try {
    return localStorage.getItem("role");
  } catch {
    return null;
  }
};

/** The frame of every page: the header with the app's name and the links, then the page. */
export function Layout() {
  const isOwner = roleOfBrowser() === "owner";
  return (
    <div className="app">
      <header className="app__header">
        <span className="app__brand">Team projects</span>
        <nav aria-label="Main">
          <Link to="/">Projects</Link>
          <Link to="/team">Team</Link>
          {isOwner && <Link to="/billing">Billing</Link>}
        </nav>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
