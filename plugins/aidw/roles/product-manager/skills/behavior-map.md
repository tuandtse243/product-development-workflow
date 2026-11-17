---
name: behavior-map
description: Lay the required behavior out along the user's journey and cut the thinnest path that runs end to end, before writing requirements.
---

# Behavior map

A flat list of requirements hides two things: the order the user meets them in, and which of them are needed for
anything to work at all. Draw the map first; the requirements and the Slices fall out of it.

## Build the map

1. **Backbone.** Write the user's activities left to right in the order they happen, from the trigger to the
   outcome of the job (discover, sign in, create, review, share...). Five to nine steps. One backbone per user kind
   when their journeys differ.
2. **Behaviors.** Under each step list what the system must do there, each as a behavior a user could observe.
   Include the unhappy ones: nothing found, not allowed, wrong input, the second attempt.
3. **Order by need.** Within each column put the behavior without which the step cannot happen at the top, then
   the ones that make it good.

## Cut the first Slice

Draw one line across the map that takes the top behavior of every step. That row is the thinnest path that lets
one user get the whole job done once, badly but for real. It is the first Slice (the MVP of a new product). Check it:

- it runs end to end with no step faked by hand;
- it would teach you something if a user tried it;
- nothing in it is there "because we will need it later".

Each further row is the next Slice: the same journey, a little better. A Slice is always a row, never a column:
"all of sign-in" or "the whole data model" delivers nothing a user can do.

## From map to Artifacts

- Each behavior becomes a requirement with at least one scenario; its step tells you the capability it belongs to.
- The row a behavior sits in is its Slice; say so in the requirements so the Technical Planner can keep a Slice
  together.
- A behavior nobody could place under a step is either out of scope or a missing step. Decide which.
- What is below the last line you drew goes under Out of Scope, in the user's words.

## Sources

Ideas, not wording: Jeff Patton's user story mapping (backbone, walking skeleton, release slices), the story-mapping
skills of deanpeters/Product-Manager-Skills and phuryn/pm-skills, and Alistair Cockburn's walking skeleton. aidw
says Slice where those sources say story or release.
