import { z } from "zod";

/**
 * The shapes the web app and the API both use: a project as the API sends it, and the list. Imported by `server/` and
 * `web/`, so nothing here may import the database, Express or any other server-only module.
 */
export const projectSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.object({ items: z.array(projectSchema) });
export type ProjectList = z.infer<typeof projectListSchema>;

/** The longest project name, after trimming. */
export const PROJECT_NAME_MAX = 80;

/** The body of `PATCH /api/projects/{projectId}`: the name as typed; the server trims it and decides what is wrong with it. */
export const renameProjectSchema = z.object({ name: z.unknown() }).strict();

/** Why a name is refused (`fields.name` of a 422). */
export type NameProblem = "required" | "too-long" | "taken";
