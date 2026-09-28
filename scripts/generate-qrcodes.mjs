import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";

const root = resolve(import.meta.dirname, "..");
const dataPath = resolve(root, "public/data/books.json");
const qrDir = resolve(root, "public/assets/qrcodes");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function qrPayloadFor(book) {
  return `bbw:${book.id}`;
}

function qrPathFor(book) {
  return `./assets/qrcodes/${book.id}.png`;
}

async function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

const manifest = JSON.parse(await readFile(dataPath, "utf8"));
await mkdir(qrDir, { recursive: true });

const generatedAt = new Date().toISOString();
const results = [];

for (const book of manifest.books) {
  if (book.targetIndex !== results.length) {
    throw new Error(`Target indexes must be contiguous; check ${book.title}.`);
  }

  const qrPayload = qrPayloadFor(book);
  const qrPath = qrPathFor(book);
  const absoluteQrPath = resolve(root, `public/${qrPath.slice(2)}`);
  const png = await QRCode.toBuffer(qrPayload, {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 2,
    width: 1024,
    color: {
      dark: "#070707",
      light: "#ffffff",
    },
  });
  const hash = sha256(png);
  await atomicWrite(absoluteQrPath, png);

  book.qrPayload = qrPayload;
  book.qrPath = qrPath;
  delete book.targetPath;
  const {
    targetCoverSha256: _targetCoverSha256,
    targetCompiledAt: _targetCompiledAt,
    targetCompiler: _targetCompiler,
    targetStale: _targetStale,
    ...keptProvenance
  } = book.provenance ?? {};
  book.provenance = {
    ...keptProvenance,
    qrSha256: hash,
    qrGeneratedAt: generatedAt,
    qrEncoder: "qrcode (npm)",
  };

  results.push({
    targetIndex: book.targetIndex,
    id: book.id,
    title: book.title,
    qrPayload,
    qrPath,
    qrSha256: hash,
  });
}

manifest.version = 2;
delete manifest.targetPath;
manifest.qrGeneratedAt = generatedAt;
manifest.generatedAt = generatedAt;

await atomicWrite(dataPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      status: "generated",
      count: results.length,
      qrGeneratedAt: generatedAt,
      codes: results,
    },
    null,
    2,
  ),
);
