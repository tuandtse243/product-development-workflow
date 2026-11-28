import { Link, Outlet } from "react-router";

/** The frame of every page: the header with the app's name and the main link, then the page. */
export function Layout() {
  return (
    <div className="app">
      <header className="app__header">
        <span className="app__brand">Team projects</span>
        <nav aria-label="Main">
          <Link to="/">Projects</Link>
        </nav>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
