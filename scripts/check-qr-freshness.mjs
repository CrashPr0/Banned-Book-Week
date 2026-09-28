import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "public/data/books.json"), "utf8"));

const results = [];
for (const book of manifest.books) {
  if (book.targetIndex !== results.length) {
    throw new Error(`Target indexes must be contiguous; check ${book.title}.`);
  }
  if (!book.qrPayload || !book.qrPath) {
    throw new Error(`${book.title} is missing qrPayload/qrPath. Run npm run generate:qrcodes.`);
  }
  if (book.qrPayload !== `bbw:${book.id}`) {
    throw new Error(`${book.title} qrPayload must be bbw:${book.id}.`);
  }

  const qrFile = resolve(root, `public/${book.qrPath.replace(/^\.\//, "")}`);
  let qrStats;
  try {
    qrStats = await stat(qrFile);
  } catch {
    throw new Error(`Missing ${book.qrPath}; run npm run generate:qrcodes.`);
  }
  if (qrStats.size < 256) throw new Error(`${book.qrPath} is too small to be a valid QR image.`);

  const png = await readFile(qrFile);
  const hash = createHash("sha256").update(png).digest("hex");
  if (book.provenance?.qrSha256 !== hash) {
    throw new Error(`${book.title} QR image differs from its manifest hash. Run npm run generate:qrcodes.`);
  }

  results.push({
    targetIndex: book.targetIndex,
    id: book.id,
    title: book.title,
    qrPayload: book.qrPayload,
    coverStatus: book.coverStatus,
    bytes: qrStats.size,
  });
}

console.log(
  JSON.stringify(
    {
      mode: "qr",
      count: results.length,
      codes: results,
      generatedAt: manifest.qrGeneratedAt ?? manifest.books[0]?.provenance?.qrGeneratedAt,
      status: "fresh",
    },
    null,
    2,
  ),
);
