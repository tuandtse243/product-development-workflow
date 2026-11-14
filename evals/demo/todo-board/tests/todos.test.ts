import { describe, expect, it } from "vitest";
import { addTodo, listTodos, toggleTodo } from "../lib/todos";

describe("todos", () => {
  it("adds a trimmed todo", () => {
    expect(addTodo("  buy milk ").title).toBe("buy milk");
    expect(listTodos()).toHaveLength(1);
  });
  it("toggles done", () => {
    const t = addTodo("call mom");
    expect(toggleTodo(t.id)?.done).toBe(true);
  });
});
