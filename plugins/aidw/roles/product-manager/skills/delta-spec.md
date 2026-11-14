# Delta spec grammar

The CLI parses delta specs strictly. One file per capability at `.aidw/changes/<id>/specs/<capability>/spec.md`.

```markdown
## Purpose
<new capability only: what it is for, 50+ characters>

## ADDED Requirements

### Requirement: <one behavior>
The system SHALL <behavior>.

#### Scenario: <name>
- **GIVEN** <precondition>          (optional)
- **WHEN** <trigger>
- **THEN** <observable outcome>

## MODIFIED Requirements
<copy the WHOLE existing block from .aidw/specs/<capability>/spec.md, keep its header exactly, then edit>

## REMOVED Requirements
### Requirement: <exact existing name>
**Reason**: <why>
**Migration**: <what users or code do instead>

## RENAMED Requirements
- FROM: <old name>
- TO: <new name>
```

Every requirement needs at least one scenario; scenarios become the E2E and integration tests later. Run
`aidw validate <id>` and fix every error.
