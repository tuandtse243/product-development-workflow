# API contract: book-a-slot

Author: api-designer. Binding: keep every name, status code and error type. The two operations exist in the clinic API
already; this Change builds the screen that uses them. The browser sends the patient's session cookie; signing in is
not part of this Change.

Error answers are problem bodies `{ type, title, status }` (`application/problem+json`); `detail` may be added and is
never relied on. A 5xx may come with no body at all.

## GET /api/doctors/{doctorId}

The doctor (exists; used by the doctor's page).

### 200 OK

```json
{ "id": "d1", "name": "Dr. Ana Lima", "specialty": "General practice" }
```

A name can be long (up to 120 characters) and is shown whole.

| status | type | when |
|---|---|---|
| 404 | `doctor-not-found` | no doctor has this id |

## GET /api/doctors/{doctorId}/days/{date}/slots

The slots of one day of a doctor's calendar, by time. `date` is `YYYY-MM-DD`.

### 200 OK

```json
[
  { "id": "s1", "time": "09:00", "booked": false },
  { "id": "s3", "time": "10:00", "booked": true }
]
```

`time` is `HH:MM` in the clinic's local time; `booked` says whether the slot already has a booking. A day with no slot
(the doctor does not work that day) is an empty list.

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | `date` is not `YYYY-MM-DD` |
| 404 | `doctor-not-found` | no doctor has this id |
| 5xx | any, or no body | the API cannot answer now; the request may be sent again |

## POST /api/bookings

Books one slot for the signed-in patient.

### Request

Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `slotId` | string | required; the `id` of a slot |

### 201 Created

```json
{ "id": "b1", "slotId": "s1" }
```

### Errors

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON, `slotId` is missing or not a string, or the body has another field |
| 404 | `slot-not-found` | no slot has this id |
| 409 | `slot-taken` | the slot already has a booking, also one made a moment ago by another patient |
| 5xx | any, or no body | the API cannot answer now; whether the booking was made is unknown |
