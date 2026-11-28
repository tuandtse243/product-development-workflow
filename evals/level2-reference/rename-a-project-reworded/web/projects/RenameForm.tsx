import { useId, useState, type FormEvent } from "react";
import type { NameProblem, Project } from "../../shared/projects.ts";
import { ApiError } from "../api/client";
import { renameProject } from "./api";
import { forgetProjects } from "./store";

const PROBLEMS: Record<NameProblem, string> = {
  required: "A name is required.",
  "too-long": "Use at most 80 characters.",
  taken: "A project in this team already uses that name.",
};

type Outcome = { kind: "idle" } | { kind: "field"; text: string } | { kind: "refused" } | { kind: "failed" };

export function RenameForm({ project, onRenamed }: { project: Project; onRenamed: (p: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOutcome({ kind: "idle" });
    try {
      const stored = await renameProject(project.id, name);
      forgetProjects();
      setName(stored.name);
      onRenamed(stored);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields.name) setOutcome({ kind: "field", text: PROBLEMS[err.fields.name as NameProblem] ?? "Pick another name." });
      else if (err instanceof ApiError && err.status === 403) setOutcome({ kind: "refused" });
      else setOutcome({ kind: "failed" });
    }
  }

  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)}>
        Edit name
      </button>
    );
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={fieldId}>Project name</label>
      <input
        id={fieldId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={outcome.kind === "field" ? true : undefined}
        aria-describedby={outcome.kind === "field" ? errorId : undefined}
      />
      {outcome.kind === "field" && <span id={errorId}>{outcome.text}</span>}
      <button type="submit">Rename project</button>
      {outcome.kind === "refused" && <p role="alert">You are not an owner of this team, so you cannot rename its projects.</p>}
      {outcome.kind === "failed" && <p role="alert">Something went wrong. Please try again.</p>}
    </form>
  );
}
