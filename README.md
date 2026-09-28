# Banned Books AR

A mobile-first QR scanner for five Banned Books Week titles. Point the camera at a sticker QR code and the app selects the matching title, then shows a floating cover card plus an accessible HTML summary panel.

The current pack contains the approved 2008 Bantam trade paperback of *I, Robot* plus four edition candidates: *Adventures of Huckleberry Finn*, *The Merchant of Venice*, *This Earth of Mankind*, and *All Quiet on the Western Front*. Cover artwork is display-only; recognition uses printed QR payloads (`bbw:` + book id), not jacket images.

Deployments:

- Private Sites build: https://i-robot-banned-books-ar.san-jose-sta-2217.chatgpt.site
- Public GitHub Pages build: https://crashpr0.github.io/Banned-Book-Week/

## Run it

```bash
npm install
npm run generate:qrcodes
npm run check:qrcodes
npm run dev
```

Open the printed local URL. Camera access works on `localhost`; a phone build must be served over HTTPS. “Preview without a camera” exercises the result state without camera access. Deep-link a title with `?book=i-robot`.

Printable sticker sheet: open `/print-qrcodes.html` after generating codes.

```bash
npm run build
```

The static production build is written to `dist/`.

## Content and cover ingestion

The app never contacts a catalog, publisher, or cover service at runtime. It reads only same-origin files from `public/data/` and `public/assets/`.

`npm run scrape` refreshes the pinned *I, Robot* display image from Penguin Random House’s documented ISBN cover endpoint. The script allowlists the host, limits response size and time, validates JPEG bytes, and hashes the result. Display covers no longer need MindAR recompilation.

To refresh the four candidate-edition files and generate `public/data/books.json`:

```bash
npm run setup:candidates
npm run generate:qrcodes
```

Then print or reprint the QR sticker sheet.

To refresh metadata from a catalog page saved manually as HTML:

```bash
npm run scrape -- --source-html /absolute/path/to/record.html
```

The parser reads the page’s `Book` JSON-LD and fails closed unless it finds the expected ISBN. Live SJPL fetching is intentionally permission-gated because BiblioCommons terms restrict automated harvesting:

```bash
npm run scrape -- --live-sjpl --authorized
```

Use that option only after the project owner has documented permission. It fetches one anonymous record; do not schedule or batch it.

## Regenerate QR targets

After adding or renaming a book id:

```bash
npm run generate:qrcodes
npm run check:qrcodes
```

Each book gets a PNG under `public/assets/qrcodes/` whose payload is `bbw:` plus the book id. The scanner also accepts deep-link URLs that include `?book=` plus the id.

See [docs/AR_LOGIC.md](docs/AR_LOGIC.md) for the state machine, data flow, and the path to more books.

## Production checks

- Print high-contrast QR stickers; keep them flat, glare-free, and large enough for handheld scanning.
- Confirm cover reproduction rights before public launch. The repository records provenance, not a license grant.
- Keep Vite, jsQR, and the QR encoder pinned. Update them deliberately and re-test iOS Safari and Android Chrome.
- Camera video is processed in the browser and is not uploaded by this app.
