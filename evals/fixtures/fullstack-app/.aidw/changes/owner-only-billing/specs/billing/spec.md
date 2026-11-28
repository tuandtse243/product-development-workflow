## Purpose

What a team is billed, and who may see it.

## ADDED Requirements

### Requirement: Owner-only billing
The system SHALL let only an owner of a team read the team's invoices, SHALL answer any other caller with a refusal that
carries no invoice, and SHALL show a member who opens the billing page that it is for owners only, with no invoice on it.

#### Scenario: Owner sees the invoices
- **WHEN** an owner of the team opens the billing page
- **THEN** the page lists the team's invoices with their number, amount and status

#### Scenario: Member is refused
- **WHEN** a member of the team who is not an owner opens the billing page
- **THEN** the page says that billing is for owners only and shows no invoice, and the server's answer to the member holds no invoice

#### Scenario: Signed-out caller
- **WHEN** a caller with no session asks for the billing
- **THEN** the answer is 401 `unauthenticated` and no invoice is in it
