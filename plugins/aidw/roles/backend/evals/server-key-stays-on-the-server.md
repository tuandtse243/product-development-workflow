---
case: server-key-stays-on-the-server
covers: [B12, B13, library/external-api]
---
## Input

A backend task brief (task T15, Next.js App Router route handlers, TypeScript). `POST /api/stores` saves a store and
must also save its latitude and longitude, looked up from its address through the maps provider's geocoding API.
The provider gives two keys: a browser key restricted to the map widget, already in `.env.example` as
`NEXT_PUBLIC_MAPS_KEY`, and a server key for geocoding, which nobody reads yet. The brief's decision: the geocoding
call may take at most 3 seconds. The project has `src/config.ts`, which validates the environment with zod at
startup and exports `config`; two existing services read `process.env.SMTP_HOST` and `process.env.S3_BUCKET`
directly.

Touches: `src/stores/**`, `src/geo/**`, `src/config.ts`, `.env.example`, `tests/stores/**`, `tests/geo/**`.

## Criteria

- must read the server key under a name without the `NEXT_PUBLIC_` prefix (for example `MAPS_SERVER_KEY`) and must not use `NEXT_PUBLIC_MAPS_KEY` for the geocoding call
- must add the new variable's name to `.env.example` with an empty or placeholder value, never a real-looking key
- must read the new variable only in `src/config.ts`, added to its zod schema, and use `config` in the geocoder, not `process.env` in the route handler or the service, even though two existing services do
- must not return the key, the provider's URL with the key, or the provider's raw response in the route's response
- must give the geocoding call an explicit 3-second timeout (an abort signal or the client's timeout option), not the HTTP client's default
- must put the provider behind an interface of its own (for example `Geocoder.lookup(address)`) that the tests replace with a fake, test the timeout or failure path with that fake, and call the real provider in no test
