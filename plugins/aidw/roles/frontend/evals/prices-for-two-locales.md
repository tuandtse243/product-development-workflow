---
case: prices-for-two-locales
covers: [F12]
---
## Input

A frontend task brief (task T13, Vite + React + TypeScript, Vitest + Testing Library). Build the order summary.
`GET /api/orders/{id}` returns `{ currency: "EUR" | "USD", deliveryDate: "2026-12-03", lines: [{ name, quantity,
unitPriceMinor }], totalMinor }` (amounts in minor units, cents). Scenario ORD-1: "Given an order, then I see each line
with its price, the total and the delivery date, in my language and format." The app supports `en-US` and `de-DE`; the
project uses `react-i18next` (`const { t, i18n } = useTranslation()`, with `src/locales/en.json` and `de.json`;
`i18n.language` is the user's locale).
Touches: `src/orders/summary/**`, `src/locales/**`, `tests/orders/**`. Verify: `npm test`.

## Criteria

- must format money with `Intl.NumberFormat` (or `toLocaleString` with options) using the order's currency and the user's locale, and must not build the string by hand (such as `"$" + (cents / 100).toFixed(2)` or a `€` appended)
- must format the delivery date with `Intl.DateTimeFormat` (or `toLocaleDateString` with options, or the project's formatter) in the user's locale, not by slicing the ISO string
- must put every visible string it adds (headings, "Total", "Delivery") through `t()` and add the keys to both locale files
- must test the same order in `en-US` and `de-DE` and assert the two different formats the user sees
