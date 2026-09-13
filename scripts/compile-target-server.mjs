import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const coverPath = resolve(root, "public/assets/i-robot-cover.jpg");
const targetPath = resolve(root, "public/assets/i-robot.mind");
const dataPath = resolve(root, "public/data/book.json");
const port = Number(process.env.BB_AR_COMPILER_PORT || 4174);
const host = "127.0.0.1";

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
    <title>Compile I, Robot target</title>
    <style>
      body { min-height: 100vh; display: grid; place-items: center; margin: 0; color: #f4f0e7; background: #080808; font: 16px system-ui; }
      main { width: min(520px, calc(100% - 40px)); }
      p { color: #aaa69d; line-height: 1.5; }
      progress { width: 100%; height: 16px; accent-color: #ed3d31; }
      code { color: #ed3d31; }
    </style>
  </head>
  <body>
    <main>
      <p>COMPILING TARGET 01</p>
      <h1>I, Robot</h1>
      <progress id="progress" max="100" value="0"></progress>
      <p id="status">Loading the pinned cover…</p>
    </main>
    <script type="module">
      const status = document.querySelector('#status');
      const progress = document.querySelector('#progress');
      const run = async () => {
        try {
          await import('https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js');
          const image = new Image();
          image.src = '/cover.jpg';
          await image.decode();
          const compiler = new window.MINDAR.IMAGE.Compiler();
          status.textContent = 'Extracting image features…';
          await compiler.compileImageTargets([image], (value) => {
            progress.value = Math.round(value);
            status.textContent = 'Extracting image features… ' + Math.round(value) + '%';
          });
          const buffer = await compiler.exportData();
          const response = await fetch('/target', { method: 'POST', body: buffer });
          if (!response.ok) throw new Error(await response.text());
          progress.value = 100;
          status.innerHTML = 'Done. <code>public/assets/i-robot.mind</code> is synced to this cover.';
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
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(compilerPage);
      return;
    }
    if (request.method === "GET" && url.pathname === "/cover.jpg") {
      const cover = await readFile(coverPath);
      response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      response.end(cover);
      return;
    }
    if (request.method === "POST" && url.pathname === "/target") {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 20_000_000) throw new Error("Compiled target exceeded 20 MB.");
        chunks.push(chunk);
      }
      const target = Buffer.concat(chunks);
      if (target.length < 1024) throw new Error("Compiler returned an unexpectedly small target.");

      const cover = await readFile(coverPath);
      const coverHash = createHash("sha256").update(cover).digest("hex");
      const manifest = JSON.parse(await readFile(dataPath, "utf8"));
      manifest.provenance = {
        ...manifest.provenance,
        coverSha256: coverHash,
        coverReviewRequired: false,
        targetCoverSha256: coverHash,
        targetCompiledAt: new Date().toISOString(),
        targetStale: false,
        targetCompiler: "MindAR 1.2.5",
      };

      await atomicWrite(targetPath, target);
      await atomicWrite(dataPath, `${JSON.stringify(manifest, null, 2)}\n`);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Target saved.");
      console.log(`Saved ${target.length} bytes to public/assets/i-robot.mind`);
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
  console.log(`Open http://${host}:${port} to compile the pinned cover.`);
});
