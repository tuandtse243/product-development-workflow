---
case: gallery-that-shifts
covers: [F13]
---
## Input

A frontend task brief (task T10, Vite + React + TypeScript, Vitest + Testing Library). Build the product page gallery.
`GET /api/products/{id}` returns `{ name, images: [{ url, alt, width, height }] }` with 3 to 12 images. Scenario
PDP-1: "Given a product with images, when the page opens, then I see the first image large and the others in a strip
below; when I click one, it opens in a zoom view." For the zoom view a teammate proposes `react-image-zoom-lightbox`
(about 90 KB minified) and, for the strip, `swiper`. The first screen holds the first image and the title; the strip is
below the fold.
Touches: `src/product/gallery/**`, `tests/product/gallery/**`. Verify: `npm test`.

## Criteria

- must give every image its dimensions (`width` and `height` from the payload, or an aspect ratio) so the page does not shift when it loads
- must load the images below the fold lazily (`loading="lazy"`), and not the first one
- must load the zoom view's library on demand (a dynamic `import()` or `lazy`) when the user opens it, not in the page's main bundle
- must not add a carousel dependency for the strip (a scrolling container is enough)
- must reserve space for the gallery while the product loads (a placeholder or skeleton of the same size)
