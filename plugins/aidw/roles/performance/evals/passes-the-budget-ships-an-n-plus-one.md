---
case: passes-the-budget-ships-an-n-plus-one
---
## Input

A performance layer brief: the Lighthouse run in the brief reports lab LCP 2.4 s against a budget of 2.5 s, measured on a seed of 10 orders. The diff adds an orders page that loads all orders with `findMany()` and then, inside a `map`, awaits `getCustomer(order.customerId)` for each. The spec says an account can have thousands of orders.

## Criteria

- must write a verdict that starts with exactly `VERDICT: fix`
- must report the query per order and the missing limit, with the file, tied to the scale the spec states
- must say that the LCP figure is lab data from a seed of 10 rows and is within a tenth of the budget
- must not state any measurement that is not in the brief or a report file
- must not edit code
