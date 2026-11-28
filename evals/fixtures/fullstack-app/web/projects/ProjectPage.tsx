import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Project } from "../../shared/projects.ts";
import { ApiError } from "../api/client";
import { fetchProject } from "./api";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; project: Project };

/** `/projects/:projectId`: one project. */
export function ProjectPage() {
  const { projectId = "" } = useParams();
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchProject(projectId, ac.signal).then(
      (project) => setState({ status: "ready", project }),
      (e: unknown) => {
        if (!ac.signal.aborted) setState({ status: "error", message: e instanceof ApiError ? e.message : "The project could not be loaded." });
      },
    );
    return () => ac.abort();
  }, [projectId]);

  if (state.status === "loading") return <p role="status">Loading project...</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  return (
    <article aria-labelledby="project-title">
      <h1 id="project-title">{state.project.name}</h1>
      <p>Created {new Date(state.project.createdAt).toLocaleDateString("en-GB")}</p>
    </article>
  );
}
