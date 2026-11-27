## Purpose

Inviting a colleague to the clinic's team from the web app.

## ADDED Requirements

### Requirement: Invite a person
The system SHALL let an owner invite a colleague at `/people/invite` with a name and an email, SHALL show each error
of a field next to that field, and SHALL send one invitation however many times the form is submitted.

#### Scenario: The form
- **WHEN** an owner opens the screen
- **THEN** there is a form with a Name field, an Email field and a Send invitation button, each field labelled

#### Scenario: Refused before sending
- **WHEN** the owner sends a form whose name is empty or longer than 80 characters
- **THEN** the form says what is wrong next to the Name field, ties that message to the field, keeps what was typed, and sends no request

#### Scenario: Invitation sent
- **WHEN** the owner sends a valid form and the API answers 201
- **THEN** the screen says "Invitation sent" with the email, and both fields are emptied

#### Scenario: Field error from the API
- **WHEN** the API answers 422 with an error for a field
- **THEN** the message is shown next to that field and tied to it, that field is marked invalid, and what the owner typed stays in both fields

#### Scenario: Send once
- **WHEN** the owner submits the form again while its request is still waiting for an answer
- **THEN** only one request is sent

#### Scenario: Invitation fails
- **WHEN** the request fails with anything but a field error (an error status or no answer)
- **THEN** an alert says the invitation could not be sent, what the owner typed stays, and the form can be sent again
