## Purpose

Finding a person of the clinic by name from the web app.

## ADDED Requirements

### Requirement: Search people
The system SHALL show, at `/people`, a search box and the people whose name contains the text typed in it, and SHALL
show only the answer to the latest text, whatever order the answers arrive in.

#### Scenario: Nothing typed yet
- **WHEN** a patient opens the screen, or the search box is empty
- **THEN** the screen says "Type a name to search." and no search request is sent

#### Scenario: Search waiting
- **WHEN** the patient has typed a text and its answer has not arrived yet
- **THEN** the screen says it is searching

#### Scenario: People matching the text
- **WHEN** the answer to the text arrives with people
- **THEN** each person is listed with the name and the title

#### Scenario: Latest text wins
- **WHEN** the patient adds a letter before the answer to the earlier text has arrived, and the earlier answer arrives after the latest one
- **THEN** only the people matching the latest text are listed, and the earlier answer is never shown

#### Scenario: Clear the box
- **WHEN** the patient empties the search box while an answer is still on its way
- **THEN** the screen says "Type a name to search." again, the late answer is never shown, and no request is sent for the empty box

#### Scenario: Nobody matches
- **WHEN** the answer to the text is an empty list
- **THEN** the screen says "No one matches" and the text typed

#### Scenario: Search fails
- **WHEN** the request fails (an error status or no answer)
- **THEN** an alert says the search failed and offers Retry, which searches the same text again; the screen never says no one matches for a failed search
