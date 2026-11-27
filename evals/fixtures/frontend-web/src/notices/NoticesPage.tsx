import { useEffect, useState } from "react";
import { useFetch } from "../data/useFetch";
import { Empty } from "../ui/Empty";
import { Spinner } from "../ui/Spinner";
import "./notices.css";

interface Notice {
  id: string;
  title: string;
  topic: string;
  expired: boolean;
}

const TOPICS = ["all", "hours", "closures"];

/** The clinic's notices, narrowed by a topic. */
export function NoticesPage() {
  const [topic, setTopic] = useState("all");
  const { data, loading, failed } = useFetch<Notice[]>(`/api/notices?topic=${encodeURIComponent(topic)}`);
  const [shown, setShown] = useState<Notice[]>([]);
  useEffect(() => {
    setShown((data ?? []).filter((n) => !n.expired));
  }, [data]);

  return (
    <section className="page">
      <h1 className="page__title">Notices</h1>
      <label className="notices__topic">
        Topic
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <p role="alert">The notices could not be loaded.</p>
      ) : loading ? (
        <Spinner />
      ) : shown.length ? (
        <ul className="notices__list">
          {shown.map((n) => (
            <li key={n.id}>{n.title}</li>
          ))}
        </ul>
      ) : (
        <Empty>No notices.</Empty>
      )}
    </section>
  );
}
