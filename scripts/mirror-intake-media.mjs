import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const catalogPath = resolve(root, "public/data/books-next.json");
const userAgent = "BannedBooksARPrototype/0.2 (+local-mirror; contact project owner)";

/** Prefer durable hosts when the intake sheet only had a page URL or a fragile CDN. */
const FALLBACKS = {
  "huckleberry-finn": {
    cover: ["https://covers.openlibrary.org/b/isbn/9780553210798-L.jpg"],
  },
  "harry-potter": {
    cover: ["https://covers.openlibrary.org/b/isbn/9781338878929-L.jpg"],
  },
  "merchant-of-venice": {
    cover: ["https://upload.wikimedia.org/wikipedia/commons/5/52/Merchant_venice_tp.jpg"],
  },
  "this-earth-of-mankind": {
    cover: [
      "https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1464893084i/6496019.jpg",
    ],
  },
  "satanic-verses": {
    cover: ["https://covers.openlibrary.org/b/id/8312209-L.jpg"],
  },
  "two-new-sciences": {
    cover: ["https://covers.openlibrary.org/b/id/10817653-L.jpg"],
  },
  candide: {
    cover: ["https://covers.openlibrary.org/b/id/12736044-L.jpg"],
    authorFile: "File:Voltaire.jpg",
  },
  "origin-of-species": {
    authorFile: "File:Charles Darwin by Julia Margaret Cameron, c. 1868.jpg",
  },
  "holy-bible": {
    authorThumb:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/William_Tyndale_Victoria_Embankment_Gardens.jpg/1280px-William_Tyndale_Victoria_Embankment_Gardens.jpg",
  },
};

function sniffExt(bytes, contentType, url) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return ".gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return ".webp";
  }
  if ((contentType || "").includes("jpeg")) return ".jpg";
  if ((contentType || "").includes("png")) return ".png";
  if ((contentType || "").includes("webp")) return ".webp";
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fromUrl)) {
    return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  }
  return ".bin";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

async function commonsThumb(fileTitle, width = 800) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("titles", fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`);
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "url");
  api.searchParams.set("iiurlwidth", String(width));
  api.searchParams.set("format", "json");
  const response = await fetch(api, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Commons API HTTP ${response.status}`);
  const data = await response.json();
  const page = Object.values(data.query.pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) throw new Error(`no imageinfo for ${fileTitle}`);
  return info.thumburl || info.url;
}

async function fetchImage(url, { maxBytes = 8_000_000 } = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "image/*,*/*;q=0.8", "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) throw new Error("too small");
  if (bytes.length > maxBytes) throw new Error("too large");
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) throw new Error("got HTML not image");
  const ext = sniffExt(bytes, contentType, response.url);
  if (ext === ".bin") throw new Error("unknown image bytes");
  return {
    bytes,
    ext,
    finalUrl: response.url,
    sha256: sha256(bytes),
  };
}

async function downloadFirst(urls, options) {
  const tried = [];
  for (const url of urls.filter(Boolean)) {
    await sleep(400);
    tried.push(url);
    try {
      const result = await fetchImage(url, options);
      return { ...result, sourceUrl: url, tried };
    } catch (error) {
      tried[tried.length - 1] = `${url} (${error.message})`;
    }
  }
  throw new Error(tried.join(" | "));
}

async function mirrorBook(book) {
  const fallback = FALLBACKS[book.id] || {};
  const result = { id: book.id, cover: null, author: null, errors: [] };

  if (book.coverImageUrl || fallback.cover?.length) {
    try {
      let img = await downloadFirst([book.coverImageUrl, ...(fallback.cover || [])]);
      if (img.ext === ".gif" && fallback.cover?.length) {
        const jpeg = await downloadFirst(fallback.cover).catch(() => null);
        if (jpeg?.ext === ".jpg") img = jpeg;
      }
      const ext = img.ext === ".jpeg" ? ".jpg" : img.ext;
      const pathRel = `./assets/intake/covers/${book.id}${ext}`;
      await atomicWrite(resolve(root, `public/${pathRel.slice(2)}`), img.bytes);
      book.localCoverPath = pathRel;
      book.coverSha256 = img.sha256;
      book.coverFetchedFrom = img.finalUrl;
      result.cover = pathRel;
    } catch (error) {
      result.errors.push(`cover: ${error.message}`);
    }
  }

  if (book.authorImageUrl || fallback.authorFile || fallback.authorThumb) {
    try {
      const urls = [book.authorImageUrl, fallback.authorThumb];
      if (fallback.authorFile) urls.push(await commonsThumb(fallback.authorFile));
      const img = await downloadFirst(urls, { maxBytes: 12_000_000 });
      const pathRel = `./assets/intake/authors/${book.id}${img.ext}`;
      await atomicWrite(resolve(root, `public/${pathRel.slice(2)}`), img.bytes);
      book.localAuthorPath = pathRel;
      book.authorSha256 = img.sha256;
      book.authorFetchedFrom = img.finalUrl;
      result.author = pathRel;
    } catch (error) {
      result.errors.push(`author: ${error.message}`);
    }
  }

  return result;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const report = [];
  for (const book of catalog.books) {
    const entry = await mirrorBook(book);
    report.push(entry);
    const needsAuthor = Boolean(
      book.authorImageUrl || FALLBACKS[book.id]?.authorFile || FALLBACKS[book.id]?.authorThumb,
    );
    console.log(
      `${book.id}: cover=${entry.cover ? "ok" : "FAIL"} author=${
        needsAuthor ? (entry.author ? "ok" : "FAIL") : "n/a"
      }${entry.errors.length ? ` ${entry.errors.join("; ")}` : ""}`,
    );
  }
  catalog.mirroredAt = new Date().toISOString();
  catalog.schema = {
    ...catalog.schema,
    localCoverPath: "mirrored cover under public/assets/intake/covers/",
    localAuthorPath: "mirrored author image under public/assets/intake/authors/",
  };
  await atomicWrite(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        mirroredAt: catalog.mirroredAt,
        books: report,
        nextStep: "Visually compare localCoverPath with the physical library copy before compile:target.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Intake media mirror failed: ${error.message}`);
  process.exitCode = 1;
});
