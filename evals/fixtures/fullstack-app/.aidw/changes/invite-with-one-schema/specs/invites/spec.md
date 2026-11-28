## Purpose

Inviting people to a team from the web app.

## ADDED Requirements

### Requirement: Invite a member
The system SHALL let an owner of a team invite a person by name and email from the Team page (`/team`), SHALL refuse a name
longer than 80 characters (after trimming) and an email that is not valid both on the form, before anything is sent, and at the
server, with the same limits, and SHALL tell a member who is not an owner that only owners can invite.

#### Scenario: Owner invites a member
- **WHEN** an owner opens the invite dialog on the Team page, types a name (with spaces around it) and a valid email and sends
- **THEN** the dialog closes and the server holds the invitation with the trimmed name

#### Scenario: Name too long
- **WHEN** someone types a name of 81 characters in the invite dialog and sends
- **THEN** the name field is marked invalid and says the name is too long, nothing is sent to the server, and a name of 80 characters is accepted; the server refuses an 81-character name with 422 `validation` in the same way

#### Scenario: Email not valid
- **WHEN** someone types an email that is not an email address in the invite dialog and sends
- **THEN** the email field is marked invalid and says the email is not valid, and nothing is sent to the server; the server refuses it with 422 `validation` in the same way

#### Scenario: Member is refused
- **WHEN** a member of the team who is not an owner sends an invitation
- **THEN** the dialog says that only owners can invite, and nothing is stored

#### Scenario: Signed-out caller
- **WHEN** a caller with no session sends the invite request
- **THEN** the answer is 401 `unauthenticated` and nothing is stored
