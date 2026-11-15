import { NextResponse } from "next/server";
import { addTodo, listTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(listTodos());
}

export async function POST(req: Request) {
  const { title } = (await req.json()) as { title?: string };
  if (!title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  return NextResponse.json(addTodo(title), { status: 201 });
}
