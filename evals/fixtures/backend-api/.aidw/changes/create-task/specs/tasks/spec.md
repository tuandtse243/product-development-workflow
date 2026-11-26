## Purpose

Tasks of a team's projects: who may create them and what a task holds.

## ADDED Requirements

### Requirement: Create a task
The system SHALL let a member of a project's team create a task in that project, owned by the project's team and
created by the signed-in caller, and SHALL refuse everyone else without revealing whether the project exists.

#### Scenario: Member creates a task
- **WHEN** a signed-in member of the project's team posts a valid title and due date
- **THEN** the response is 201 with the task's id, title, due date and creation time, and the stored task belongs to the project's team and was created by the caller

#### Scenario: No session
- **WHEN** a request has no session
- **THEN** the response is 401 unauthenticated and no task is written

#### Scenario: Project of another team
- **WHEN** a signed-in user who is not a member of the project's team posts a valid task
- **THEN** the response is 404 project-not-found, the same as for a project that does not exist, and no task is written

#### Scenario: Team named in the request
- **WHEN** the request names a team, in a `teamId` body field or in the `x-team-id` header
- **THEN** a `teamId` body field is refused with 400 invalid-request, the header is ignored, and the task's team is always the project's team

#### Scenario: Due date in the past
- **WHEN** a member posts a due date before today (UTC)
- **THEN** the response is 422 due-date-in-past and no task is written
