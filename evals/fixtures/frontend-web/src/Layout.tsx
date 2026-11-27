import { Link, Outlet } from "react-router";
import { Popover } from "./ui/Popover";

/** The frame of every page: the header with the clinic's name and the help popover, then the page. */
export function Layout() {
  return (
    <div className="app">
      <header className="app__header">
        <Link to="/" className="app__brand">
          Riverside Clinic
        </Link>
        <Popover label="Help">
          <p>Pick a doctor, then a day, then a free slot. Call the front desk to cancel a booking.</p>
        </Popover>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
