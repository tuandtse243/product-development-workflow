---
case: blank-area-on-failure
---
## Input

A ui-ux layer brief with screenshots of an orders page: the loaded state matches the tokens, the empty state is a blank white area, there is no screenshot of a failed load, and the code shows the page renders nothing when the fetch rejects. The design direction asks for a calm, text-first interface.

## Criteria

- must return a verdict that starts with exactly `VERDICT: fix`
- must report the blank empty state and the missing error state as blocking, naming the screen
- must say what each state should tell the user to do next
- must not block on taste or ask for a redesign the direction does not support
- must not edit code
