import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "public/data/books.json"), "utf8"));
const targetFile = resolve(root, `public/${manifest.targetPath.replace(/^\.\//, "")}`);

let targetStats;
try {
  targetStats = await stat(targetFile);
} catch {
  throw new Error(`Missing ${manifest.targetPath}; run npm run compile:target.`);
}
if (targetStats.size < 1024) throw new Error(`${manifest.targetPath} is too small to be a valid MindAR target.`);

const results = [];
for (const book of manifest.books) {
  if (book.targetIndex !== results.length) throw new Error(`Target indexes must be contiguous; check ${book.title}.`);
  const coverPath = resolve(root, `public/${book.coverPath.replace(/^\.\//, "")}`);
  const cover = await readFile(coverPath);
  const coverHash = createHash("sha256").update(cover).digest("hex");
  if (book.provenance?.coverSha256 !== coverHash) throw new Error(`${book.title} cover differs from its manifest hash.`);
  if (book.provenance?.targetCoverSha256 !== coverHash) {
    throw new Error(`${book.title} changed after target compilation. Run npm run compile:target.`);
  }
  results.push({
    targetIndex: book.targetIndex,
    title: book.title,
    coverStatus: book.coverStatus,
    physicalEditionReviewed: Boolean(book.provenance?.physicalEditionReviewed),
  });
}

console.log(
  JSON.stringify(
    {
      target: manifest.targetPath,
      bytes: targetStats.size,
      targets: results,
      compiledAt: manifest.books[0]?.provenance?.targetCompiledAt,
      status: "fresh",
      warning: results.some((book) => !book.physicalEditionReviewed)
        ? "Candidate covers are compiled but still require physical-edition comparison."
        : null,
    },
    null,
    2,
  ),
);
