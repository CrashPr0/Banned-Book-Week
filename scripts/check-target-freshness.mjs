import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "public/data/book.json"), "utf8"));
const cover = await readFile(resolve(root, `public${manifest.coverPath}`));
const coverHash = createHash("sha256").update(cover).digest("hex");
const targetFile = resolve(root, `public${manifest.targetPath}`);

let targetStats;
try {
  targetStats = await stat(targetFile);
} catch {
  throw new Error(`Missing ${manifest.targetPath}; run npm run compile:target.`);
}

if (targetStats.size < 1024) throw new Error(`${manifest.targetPath} is too small to be a valid MindAR target.`);
if (manifest.provenance?.targetCoverSha256 !== coverHash) {
  throw new Error("The cover bytes changed after target compilation. Review the cover and recompile the target.");
}
if (manifest.provenance?.coverReviewRequired) {
  throw new Error("The imported cover is still marked as requiring visual review.");
}

console.log(
  JSON.stringify(
    {
      target: manifest.targetPath,
      bytes: targetStats.size,
      coverSha256: coverHash,
      compiledAt: manifest.provenance.targetCompiledAt,
      status: "fresh",
    },
    null,
    2,
  ),
);
