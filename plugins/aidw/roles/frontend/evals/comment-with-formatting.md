---
case: comment-with-formatting
covers: [F16]
---
## Input

A frontend task brief (task T8, Vite + React + TypeScript, Vitest + Testing Library). Show the comments under a post.
`GET /api/posts/{id}/comments` returns `{ comments: [{ id, author, bodyMarkdown }] }`; the body is Markdown written by
any user and may contain links and images. Scenario CMT-1: "Given a comment with bold text and a link, then I see the
bold text and a link I can follow." The project already depends on `marked` and has `sanitizeHtml(html: string): string`
in `src/lib/sanitize.ts` (a DOMPurify wrapper used by the article page).
Touches: `src/comments/**`, `tests/comments/**`. Verify: `npm test`.

## Criteria

- must not insert HTML made from a comment into the page unless it passes `sanitizeHtml` (or must render the Markdown through a renderer that never inserts raw HTML)
- must make sure a link whose URL is `javascript:` (or another scheme than `http`, `https`, `mailto`) is not rendered as a working link
- must give external links `rel="noopener noreferrer"`
- must test with a hostile comment (a `<script>` or `<img onerror>` body and a `[x](javascript:alert(1))` link) that no script element, event handler attribute or `javascript:` href reaches the DOM, and that the bold text and a safe link do render
