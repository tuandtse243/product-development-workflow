## Purpose

Projects of a team in the web app: seeing them and changing them.

## ADDED Requirements

### Requirement: Rename a project
The system SHALL let the owner of a team rename one of the team's projects from the project's page, SHALL refuse a name
another project of the team already has, SHALL tell a member who is not an owner that only owners can rename, and SHALL
show the stored name afterwards on the page and in the list of projects.

#### Scenario: Owner renames
- **WHEN** an owner of the team types a new name, with spaces around it, on the project's page and saves
- **THEN** the page shows the name as the server stored it, without the spaces, and the server holds that name

#### Scenario: List shows the new name
- **WHEN** an owner renames a project and then goes to the list of projects
- **THEN** the list shows the new name and no longer the old one

#### Scenario: Name already taken
- **WHEN** an owner saves a name that another project of the same team has
- **THEN** the name field is marked invalid and says the name is already taken, the project keeps its name, and what the owner typed stays in the field

#### Scenario: Blank name
- **WHEN** an owner saves a name that is empty or only spaces
- **THEN** the name field is marked invalid and says a name is required, and the project keeps its name

#### Scenario: Member is refused
- **WHEN** a member of the team who is not an owner saves a new name
- **THEN** the page says that only owners can rename a project, still shows the project under its old name, and does not fail

#### Scenario: Signed-out caller
- **WHEN** a caller with no session sends the rename request
- **THEN** the answer is 401 `unauthenticated` and nothing changes
