import type { RouteObject } from "react-router";
import { BillingPage } from "./billing/BillingPage";
import { TeamPage } from "./invites/TeamPage";
import { Layout } from "./Layout";
import { ProjectPage } from "./projects/ProjectPage";
import { ProjectsPage } from "./projects/ProjectsPage";

/** The app's routes, used by the browser router (web/main.tsx) and by the tests' memory router (web/tests/render.tsx). */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: "projects/:projectId", element: <ProjectPage /> },
      { path: "billing", element: <BillingPage /> },
      { path: "team", element: <TeamPage /> },
    ],
  },
];
