import type { RouteObject } from "react-router";
import { LoginPage } from "./auth/LoginPage";
import { BillingPage } from "./billing/BillingPage";
import { RequireOwner } from "./billing/RequireOwner";
import { ContactPage } from "./contact/ContactPage";
import { DoctorPage } from "./doctors/DoctorPage";
import { DoctorsPage } from "./doctors/DoctorsPage";
import { Layout } from "./Layout";
import { NoticesPage } from "./notices/NoticesPage";

/** The app's routes, used by the browser router (src/main.tsx) and by the tests' memory router (tests/render.tsx). */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <DoctorsPage /> },
      { path: "doctors/:doctorId", element: <DoctorPage /> },
      { path: "notices", element: <NoticesPage /> },
      { path: "contact", element: <ContactPage /> },
      { path: "login", element: <LoginPage /> },
      {
        path: "billing",
        element: (
          <RequireOwner>
            <BillingPage />
          </RequireOwner>
        ),
      },
    ],
  },
];
