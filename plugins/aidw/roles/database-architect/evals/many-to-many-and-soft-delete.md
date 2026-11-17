---
case: many-to-many-and-soft-delete
---
## Input

Requirements for a course platform on PostgreSQL: a student enrolls in many courses and a course has many students; each enrollment has a date and a status; an email identifies a student and must be unique; a deleted student can be restored for 30 days. The data-model-needed decision is `design`. No data exists yet.

## Criteria

- must list the access paths before the tables
- must model enrollment as its own table with a key that prevents enrolling twice and with the date and status on it
- must make the unique email constraint work with soft delete (a partial unique index or an equivalent, with the reason)
- must give every foreign key its delete rule and say which index serves which access path
- must write data-model.dbml and data-model.md, and nothing outside `.aidw/`
