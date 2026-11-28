## Purpose

What the clinic pays and owes, as a billing summary that only the owners of the clinic may see in the web app.

## ADDED Requirements

### Requirement: Billing for owners
The system SHALL show the clinic's billing summary at `/billing` to a signed-in owner only, SHALL send a visitor who
is not signed in to the sign-in page, SHALL tell a signed-in member the page is for owners only, and SHALL decide who
the person is from the API's session answer alone.

#### Scenario: Checking access
- **WHEN** a person opens `/billing` and the session answer has not arrived yet
- **THEN** the screen says it is checking access, and no billing request has been sent

#### Scenario: Billing for an owner
- **WHEN** the session says the person is an owner
- **THEN** the screen shows the plan, the balance due as money in its currency and the date of the next invoice

#### Scenario: Signed out
- **WHEN** nobody is signed in (401 `not-signed-in`)
- **THEN** the person is sent to `/login?next=/billing` and no billing request is sent

#### Scenario: Members see an owners-only page
- **WHEN** the session says the person is a member, whatever the browser has stored about their role
- **THEN** the screen says "Owners only" and no billing request is sent

#### Scenario: Test mode badge
- **WHEN** an owner opens the billing page and `VITE_STRIPE_PUBLISHABLE_KEY` starts with `pk_test_`
- **THEN** the page says "Test mode"
