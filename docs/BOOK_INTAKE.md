# Next-book intake

The photographed installation plan contains 16 books beyond *I, Robot*. A normalized, machine-readable queue lives in `public/data/books-next.json`.

## Fastest next batch

1. *This Earth of Mankind* — publisher ISBN and cover candidate found.
2. *The Satanic Verses* — visually distinctive cover candidates are available.
3. *All Quiet on the Western Front* — an SJPL Ballantine record was found.
4. *Adventures of Huckleberry Finn* — an SJPL record was found.
5. *The Merchant of Venice* — SJPL carries several print editions.

These remain discovery candidates for edition metadata and display artwork. Recognition no longer depends on matching jacket photography: each title needs a stable `id`, a regenerated `bbw:` QR sticker, and a short summary.

## Per-book production checklist

- Confirm title, author/translator, ISBN, and SJPL record against the physical copy.
- Store a glare-free display cover for the result UI (optional physical photo preferred when jackets differ).
- Write a short display summary and challenge/banning context with cited sources.
- Assign the next contiguous `targetIndex` and a kebab-case `id`.
- Run `npm run generate:qrcodes` and print the sticker from `/print-qrcodes.html`.
- Test scanning the printed sticker before publishing.

The call numbers containing `?` are uncertain transcriptions from the photographed sheet and should be checked on site.
