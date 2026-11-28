import { Link } from "react-router";
import { listDoctors, type Doctor } from "../api/doctors";
import { useLoad } from "../data/useLoad";
import { Empty } from "../ui/Empty";
import { Spinner } from "../ui/Spinner";
import "./doctors.css";

/** Every doctor of the clinic; each links to their calendar. */
export function DoctorsPage() {
  const { data, loading } = useLoad<Doctor[]>((signal) => listDoctors(signal), [], []);
  return (
    <section className="page">
      <h1 className="page__title">Doctors</h1>
      {loading ? (
        <Spinner />
      ) : data.length ? (
        <ul className="doctor-list">
          {data.map((d) => (
            <li key={d.id} className="doctor-list__item">
              <Link to={`/doctors/${encodeURIComponent(d.id)}`}>{d.name}</Link>
              <span className="doctor-list__specialty">{d.specialty}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No doctors yet.</Empty>
      )}
    </section>
  );
}
