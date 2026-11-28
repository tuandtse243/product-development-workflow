import { projectListSchema, projectSchema, type Project } from "../../shared/projects.ts";
import { getJson, patchJson } from "../api/client";

/** The projects of the signed-in user's teams (`GET /api/projects`). */
export async function fetchProjects(signal?: AbortSignal): Promise<Project[]> {
  return projectListSchema.parse(await getJson("/api/projects", { signal })).items;
}

/** One project (`GET /api/projects/{projectId}`). */
export async function fetchProject(projectId: string, signal?: AbortSignal): Promise<Project> {
  return projectSchema.parse(await getJson(`/api/projects/${encodeURIComponent(projectId)}`, { signal }));
}

/** Renames a project (`PATCH /api/projects/{projectId}`); the answer is the project as the server stored it. */
export async function renameProject(projectId: string, name: string): Promise<Project> {
  return projectSchema.parse(await patchJson(`/api/projects/${encodeURIComponent(projectId)}`, { name }));
}
