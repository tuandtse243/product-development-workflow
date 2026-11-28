import { useEffect, useReducer, useState } from "react";
import { searchPeople, type Person } from "./api";
import "./people.css";

type View = { kind: "none" } | { kind: "wait" } | { kind: "bad" } | { kind: "rows"; rows: Person[] };

/** A table of the people matching the text; the answer of an older text is ignored through a flag of its own effect. */
export function PeopleSearch() {
  const [typed, setTyped] = useState("");
  const [again, bump] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useState<View>({ kind: "none" });
  const wanted = typed.trim();

  useEffect(() => {
    if (!wanted) {
      setView({ kind: "none" });
      return;
    }
    let stale = false;
    setView({ kind: "wait" });
    searchPeople(wanted).then(
      (rows) => !stale && setView({ kind: "rows", rows }),
      () => !stale && setView({ kind: "bad" }),
    );
    return () => {
      stale = true;
    };
  }, [wanted, again]);

  return (
    <section className="page">
      <h1 className="page__title">Find someone</h1>
      <label htmlFor="person-name" className="people__field">
        Name
      </label>
      <input id="person-name" type="text" value={typed} maxLength={50} onChange={(e) => setTyped(e.target.value)} />
      <div aria-live="polite">
        {view.kind === "none" && <p className="empty">Type a name to search.</p>}
        {view.kind === "wait" && <p>Please wait…</p>}
      </div>
      {view.kind === "bad" && (
        <p role="alert">
          Something went wrong.{" "}
          <button type="button" onClick={bump}>
            Try again
          </button>
        </p>
      )}
      {view.kind === "rows" &&
        (view.rows.length ? (
          <table className="people__list">
            <tbody>
              {view.rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="people__title">{p.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No one matches “{wanted}”.</p>
        ))}
    </section>
  );
}
