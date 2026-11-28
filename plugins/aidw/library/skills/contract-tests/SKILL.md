---
name: contract-tests
description: Prove that client and server agree on a contract, so a change on one side fails a test.
---

# Contract tests

- **Source of truth.** The contract in the architecture and delta specs: path, method, request fields, response fields, status
  codes and the error shape. Neither the client nor the server defines it; both are checked against it.
- **One shared description.** Prefer a single schema both sides import (a zod schema, an OpenAPI file, shared types with a
  runtime check). If the project has none and the plan did not ask for one, write the expected shape once in the test, not
  twice.
- **Server side.** Call the real route and validate the response body against the schema, for the success case and for each
  error the contract names. Fields the contract does not list must not appear.
- **Client side.** Feed the client the schema's example payloads (including the error shapes) and assert it renders or maps
  them. Assert what it sends equals the request shape.
- **Name the field.** A mismatch is almost always one field (`dueDate` vs `due_date`, a number vs a string, a nullable
  value). The failing assertion names that field; fix it in the glue (mapper, serializer), and say which side deviated.
- **No network.** Run both checks in process. A contract test that needs a deployed service is not a contract test.
