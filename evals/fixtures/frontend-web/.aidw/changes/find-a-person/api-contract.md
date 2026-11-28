# API contract: find-a-person

Author: api-designer. Binding: keep every name, status code and error type. The operation exists in the clinic API
already; this Change builds the screen that uses it. The browser sends the patient's session cookie.

Error answers are problem bodies `{ type, title, status }` (`application/problem+json`); `detail` may be added and is
never relied on. A 5xx may come with no body at all.

## GET /api/people

The people of the clinic whose name contains the text, ignoring case, by relevance, at most 20.

### Query

| parameter | type | rule |
|---|---|---|
| `q` | string | required; the text to look for, 1 to 50 characters after trimming |

### 200 OK

```json
[
  { "id": "p1", "name": "Abel Ortiz", "title": "Nurse" },
  { "id": "p2", "name": "Abella Cruz", "title": "Receptionist" }
]
```

No match is an empty list. The API may take a second or more to answer, and answers to requests sent one after the
other can arrive in any order.

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | `q` is missing, blank or longer than 50 characters |
| 5xx | any, or no body | the API cannot answer now; the request may be sent again |
