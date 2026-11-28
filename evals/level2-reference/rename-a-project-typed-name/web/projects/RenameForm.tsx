import { useId, useState, type FormEvent } from "react";
import type { NameProblem, Project } from "../../shared/projects.ts";
import { ApiError } from "../api/client";
import { renameProject } from "./api";
import { forgetProjects } from "./store";

const PROBLEMS: Record<NameProblem, string> = {
  required: "Enter a name.",
  "too-long": "Name is at most 80 characters.",
  taken: "That name is already taken in this team.",
};

type Outcome = { kind: "idle" } | { kind: "field"; text: string } | { kind: "refused" } | { kind: "failed" };

/** The rename form of a project page: the server decides; what it stored comes back through `onRenamed`. */
export function RenameForm({ project, onRenamed }: { project: Project; onRenamed: (p: Project) => void }) {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setOutcome({ kind: "idle" });
    try {
      const stored = await renameProject(project.id, name);
      forgetProjects();
      setName(stored.name);
      onRenamed({ ...stored, name });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields.name) setOutcome({ kind: "field", text: PROBLEMS[err.fields.name as NameProblem] ?? "That name cannot be used." });
      else if (err instanceof ApiError && err.status === 403) setOutcome({ kind: "refused" });
      else setOutcome({ kind: "failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={fieldId}>Name</label>
      <input
        id={fieldId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={outcome.kind === "field" ? true : undefined}
        aria-describedby={outcome.kind === "field" ? errorId : undefined}
      />
      {outcome.kind === "field" && <p id={errorId}>{outcome.text}</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
      {outcome.kind === "refused" && <p role="alert">Only owners of the team can rename a project.</p>}
      {outcome.kind === "failed" && <p role="alert">The project could not be renamed. Try again.</p>}
    </form>
  );
}
