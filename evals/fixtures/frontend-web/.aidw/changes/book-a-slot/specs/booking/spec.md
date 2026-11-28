## Purpose

Booking a visit from the web app: the slots of one day of a doctor's calendar and booking a free one.

## ADDED Requirements

### Requirement: Book a slot
The system SHALL show the slots of a day of a doctor's calendar at `/doctors/{doctorId}/days/{date}`, SHALL let the
patient book an open slot after confirming it in a dialog, and SHALL tell a failed load apart from a day with no slots.

#### Scenario: Slots loading
- **WHEN** a patient opens a day and its slots have not arrived yet
- **THEN** the screen says the slots are loading

#### Scenario: Open slots of a day
- **WHEN** a patient opens a day of a doctor
- **THEN** each open slot is a button named by its time, and a booked slot shows its time with "Booked" and cannot be picked

#### Scenario: Pick a slot
- **WHEN** the patient picks an open slot
- **THEN** a dialog opens whose title names the slot's time and the doctor's full name, and focus moves into it

#### Scenario: Close without booking
- **WHEN** the patient closes the dialog with Escape or Cancel
- **THEN** the dialog closes, nothing is booked, and focus is back on the slot the patient picked

#### Scenario: Confirm the booking
- **WHEN** the patient confirms in the dialog
- **THEN** the slot is booked (`POST /api/bookings`), the dialog closes, and the slot shows "Booked" and cannot be picked again

#### Scenario: Slot taken meanwhile
- **WHEN** the patient confirms a slot another patient booked a moment before (409 `slot-taken`)
- **THEN** the dialog says the slot has just been taken, and the slot shows "Booked"

#### Scenario: Slots fail to load
- **WHEN** the request for the slots fails (an error status or no answer)
- **THEN** an alert says the slots could not be loaded and offers Retry, which loads them again; the screen never shows the empty text for a failed load

#### Scenario: No slots on the day
- **WHEN** the day has no slots
- **THEN** the screen says "No open slots on this day."
