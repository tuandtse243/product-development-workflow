const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A calendar day (`YYYY-MM-DD`) as the app shows it, e.g. "Mon 7 Jan 2030". */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : dayFormat.format(d).replace(",", "");
}
