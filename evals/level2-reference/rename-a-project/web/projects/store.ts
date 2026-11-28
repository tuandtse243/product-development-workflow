import type { Project } from "../../shared/projects.ts";
import { fetchProjects } from "./api";

/**
 * The list of projects, kept for the life of the page so that going back to the list does not load it again. A write
 * that changes a project forgets it (`forgetProjects`), so the next visit to the list loads what the server has.
 */
let projects: Project[] | null = null;

export async function loadProjects(): Promise<Project[]> {
  projects ??= await fetchProjects();
  return projects;
}

/** Forgets the kept list: after a rename, and in the tests, which start each case from an empty store. */
export function forgetProjects(): void {
  projects = null;
}

/** Kept for the tests written before `forgetProjects`. */
export const resetProjectStore = forgetProjects;
