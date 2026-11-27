import type { RouteObject } from "react-router";
import { DoctorPage } from "./doctors/DoctorPage";
import { DoctorsPage } from "./doctors/DoctorsPage";
import { Layout } from "./Layout";

/** The app's routes, used by the browser router (src/main.tsx) and by the tests' memory router (tests/render.tsx). */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <DoctorsPage /> },
      { path: "doctors/:doctorId", element: <DoctorPage /> },
    ],
  },
];
