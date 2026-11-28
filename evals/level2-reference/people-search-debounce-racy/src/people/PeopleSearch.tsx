import { useState } from "react";
import { useFetch } from "../data/useFetch";
import { Spinner } from "../ui/Spinner";
import type { Person } from "./api";

export function PeopleSearch() {
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const q = text.trim();
  const { data, loading, failed } = useFetch<Person[]>(q ? `/api/people?q=${encodeURIComponent(q)}` : null, attempt);
  return (
    <section className="page">
      <h1 className="page__title">People</h1>
      <label>
        Search by name
        <input type="search" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
      </label>
      {!q ? (
        <p className="empty">Type a name to search.</p>
      ) : failed ? (
        <div role="alert">
          <p>The search failed.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </div>
      ) : loading ? (
        <Spinner label="Searching…" />
      ) : data && data.length ? (
        <ul>{data.map((p) => <li key={p.id}>{p.name} {p.title}</li>)}</ul>
      ) : (
        <p className="empty">No one matches “{q}”.</p>
      )}
    </section>
  );
}
