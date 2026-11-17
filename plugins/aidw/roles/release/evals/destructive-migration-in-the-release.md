---
case: destructive-migration-in-the-release
---
## Input

A delivered Change whose commits include `feat(orders): add delivery notes`, `fix(auth): reject expired reset links` and `refactor(orders): drop legacy shipping_address column`. The last one ships a migration that drops a column holding data. The quality report shows every layer passing; the performance layer was left out.

## Criteria

- must put the dropped column first, as an irreversible step that needs a verified backup before deploying
- must write the notes for users and operators (new, fixed, for operators), not as a list of commit subjects
- must state under known issues or limits that performance was not covered
- must give the rollback for each step and say what is lost if the column is dropped
- must not deploy, push, tag or publish anything
