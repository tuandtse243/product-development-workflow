# Domain

- **Patient**: a person who books visits; signed in by the clinic's sign-in app (a session cookie).
- **Doctor**: works at the clinic; has a specialty and a calendar.
- **Day**: a calendar day of a doctor on which they see patients.
- **Slot**: a time on a day of a doctor's calendar (`09:00`, the clinic's local time); open or booked.
- **Booking**: a patient's claim on one slot; a slot has at most one.
