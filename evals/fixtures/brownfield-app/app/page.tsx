import { listTodos } from "@/lib/todos";

export default function Page() {
  const todos = listTodos();
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Todos</h1>
      {todos.length === 0 ? <p>Nothing to do.</p> : <ul>{todos.map((t) => <li key={t.id}>{t.done ? "✓ " : ""}{t.title}</li>)}</ul>}
    </main>
  );
}
