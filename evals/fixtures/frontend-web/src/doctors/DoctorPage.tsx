import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getDoctor, listDays, type Day, type Doctor } from "../api/doctors";
import { useLoad } from "../data/useLoad";
import { Empty } from "../ui/Empty";
import { Spinner } from "../ui/Spinner";
import { DayList } from "./DayList";

const WEEK = 7;

/** A doctor and the days of their calendar. */
export function DoctorPage() {
  const { doctorId = "" } = useParams();
  const navigate = useNavigate();
  const [shown, setShown] = useState(WEEK);
  const doctor = useLoad<Doctor | null>((signal) => getDoctor(doctorId, signal), [doctorId], null);
  const days = useLoad<Day[]>((signal) => listDays(doctorId, signal), [doctorId], []);

  return (
    <section className="page">
      <p>
        <Link to="/">All doctors</Link>
      </p>
      <h1 className="page__title">{doctor.data?.name ?? "Doctor"}</h1>
      {doctor.data && <p className="page__subtitle">{doctor.data.specialty}</p>}
      {days.loading ? (
        <Spinner />
      ) : days.data.length ? (
        <DayList
          days={days.data.slice(0, shown)}
          onPick={(date) => navigate(`/doctors/${encodeURIComponent(doctorId)}/days/${date}`)}
          onMore={shown < days.data.length ? () => setShown((n) => n + WEEK) : undefined}
        />
      ) : (
        <Empty>No days open for booking.</Empty>
      )}
    </section>
  );
}
