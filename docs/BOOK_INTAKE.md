# Next-book intake

The installation location/media sheet is normalized in `public/data/books-next.json` (**17 titles**). Active MindAR recognition targets are in `public/data/books.json` (**18 covers** compiled into `banned-books.mind`: 17 sheet titles + *I, Robot*).

## Data split

| File | Role |
| --- | --- |
| `public/data/books-next.json` | Full library placement catalog: slug, floor, call number, landmark, cover/author candidate URLs, intake status |
| `public/data/books.json` | Compiled AR targets only (`targetIndex` contiguous, local `coverPath`, MindAR pack) |

Do not append a book to `books.json` until its physical cover is approved and compiled. Extra manifest entries without matching `mindar-image-target` anchors will fail the runtime preflight.

## Catalog snapshot (2026-09-21)

Corrected titles/authors from the sheet: *Adventures of Huckleberry Finn*, *Ulysses*, Galileo **Galilei**, *Emile* / Rousseau, *Noli Me Tangere* (“Cancer, Touch Me Not”), Writings of **Mengzi** (Mencius), *The Satanic Verses*, **Chairil Anwar**.

New vs prior photo transcription: **Harry Potter** (third floor with Huck). Updated placements include KF 135 .P2 P33 (Earth of Mankind / Satanic Verses), PL2919 .S58x (Anwar), TJ216 (All Quiet), and Q 172.5 / restrooms (Galileo).

Linked intake ↔ AR targets: `huckleberry-finn`, `merchant-of-venice`, `this-earth-of-mankind`, `all-quiet-western-front` (covers swapped to intake-sheet editions and recompiled).

## Fastest next batch

1. *This Earth of Mankind* — already an AR candidate; confirm KF 135 .P2 P33 copy.
2. *The Satanic Verses* — distinctive cover candidate; same vault.
3. *All Quiet on the Western Front* — already an AR candidate; confirm TJ216 copy.
4. *Adventures of Huckleberry Finn* — already an AR candidate; confirm Fiction TY–WA copy vs BookOutlet intake cover.
5. *Harry Potter* — new placement with Huck; confirm exact volume/edition.

## Fragile / incomplete media

- Hotlinked: BookOutlet, Bookshop.org, Goodreads/Amazon CDN covers (Huck, Harry Potter, Earth of Mankind intake cover, Chairil Anwar).
- Fair-use / rights review: English Wikipedia *Satanic Verses* cover; J. K. Rowling Commons portrait.
- Sacred texts: Qur’an and Bible need translator/edition confirmation; no separate “author” for the Qur’an.
- Rizal: intake linked an execution painting; catalog stores a standard portrait as `authorImageUrl`.

Mirror remote images under `public/assets/` before relying on them in production UI:

```bash
npm run mirror:intake
```

That writes covers to `public/assets/intake/covers/` and author images to `public/assets/intake/authors/`, and records `localCoverPath` / `localAuthorPath` on each intake row.

### Cover match notes

Intake sheet is source of truth. The four former edition mismatches were swapped into `books.json` / `public/assets/covers/` and need a MindAR recompile (`npm run compile:target`).

| Book | Status | Live AR cover now |
| --- | --- | --- |
| Huckleberry Finn | swapped-to-intake | Bantam Classic ISBN 9780553210798 |
| Merchant of Venice | swapped-to-intake | Historical Commons title page (Look and Learn was 403) |
| This Earth of Mankind | swapped-to-intake | Hasta Mitra *Bumi Manusia* intake cover |
| All Quiet… | swapped-to-intake | 1929 German first-edition jacket |
| Harry Potter | matched-intake | Scholastic *Sorcerer's Stone* — next promote candidate |
| Satanic Verses | matched-intake | 1988 navy/red — next promote candidate after rights review |

## Per-book production checklist

- Confirm title, author/translator, ISBN, and SJSU King Library OneSearch record against the physical copy.
- Take a glare-free, straight-on cover photo at high resolution.
- Compare any publisher/catalog image pixel-for-pixel by eye; prefer the physical photo when jackets, stickers, or library binding differ.
- Write a short display summary and challenge/banning context with cited sources.
- Compile all approved covers together and map each target index to its book manifest.
- Add a matching `mindar-image-target` in `index.html` for each new `targetIndex`.
- Test recognition on the actual installed copy before publishing.
