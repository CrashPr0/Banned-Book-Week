import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "public/data/books.json");
const userAgent = "BannedBooksARPrototype/0.2 (+local-curation; contact project owner)";

function sjsuTitleSearch(title) {
  const safeTitle = String(title).replaceAll(",", " ").replace(/\s+/g, " ").trim();
  const params = new URLSearchParams({
    query: `title,contains,${safeTitle}`,
    tab: "LibraryCatalog",
    search_scope: "MyInstitution",
    vid: "01CALS_SJO:01CALS_SJO",
    offset: "0",
  });
  return `https://csu-sjsu.primo.exlibrisgroup.com/discovery/search?${params.toString()}`;
}

const candidates = [
  {
    id: "huckleberry-finn",
    targetIndex: 1,
    title: "Adventures of Huckleberry Finn",
    authors: ["Mark Twain"],
    edition: "Bantam Classic paperback (intake sheet)",
    publication: "Bantam Classic; ISBN from intake BookOutlet cover",
    isbn: ["9780553210798", "0553210793"],
    recordUrl: null,
    catalogSearchUrl: sjsuTitleSearch("Adventures of Huckleberry Finn"),
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780553210798-L.jpg",
    coverPath: "./assets/covers/huckleberry-finn-9780553210798.jpg",
    displaySummary:
      "Huck Finn escapes an abusive home and travels the Mississippi with Jim, who is fleeing slavery. Their journey exposes the violence, fraud, prejudice, and moral compromises beneath the promise of freedom.",
    arSummary:
      "Huck and Jim travel the Mississippi in search of freedom, confronting the cruelty and hypocrisy of the society around them.",
    challengeNote:
      "Frequently challenged over racist language and racial representation, with debate about historical context and classroom use.",
  },
  {
    id: "merchant-of-venice",
    targetIndex: 2,
    title: "The Merchant of Venice",
    authors: ["William Shakespeare"],
    edition: "Historical title-page candidate (intake Look and Learn / Commons)",
    publication: "Early printed edition title page",
    isbn: [],
    recordUrl: null,
    catalogSearchUrl: sjsuTitleSearch("The Merchant of Venice"),
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/5/52/Merchant_venice_tp.jpg",
    coverPath: "./assets/covers/merchant-of-venice-title-page.jpg",
    displaySummary:
      "A loan made for love turns into a demand for a pound of flesh. Shakespeare's collision of debt, prejudice, revenge, and mercy unfolds in sixteenth-century Venice.",
    arSummary:
      "A dangerous loan brings love, law, prejudice, revenge, and mercy into conflict in sixteenth-century Venice.",
    challengeNote:
      "Often debated or challenged because of antisemitic characterization and questions about how the play should be taught.",
  },
  {
    id: "this-earth-of-mankind",
    targetIndex: 3,
    title: "This Earth of Mankind",
    authors: ["Pramoedya Ananta Toer"],
    edition: "Hasta Mitra Indonesian edition (intake Goodreads cover)",
    publication: "Jakarta : Hasta Mitra",
    isbn: [],
    recordUrl: null,
    catalogSearchUrl: sjsuTitleSearch("This Earth of Mankind"),
    coverUrl:
      "https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1464893084i/6496019.jpg",
    coverPath: "./assets/covers/this-earth-of-mankind-bumi-manusia.jpg",
    displaySummary:
      "In colonial Java, gifted student Minke moves between European schooling and an Indonesian society constrained by race and class. Love and injustice push him toward a new political consciousness.",
    arSummary:
      "In colonial Java, Minke's education and forbidden love awaken him to the racial hierarchy and injustice surrounding him.",
    challengeNote:
      "The novel was suppressed by Indonesia's New Order government along with other works by Pramoedya.",
  },
  {
    id: "all-quiet-western-front",
    targetIndex: 4,
    title: "All Quiet on the Western Front",
    authors: ["Erich Maria Remarque"],
    edition: "1929 German first-edition jacket (intake Commons candidate)",
    publication: "Berlin : Propyläen-Verlag, 1929",
    isbn: [],
    recordUrl: null,
    catalogSearchUrl: sjsuTitleSearch("All Quiet on the Western Front"),
    coverUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c3/Remarque_Im_Westen_nichts_Neues_1929.jpg",
    coverPath: "./assets/covers/all-quiet-western-front-1929.jpg",
    displaySummary:
      "Paul Bäumer and his classmates enlist in the German army during World War I. Trench warfare strips away their patriotic ideals and leaves them struggling to preserve their humanity.",
    arSummary:
      "Young German soldiers enter World War I with patriotic ideals and confront the devastating reality of trench warfare.",
    challengeNote:
      "Banned and burned in Nazi Germany for its unromantic, antiwar portrayal of German soldiers' experience.",
  },
];

function isAllowedHost(hostname) {
  return (
    hostname === "covers.openlibrary.org" ||
    hostname === "images.penguinrandomhouse.com" ||
    hostname === "upload.wikimedia.org" ||
    hostname === "m.media-amazon.com" ||
    hostname.endsWith(".us.archive.org")
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

async function downloadCover(book) {
  const requested = new URL(book.coverUrl);
  if (requested.protocol !== "https:" || !isAllowedHost(requested.hostname)) {
    throw new Error(`Blocked unapproved cover host for ${book.id}.`);
  }
  const response = await fetch(requested, {
    redirect: "follow",
    headers: { Accept: "image/jpeg", "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${book.id} cover returned HTTP ${response.status}.`);
  const finalUrl = new URL(response.url);
  if (!isAllowedHost(finalUrl.hostname)) throw new Error(`${book.id} redirected to an unapproved host.`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 5_000_000) throw new Error(`${book.id} cover exceeds 5 MB.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error(`${book.id} cover exceeds 5 MB.`);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error(`${book.id} did not return JPEG bytes.`);
  await atomicWrite(resolve(root, `public/${book.coverPath.replace(/^\.\//, "")}`), bytes);
  return {
    ...book,
    coverUrl: response.url,
    targetPath: "./assets/banned-books.mind",
    coverStatus: "candidate",
    provenance: {
      metadata: "Curated from SJSU King Library placement intake and publisher/Open Library edition data",
      cover: `${finalUrl.hostname} ISBN cover endpoint`,
      coverSha256: sha256(bytes),
      physicalEditionReviewed: false,
      targetCoverSha256: null,
      targetCompiledAt: null,
      targetCompiler: null,
    },
  };
}

async function main() {
  const iRobot = JSON.parse(await readFile(resolve(root, "public/data/book.json"), "utf8"));
  const approved = {
    ...iRobot,
    id: "i-robot",
    targetIndex: 0,
    coverPath: "./assets/i-robot-cover.jpg",
    targetPath: "./assets/banned-books.mind",
    coverStatus: "approved",
    catalogSearchUrl: iRobot.recordUrl,
    challengeNote: "Frequently challenged in discussions about science fiction, technology, and the boundaries of human agency.",
    provenance: {
      ...iRobot.provenance,
      physicalEditionReviewed: true,
      targetCoverSha256: null,
      targetCompiledAt: null,
      targetCompiler: null,
    },
  };

  const downloaded = [];
  for (const candidate of candidates) downloaded.push(await downloadCover(candidate));
  const manifest = {
    version: 1,
    targetPath: "./assets/banned-books.mind",
    generatedAt: new Date().toISOString(),
    books: [approved, ...downloaded],
  };
  await atomicWrite(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        output: "public/data/books.json",
        books: manifest.books.map(({ targetIndex, id, title, coverStatus, coverPath }) => ({
          targetIndex,
          id,
          title,
          coverStatus,
          coverPath,
        })),
        nextStep: "Visually compare candidate covers with physical copies, then run npm run compile:target.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Candidate setup failed: ${error.message}`);
  process.exitCode = 1;
});
