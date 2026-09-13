# I, Robot — Banned Books AR

A mobile-first MindAR vertical slice for the 2008 Bantam trade paperback of *I, Robot* (ISBN 9780553382563). Point the camera at the full front cover and the app anchors a floating cover/summary card above it. A normal HTML summary panel appears at the same time for readability and accessibility.

Deployments:

- Private Sites build: https://i-robot-banned-books-ar.san-jose-sta-2217.chatgpt.site
- Public GitHub Pages build: https://crashpr0.github.io/Banned-Book-Week/

## Run it

```bash
npm install
npm run check:target
npm run dev
```

Open the printed local URL. Camera access works on `localhost`; a phone build must be served over HTTPS. “Preview without a camera” exercises the result state without camera access.

```bash
npm run build
```

The static production build is written to `dist/`.

## Content and cover ingestion

The app never contacts a catalog, publisher, or cover service at runtime. It reads only same-origin files from `public/data/` and `public/assets/`.

`npm run scrape` refreshes the pinned image from Penguin Random House’s documented ISBN cover endpoint. The script allowlists the host, limits response size and time, validates JPEG bytes, hashes the result, and marks the MindAR target stale whenever the cover changes. A changed cover must be visually matched to the physical book before recompiling.

To refresh metadata from a catalog page saved manually as HTML:

```bash
npm run scrape -- --source-html /absolute/path/to/record.html
```

The parser reads the page’s `Book` JSON-LD and fails closed unless it finds the expected ISBN. Live SJPL fetching is intentionally permission-gated because BiblioCommons terms restrict automated harvesting:

```bash
npm run scrape -- --live-sjpl --authorized
```

Use that option only after the project owner has documented permission. It fetches one anonymous record; do not schedule or batch it.

## Recompile the recognition target

After an approved cover changes:

```bash
npm run compile:target
```

Open the printed loopback URL once. The page runs MindAR 1.2.5’s compiler in the browser, writes `public/assets/i-robot.mind`, records the exact cover SHA-256 in the manifest, and shuts its local server down. Then run `npm run check:target`.

See [docs/AR_LOGIC.md](docs/AR_LOGIC.md) for the state machine, data flow, and the path to more books.

## Production checks

- Test the actual library copy, not only an image on a second screen. Jackets, stickers, glare, and reprints can change recognition.
- Confirm cover reproduction rights before public launch. The repository records provenance, not a license grant.
- Keep A-Frame, MindAR, the cover, and `.mind` target pinned. Update them deliberately and re-test iOS Safari and Android Chrome.
- Camera video is processed in the browser and is not uploaded by this app.
