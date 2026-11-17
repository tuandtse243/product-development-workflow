---
name: assumptions-premortem
description: Before the Approval Gate, list what the plan takes for granted, rank it, and imagine the Change has failed to find what was missed.
---

# Assumptions and pre-mortem

The user approves what they can see. This makes the invisible part of the plan visible before the gate.

## 1. List the assumptions

Go through the requirements and write down everything that is believed but not confirmed, one line each, in four groups:

- **Value**: users want this and will use it this way.
- **Usability**: they can find it and get through it without help.
- **Feasibility**: it can be built with this stack, this data and these services, in the stated limits.
- **Viability**: it is allowed (law, contract, policy), affordable to run, and supportable.

An answer the user gave is not an assumption. A guess you made because nobody knew is.

## 2. Rank them

For each: how bad if it is wrong (low, high), and how sure are we (known, believed, guessed). Anything **high and
guessed** must be dealt with before approval, in one of three ways:

- ask the user now;
- make it cheap to be wrong: move it into the first Slice so it is tested first, or design so it can change;
- state it at the gate as a risk the user accepts by approving.

## 3. Pre-mortem

Imagine it is three months later and the Change was a failure. Write the five most likely reasons, as if they had
already happened: "users kept using the spreadsheet because import was missing", "the provider's limit was 100
requests a day". For each, name the earliest sign you would see and what in the plan addresses it. A reason with
nothing addressing it is a gap: add a requirement, a scenario or a stated risk.

## 4. What goes in the Analysis

Under `## Risks and assumptions`: the ranked list (high first), what was done about each high one, and the
pre-mortem reasons that remain open. Keep it to what the user needs to decide; a risk register nobody reads
protects nobody.

## Sources

Ideas, not wording: Gary Klein's pre-mortem, Marty Cagan's four product risks, the assumption-mapping practice of
David Bland's *Testing Business Ideas*, and the pre-mortem and assumption skills of phuryn/pm-skills and
deanpeters/Product-Manager-Skills.
