import { z } from "zod";

export const Todo = z.object({ id: z.string(), title: z.string().min(1).max(120), done: z.boolean() });
export type Todo = z.infer<typeof Todo>;

const todos: Todo[] = [];

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
