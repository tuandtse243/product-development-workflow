import { Link, Outlet } from "react-router";
import { Popover } from "./ui/Popover";

/** The frame of every page: the header with the clinic's name, the links and the help popover, then the page. */
export function Layout() {
  // The sign-in app stores the patient's role here; the Billing link is only for owners.
  const isOwner = localStorage.getItem("role") === "owner";
  return (
    <div className="app">
      <header className="app__header">
        <Link to="/" className="app__brand">
          Riverside Clinic
        </Link>
        <nav aria-label="Main" className="app__nav">
          <Link to="/">Doctors</Link>
          <Link to="/notices">Notices</Link>
          <Link to="/contact">Contact</Link>
          {isOwner && <Link to="/billing">Billing</Link>}
        </nav>
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
