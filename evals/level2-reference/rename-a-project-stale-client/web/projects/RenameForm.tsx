import { useId, useState, type FormEvent } from "react";
import type { Project } from "../../shared/projects.ts";
import { ApiError } from "../api/client";
import { renameProject } from "./api";
import { forgetProjects } from "./store";

/** Built on the client helper as it is: it keeps only the status and a message, so every refusal but a 403 is "failed". */
export function RenameForm({ project, onRenamed }: { project: Project; onRenamed: (p: Project) => void }) {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      const stored = await renameProject(project.id, name);
      forgetProjects();
      setName(stored.name);
      onRenamed(stored);
    } catch (err) {
      setProblem(err instanceof ApiError && err.status === 403 ? "Only owners of the team can rename a project." : "The project could not be renamed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={fieldId}>Name</label>
      <input id={fieldId} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}
