---
name: schema-design-mongodb
description: Design the data model of a Change for MongoDB - documents shaped by the access paths, embed or reference, validation and indexes - and write it as data-model.md.
---

# Schema design for MongoDB

In a document database the model follows the queries even more than in a relational one: data that is read
together is stored together. The pattern catalogue is the vendored MongoDB material: list it with
`ls "$(dirname "$(aidw vendor-path mongodb/mongodb-schema-design)")/references"` and open the one file a decision
needs. Read its notes in `library/vendored-skill-notes.md` first: you have no live database, so the parts about
query statistics, slow-query logs and MCP tools do not apply.

## 1. Access paths first

The same table as for any database: every read and write the scenarios need, with its filter, sort, limit,
frequency and size. Add one column: **what is read together** in that path.

## 2. Embed or reference

Embed when the child is read with the parent, belongs to exactly one parent, and its count is bounded and small.
Reference when the child is shared, is queried on its own, grows without bound, or changes much more often than
the parent. Then check the result against these limits:

- a document must stay far below the 16 MB limit and should stay small enough to read often; an array that can
  grow without bound is a design error (bucket it, or move it to its own collection);
- a path that needs `$lookup` on every read is a sign the data should have been embedded, or copied
  (the extended-reference pattern: keep the few fields the path shows, and say who refreshes them);
- a multi-document transaction for an everyday write is a sign that what changes together is not stored together.

## 3. For each collection write

- the document shape with types, which fields are required, and which arrays are bounded (state the bound);
- the `$jsonSchema` validator for the rules the database can enforce;
- the indexes, one per access path that needs it (equality, sort, range order), unique where the business says
  unique, partial or TTL where it fits;
- every duplicated field: its source, and what keeps the copy correct;
- the shard key reasoning, only when the stated scale needs sharding.

## 4. Patterns, when an access path calls for one

Attribute, bucket, computed, extended reference, outlier, polymorphic, schema versioning, archive, time-series
collection: each has a reference file. Name the pattern, the path it serves and its cost. Do not apply a pattern
because it exists.

## 5. Output

- `changes/<id>/data-model.md`: the access-path table, one section per collection (shape, validator, indexes,
  duplicated fields), the decisions with their reasons, and one Mermaid `erDiagram` at entity level.
- `changes/<id>/data-model.dbml` is not written for MongoDB: DBML describes tables. Say so in the first line of
  `data-model.md`.
- For a collection that already has documents, add the migration plan (`aidw vendor-path aidw/schema-evolution`, "Documents").

## Sources

Ideas, not wording: MongoDB's `mongodb-schema-design` skill and its reference files (vendored, Apache-2.0), the
MongoDB manual's data modeling chapters, and the "Building with Patterns" series by Daniel Coupal and Ken Alger.
