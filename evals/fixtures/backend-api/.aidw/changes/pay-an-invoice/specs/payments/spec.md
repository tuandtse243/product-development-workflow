## Purpose

Payments of a team's invoices with the team's saved card: who may pay and how often a card is charged.

## ADDED Requirements

### Requirement: Pay an invoice
The system SHALL let a member of an invoice's team charge the team's saved card for the invoice, SHALL charge the card
at most once per Idempotency-Key of the caller however often the request is sent, and SHALL refuse everyone else
without revealing whether the invoice exists.

#### Scenario: Member pays an invoice
- **WHEN** a signed-in member of the invoice's team posts an amount with a new Idempotency-Key
- **THEN** the card is charged once through the payment provider and the response is 201 with the payment

#### Scenario: No session
- **WHEN** a request has no session
- **THEN** the response is 401 unauthenticated, nothing is charged and nothing is written

#### Scenario: Invoice of another team
- **WHEN** a signed-in user who is not a member of the invoice's team posts a payment
- **THEN** the response is 404 invoice-not-found, the same as for an invoice that does not exist, and nothing is charged

#### Scenario: Same request sent again
- **WHEN** the caller sends a request again with the same Idempotency-Key after the first finished
- **THEN** the response is the first one again, the same status and body, and the card is not charged again

#### Scenario: Key reused for another request
- **WHEN** the caller sends another amount or another invoice with an Idempotency-Key used before
- **THEN** the response is 422 idempotency-key-reused and nothing is charged

#### Scenario: Request still running
- **WHEN** the caller sends a request with the same Idempotency-Key while the first is still waiting for the provider
- **THEN** the response is 409 request-in-progress and the card is charged once in all

#### Scenario: Provider does not answer
- **WHEN** the provider does not answer and the caller then sends the same request with the same Idempotency-Key
- **THEN** the first response is 502 payment-provider-unavailable, the second is 201, and the card is charged at most once
