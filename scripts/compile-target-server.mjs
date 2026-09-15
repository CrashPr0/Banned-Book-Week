import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targetPath = resolve(root, "public/assets/banned-books.mind");
const dataPath = resolve(root, "public/data/books.json");
const port = Number(process.env.BB_AR_COMPILER_PORT || 4174);
const host = "127.0.0.1";

function localAssetPath(path) {
  if (!path.startsWith("./assets/")) throw new Error(`Unsafe cover path: ${path}`);
  return resolve(root, `public/${path.slice(2)}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

const compilerPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Compile Banned Books AR targets</title>
    <style>
      body { min-height: 100vh; display: grid; place-items: center; margin: 0; color: #f4f0e7; background: #080808; font: 16px system-ui; }
      main { width: min(620px, calc(100% - 40px)); }
      p, li { color: #aaa69d; line-height: 1.5; }
      progress { width: 100%; height: 16px; accent-color: #ed3d31; }
      code { color: #ed3d31; }
    </style>
  </head>
  <body>
    <main>
      <p>MULTI-TARGET COMPILER</p>
      <h1>Banned Books AR</h1>
      <ol id="targets"></ol>
      <progress id="progress" max="100" value="0"></progress>
      <p id="status">Loading the five local covers…</p>
    </main>
    <script type="module">
      const status = document.querySelector('#status');
      const progress = document.querySelector('#progress');
      const list = document.querySelector('#targets');
      const run = async () => {
        try {
          const manifest = await fetch('/manifest').then((response) => response.json());
          list.innerHTML = manifest.books.map((book) => '<li>Target ' + String(book.targetIndex + 1).padStart(2, '0') + ' — ' + book.title + '</li>').join('');
          await import('https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js');
          const images = await Promise.all(manifest.books.map(async (book) => {
            const image = new Image();
            image.src = '/cover/' + book.targetIndex;
            await image.decode();
            return image;
          }));
          const compiler = new window.MINDAR.IMAGE.Compiler();
          status.textContent = 'Extracting image features…';
          await compiler.compileImageTargets(images, (value) => {
            progress.value = Math.round(value);
            status.textContent = 'Extracting image features… ' + Math.round(value) + '%';
          });
          const buffer = await compiler.exportData();
          const response = await fetch('/target', { method: 'POST', body: buffer });
          if (!response.ok) throw new Error(await response.text());
          progress.value = 100;
          status.innerHTML = 'Done. <code>public/assets/banned-books.mind</code> contains all five covers.';
        } catch (error) {
          status.textContent = 'Compilation failed: ' + error.message;
          status.style.color = '#ff6b5f';
        }
      };
      run();
    </script>
  </body>
</html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    const manifest = JSON.parse(await readFile(dataPath, "utf8"));
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(compilerPage);
      return;
    }
    if (request.method === "GET" && url.pathname === "/manifest") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ books: manifest.books.map(({ targetIndex, title }) => ({ targetIndex, title })) }));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/cover/")) {
      const targetIndex = Number(url.pathname.slice("/cover/".length));
      const book = manifest.books.find((entry) => entry.targetIndex === targetIndex);
      if (!book) throw new Error(`Unknown target index ${targetIndex}.`);
      const cover = await readFile(localAssetPath(book.coverPath));
      response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      response.end(cover);
      return;
    }
    if (request.method === "POST" && url.pathname === "/target") {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 80_000_000) throw new Error("Compiled target exceeded 80 MB.");
        chunks.push(chunk);
      }
      const target = Buffer.concat(chunks);
      if (target.length < 1024) throw new Error("Compiler returned an unexpectedly small target.");

      const compiledAt = new Date().toISOString();
      for (const book of manifest.books) {
        const cover = await readFile(localAssetPath(book.coverPath));
        const coverHash = sha256(cover);
        if (book.provenance?.coverSha256 !== coverHash) {
          throw new Error(`${book.title} changed after the manifest was generated.`);
        }
        book.provenance = {
          ...book.provenance,
          targetCoverSha256: coverHash,
          targetCompiledAt: compiledAt,
          targetCompiler: "MindAR 1.2.5",
        };
      }

      await atomicWrite(targetPath, target);
      await atomicWrite(dataPath, `${JSON.stringify(manifest, null, 2)}\n`);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Multi-target pack saved.");
      console.log(`Saved ${target.length} bytes and ${manifest.books.length} targets to public/assets/banned-books.mind`);
      setTimeout(() => server.close(), 300);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found.");
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message);
    console.error(error);
  }
});

server.listen(port, host, () => {
  console.log(`Open http://${host}:${port} to compile all book covers.`);
});
