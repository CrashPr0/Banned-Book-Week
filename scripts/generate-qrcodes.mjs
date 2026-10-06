import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";

const root = resolve(import.meta.dirname, "..");
const intakePath = resolve(root, "public/data/books-next.json");
const qrDir = resolve(root, "public/assets/qrcodes");
const printPath = resolve(root, "public/print-qrcodes.html");
const publicOrigin = "https://crashpr0.github.io/Banned-Book-Week/";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const intake = JSON.parse(await readFile(intakePath, "utf8"));
const books = intake.books;
if (!Array.isArray(books) || books.length === 0) {
  throw new Error("books-next.json has no books.");
}

await mkdir(qrDir, { recursive: true });

const stickers = [];
for (const book of books) {
  if (!book.id || !book.title) throw new Error("Each intake book needs an id and title.");
  const payload = new URL(publicOrigin);
  payload.searchParams.set("book", book.id);
  const png = await QRCode.toBuffer(payload.toString(), {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 2,
    width: 1024,
    color: { dark: "#070707", light: "#ffffff" },
  });
  const fileName = `${book.id}.png`;
  await writeFile(resolve(qrDir, fileName), png);
  stickers.push({
    id: book.id,
    title: book.title,
    author: book.author,
    floor: book.floor,
    callNumber: book.callNumber,
    fileName,
    payload: payload.toString(),
  });
}

const cards = stickers
  .map((sticker, index) => {
    const place = [sticker.floor, sticker.callNumber].filter(Boolean).join(" · ");
    const author = sticker.author ? `<p class="author">${escapeHtml(sticker.author)}</p>` : "";
    return `    <article>
      <img src="./assets/qrcodes/${escapeHtml(sticker.fileName)}" alt="QR code for ${escapeHtml(sticker.title)}" />
      <p class="index">${String(index + 1).padStart(2, "0")}</p>
      <h2>${escapeHtml(sticker.title)}</h2>
      ${author}
      <p class="place">${escapeHtml(place)}</p>
    </article>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Underground books QR stickers</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 24px; font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      .note { margin: 0 0 24px; max-width: 42rem; }
      .sheet { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      article { border: 1px solid #111; padding: 12px; break-inside: avoid; text-align: center; }
      img { width: min(100%, 220px); height: auto; }
      .index { margin: 8px 0 0; font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 0.08em; }
      h2 { font-size: 16px; margin: 4px 0; }
      .author, .place { margin: 0; font-size: 13px; }
      .place { margin-top: 4px; }
      @media print {
        body { margin: 0.4in; }
        .note { display: none; }
        .sheet { gap: 10px; }
      }
    </style>
  </head>
  <body>
    <h1>Underground books QR stickers</h1>
    <p class="note">Print these and place one with each copy. Scan a code to open the AR scanner for that title, then allow camera access.</p>
    <div class="sheet">
${cards}
    </div>
  </body>
</html>
`;

await writeFile(printPath, html);
console.log(JSON.stringify({ count: stickers.length, codes: stickers.map(({ id, title, payload }) => ({ id, title, payload })) }, null, 2));
