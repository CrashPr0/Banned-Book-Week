import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_PATH = resolve(ROOT, "public/data/book.json");
const COVER_PATH = resolve(ROOT, "public/assets/i-robot-cover.jpg");
const RECORD_ID = "S156C6635382";
const EXPECTED_ISBN = "9780553382563";
const RECORD_URL = `https://sjpl.bibliocommons.com/v2/record/${RECORD_ID}`;
const PUBLISHER_COVER_URL = `https://images.penguinrandomhouse.com/cover/${EXPECTED_ISBN}`;
const USER_AGENT = "BannedBooksARPrototype/0.1 (+local-curation; contact project owner)";

function parseArguments(argv) {
  const args = { authorized: false, liveSjpl: false, sourceHtml: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--authorized") args.authorized = true;
    else if (value === "--live-sjpl") args.liveSjpl = true;
    else if (value === "--source-html") args.sourceHtml = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.liveSjpl && args.sourceHtml) {
    throw new Error("Choose either --source-html or --live-sjpl, not both.");
  }
  if (args.liveSjpl && !args.authorized) {
    throw new Error(
      "Live SJPL importing is disabled by default. BiblioCommons terms restrict automated harvesting. " +
        "Only rerun with --live-sjpl --authorized after the project owner has confirmed permission.",
    );
  }
  return args;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAuthor(author) {
  const value = typeof author === "string" ? author : author?.name;
  if (!value) return null;
  const withoutDates = value.replace(/,?\s*\d{4}(?:-\d{4})?\s*$/, "").trim();
  const parts = withoutDates.split(",").map((part) => part.trim());
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : withoutDates;
}

function parseCatalogHtml(html) {
  const scripts = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      const book = nodes.find((node) => toArray(node?.["@type"]).includes("Book"));
      if (!book) continue;

      const isbn = toArray(book.isbn).map(String);
      if (!isbn.includes(EXPECTED_ISBN)) {
        throw new Error(`Catalog ISBN mismatch; expected ${EXPECTED_ISBN}, received ${isbn.join(", ")}.`);
      }

      return {
        title: book.name,
        authors: toArray(book.author).map(normalizeAuthor).filter(Boolean),
        edition: book.bookEdition,
        isbn,
        sourceDescription: toArray(book.description).filter(Boolean).join("\n\n"),
        catalogCoverUrl: book.image,
      };
    } catch (error) {
      if (String(error.message).includes("ISBN mismatch")) throw error;
    }
  }
  throw new Error("No matching Book JSON-LD record was found in the supplied HTML.");
}

async function fetchBounded(url, { allowedHosts, maxBytes, acceptedTypes }) {
  const requested = new URL(url);
  if (requested.protocol !== "https:" || !allowedHosts.includes(requested.hostname)) {
    throw new Error(`Blocked unapproved URL: ${url}`);
  }

  const response = await fetch(requested, {
    headers: { Accept: acceptedTypes.join(", "), "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${requested.hostname} returned HTTP ${response.status}.`);

  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || !allowedHosts.includes(finalUrl.hostname)) {
    throw new Error(`Redirected to an unapproved host: ${response.url}`);
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes.`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes.`);
  return { bytes, contentType: response.headers.get("content-type") || "", finalUrl: response.url };
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function loadCatalogData(args) {
  if (args.sourceHtml) {
    const sourcePath = resolve(args.sourceHtml);
    const html = await readFile(sourcePath, "utf8");
    if (Buffer.byteLength(html) > 2_000_000) throw new Error("Saved catalog page is larger than 2 MB.");
    return { ...parseCatalogHtml(html), source: `saved HTML: ${basename(sourcePath)}` };
  }

  if (args.liveSjpl) {
    console.warn(
      "Permission gate accepted. Fetching one anonymous catalog record; do not batch or schedule this importer.",
    );
    const response = await fetchBounded(RECORD_URL, {
      allowedHosts: ["sjpl.bibliocommons.com"],
      maxBytes: 2_000_000,
      acceptedTypes: ["text/html"],
    });
    return { ...parseCatalogHtml(response.bytes.toString("utf8")), source: RECORD_URL };
  }

  return null;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const current = JSON.parse(await readFile(DATA_PATH, "utf8"));
  const catalog = await loadCatalogData(args);
  const metadata = catalog ? { ...current, ...catalog } : current;

  if (!metadata.isbn?.includes(EXPECTED_ISBN)) {
    throw new Error(`Manifest no longer matches the approved ISBN ${EXPECTED_ISBN}.`);
  }

  const cover = await fetchBounded(PUBLISHER_COVER_URL, {
    allowedHosts: ["images.penguinrandomhouse.com"],
    maxBytes: 5_000_000,
    acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (!cover.contentType.startsWith("image/")) {
    throw new Error(`Publisher endpoint returned ${cover.contentType || "an unknown type"}, not an image.`);
  }
  if (!(cover.bytes[0] === 0xff && cover.bytes[1] === 0xd8)) {
    throw new Error("Expected the approved publisher JPEG but received different bytes.");
  }

  const coverHash = sha256(cover.bytes);
  const previousHash = current.provenance?.coverSha256 ?? null;
  const coverChanged = Boolean(previousHash && previousHash !== coverHash);
  const targetIsStale = Boolean(metadata.provenance?.targetCoverSha256 !== coverHash);

  const next = {
    ...metadata,
    recordId: RECORD_ID,
    recordUrl: RECORD_URL,
    coverUrl: cover.finalUrl,
    coverPath: "/assets/i-robot-cover.jpg",
    targetPath: "/assets/i-robot.mind",
    retrievedAt: new Date().toISOString(),
    provenance: {
      ...metadata.provenance,
      metadata: catalog ? `SJPL / BiblioCommons JSON-LD (${catalog.source})` : metadata.provenance.metadata,
      cover: "Penguin Random House ISBN cover endpoint; requires visual approval for the physical copy",
      coverSha256: coverHash,
      coverReviewRequired: coverChanged,
      targetStale: targetIsStale,
    },
  };

  await atomicWrite(COVER_PATH, cover.bytes);
  await atomicWrite(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        title: next.title,
        isbn: EXPECTED_ISBN,
        coverSha256: coverHash,
        coverChanged,
        targetIsStale,
        nextStep: coverChanged
          ? "Visually compare the cover with the physical copy, then recompile the .mind target."
          : targetIsStale
            ? "Run npm run compile:target and open the printed local URL."
            : "Cover and target are in sync.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Cover import failed: ${error.message}`);
  process.exitCode = 1;
});
