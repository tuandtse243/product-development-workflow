import { getJson } from "../api/client";

/** A person of the clinic, as GET /api/people answers it. */
export interface Person {
  id: string;
  name: string;
  title: string;
}

export const searchPeople = (q: string, signal?: AbortSignal) => getJson<Person[]>(`/api/people?q=${encodeURIComponent(q)}`, { signal });
