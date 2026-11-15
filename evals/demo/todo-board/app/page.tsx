import { listTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

export default function Page() {
  const todos = listTodos();
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Todos</h1>
      {todos.length === 0 ? <p>Nothing to do.</p> : <ul>{todos.map((t) => <li key={t.id}>{t.done ? "✓ " : ""}{t.title}</li>)}</ul>}
    </main>
  );
}
