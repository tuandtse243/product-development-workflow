import type { Project } from "../../shared/projects.ts";
import { fetchProjects } from "./api";

/**
 * The list of projects, kept for the life of the page so that going back to the list does not load it again.
 */
let projects: Project[] | null = null;

export async function loadProjects(): Promise<Project[]> {
  projects ??= await fetchProjects();
  return projects;
}

/** Forgets the kept list (the tests start each case from an empty store). */
export function resetProjectStore(): void {
  projects = null;
}
