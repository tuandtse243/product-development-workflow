import { z } from "zod";

export const Todo = z.object({ id: z.string(), title: z.string().min(1).max(120), done: z.boolean() });
export type Todo = z.infer<typeof Todo>;

// One list shared by the API route and the page: Next bundles them separately, so module state would not be shared.
const store = globalThis as typeof globalThis & { __todos?: Todo[] };
const todos: Todo[] = (store.__todos ??= []);

export function listTodos(): Todo[] {
  return [...todos];
}

export function addTodo(title: string): Todo {
  const todo = Todo.parse({ id: crypto.randomUUID(), title: title.trim(), done: false });
  todos.push(todo);
  return todo;
}

export function toggleTodo(id: string): Todo | null {
  const t = todos.find((x) => x.id === id);
  if (!t) return null;
  t.done = !t.done;
  return t;
}
