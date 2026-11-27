## Purpose

Bookings of a team's meeting rooms by the hour: who may book and how a slot stays single.

## ADDED Requirements

### Requirement: Book a slot
The system SHALL let a member of a room's team book a free slot of the room (the hour it starts), SHALL keep at most
one active booking per slot also when bookings of it arrive at the same moment, and SHALL refuse everyone else without
revealing whether the room exists.

#### Scenario: Member books a free slot
- **WHEN** a signed-in member of the room's team posts a future hour that has no active booking
- **THEN** the response is 201 with the booking, stored for the room's team and made by the caller

#### Scenario: No session
- **WHEN** a request has no session
- **THEN** the response is 401 unauthenticated and no booking is written

#### Scenario: Room of another team
- **WHEN** a signed-in user who is not a member of the room's team posts a booking
- **THEN** the response is 404 room-not-found, the same as for a room that does not exist, and no booking is written

#### Scenario: Slot already taken
- **WHEN** a member books a slot that has an active booking
- **THEN** the response is 409 slot-taken and the slot keeps its one booking

#### Scenario: Two bookings at once
- **WHEN** several members book the same free slot at the same moment
- **THEN** exactly one gets 201, every other gets 409 slot-taken, and the slot has one active booking

#### Scenario: Cancelled booking frees the slot
- **WHEN** a member books a slot whose only booking is cancelled
- **THEN** the response is 201

#### Scenario: Slot in the past
- **WHEN** a member posts an hour that is not later than now
- **THEN** the response is 422 slot-in-past and no booking is written
