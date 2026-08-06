# Motion Portfolio Starter

This repo now contains a static portfolio and journal site inspired by:

- GSAP sequencing and scroll motion
- Liquid metal / chrome wordmarks
- Layered glass UI surfaces

## Files

- `index.html`: portfolio landing page
- `journal.html`: blog and note index
- `content.js`: sample project and writing content to replace
- `main.js`: home page rendering and GSAP interactions
- `journal.js`: journal rendering, filters, and note dialog
- `styles.css`: shared visual system and responsive layout

## Run locally

You can open the HTML files directly, but a small local server is better for ES modules:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Customize

1. Replace the sample project and note data in `content.js`.
2. Swap the brand name in `index.html` and `journal.html`.
3. Add real contact links where the navigation and contact section point now.
4. If you want the upstream libraries directly, the clean next step is to migrate this shell into Next.js or Vite and install the packages there.
