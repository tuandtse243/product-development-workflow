import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Project } from "../../shared/projects.ts";
import { loadProjects } from "./store";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; projects: Project[] };

/** `/`: the projects of the user's teams. */
export function ProjectsPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadProjects().then(
      (projects) => live && setState({ status: "ready", projects }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="projects-title">
      <h1 id="projects-title">Projects</h1>
      {state.status === "loading" && <p role="status">Loading projects...</p>}
      {state.status === "error" && <p role="alert">The projects could not be loaded.</p>}
      {state.status === "ready" && state.projects.length === 0 && <p>No projects yet.</p>}
      {state.status === "ready" && state.projects.length > 0 && (
        <ul className="projects">
          {state.projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
