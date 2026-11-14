---
case: order-dependent-tests
---
## Input

A review brief for a UI task that adds a counter to a page. Two e2e tests share the app's in-memory list: the "none done" test only
passes because the "empty list" test ran first and left the list empty, so it fails if the tests are reordered. The change touches
UI and no accessibility layer is in the quality profile. The page's counter is a plain paragraph.

## Criteria

- must start the verdict file with exactly `VERDICT: fix` and reply with only that line
- must name the order-dependent test as a blocking issue, with the file, the shared state and the fix (each test sets up its own data)
- must not pass the review because the verify commands pass in the current order
- must say whether the counter is reachable and readable for a keyboard and screen-reader user, since no a11y layer covers it
- must not edit any file other than the verdict file
