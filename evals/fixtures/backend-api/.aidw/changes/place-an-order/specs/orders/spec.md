## Purpose

Orders of add-ons for a team: who may place them, what is stored, and the confirmation email.

## ADDED Requirements

### Requirement: Place an order
The system SHALL let a member of a team place an order of add-ons for the team at the products' current prices, SHALL
send the caller one confirmation email after the order is stored, also when the mail provider was down at the time,
and SHALL refuse everyone else without revealing whether the team exists.

#### Scenario: Member places an order
- **WHEN** a signed-in member of the team posts lines of active products
- **THEN** the response is 201 with the order, the order and its lines are stored, and the caller gets one confirmation email

#### Scenario: No session
- **WHEN** a request has no session
- **THEN** the response is 401 unauthenticated, no order is stored and no email is sent

#### Scenario: Team of another member
- **WHEN** a signed-in user who is not a member of the team posts an order
- **THEN** the response is 404 team-not-found, the same as for a team that does not exist, and no order is stored

#### Scenario: Unknown product
- **WHEN** a line names a product that does not exist or is not active
- **THEN** the response is 422 unknown-product, no order is stored and no email is sent

#### Scenario: Mail provider down
- **WHEN** the mail provider fails while a member places an order
- **THEN** the response is 201, the order is stored, and the confirmation is sent once the provider is back

#### Scenario: Order write fails
- **WHEN** storing the order fails part way
- **THEN** no order and no line are stored and no confirmation is ever sent

#### Scenario: Sender runs twice
- **WHEN** the job that sends the email runs twice, one after the other or at the same moment
- **THEN** the provider is asked to send the confirmation once
