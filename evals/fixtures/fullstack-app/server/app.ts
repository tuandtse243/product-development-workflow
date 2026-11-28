import express from "express";
import { sessionRoutes } from "./auth/routes.ts";
import { billingRoutes } from "./billing/routes.ts";
import type { Db } from "./db/client.ts";
import { errorHandler, notFound } from "./http/errors.ts";
import { invoiceRoutes } from "./invoices/routes.ts";
import { projectRoutes } from "./projects/routes.ts";
import { teamRoutes } from "./teams/routes.ts";

export interface Deps {
  db: Db;
  sessionTtlHours?: number;
}

/** The HTTP app: one router per area, then the 404 and error handlers. */
export function createApp(deps: Deps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(sessionRoutes(deps.db, deps.sessionTtlHours ?? 72));
  app.use(teamRoutes(deps.db));
  app.use(projectRoutes(deps.db));
  app.use(billingRoutes(deps.db));
  app.use(invoiceRoutes(deps.db));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
