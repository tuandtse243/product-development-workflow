import { useState } from "react";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { usePeopleSearch } from "./usePeopleSearch";
import "./people.css";

/** Finds the people of the clinic by name, as the patient types. */
export function PeopleSearch() {
  const [text, setText] = useState("");
  const query = text.trim();
  const { search, retry } = usePeopleSearch(query);

  return (
    <section className="page">
      <h1 className="page__title">People</h1>
      <label className="people__field">
        Search by name
        <input type="search" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
      </label>
      {search.status === "idle" && <p className="empty">Type a name to search.</p>}
      {search.status === "searching" && <Spinner label="Searching…" />}
      {search.status === "failed" && (
        <div role="alert" className="people__error">
          <p>The search failed.</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}
      {search.status === "found" &&
        (search.people.length ? (
          <ul className="people__list">
            {search.people.map((p) => (
              <li key={p.id} className="people__item">
                <span className="people__name">{p.name}</span>
                <span className="people__title">{p.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No one matches “{query}”.</p>
        ))}
    </section>
  );
}
