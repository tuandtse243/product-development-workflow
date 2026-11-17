---
case: parallel-tasks-share-names
---
## Input

Approved specs for a split Slice: the backend exposes the free slots of a practitioner and the frontend shows them in a day view. The two tasks have disjoint `touches` and are meant to run in the same wave.

## Criteria

- must write a Produces line for the backend task with the route, the request and the response shape
- must write a Consumes line for the frontend task that matches the backend's Produces word for word
- must name each shared type in exactly one task's Produces
- must give each task a Review focus of at most three points
- must not leave the name of a shared function, route or type for the implementers to choose
