// Run with playwright-cli run-code --filename=scripts/test-scanner-browser.js.
// This feeds real images to MindAR and jsQR, without faking recognition events.
async page => {
  const appUrl = await page.evaluate(() => location.href.startsWith("http")
    ? new URL(".", location.href).href : "http://127.0.0.1:4175/");
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);

  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 960;
    const context = canvas.getContext("2d");
    let image = null;
    let timer = 0;
    const draw = () => {
      context.fillStyle = "#ddd";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!image) return;
      const ratio = Math.min(480 / image.width, 700 / image.height);
      const width = image.width * ratio;
      const height = image.height * ratio;
      context.drawImage(image, (640 - width) / 2, (960 - height) / 2, width, height);
    };
    window.scannerTestCamera = {
      async show(path) {
        if (!path) { image = null; draw(); return; }
        const next = new Image();
        next.src = path;
        await next.decode();
        image = next;
        draw();
      },
    };
    navigator.mediaDevices.getUserMedia = async () => {
      clearInterval(timer);
      await window.scannerTestCamera.show("./assets/i-robot-cover.jpg");
      timer = setInterval(draw, 1000 / 30);
      return canvas.captureStream(30);
    };
  });

  const expectCover = async (id, path) => {
    if (path) await page.evaluate((src) => window.scannerTestCamera.show(src), path);
    await page.waitForFunction((bookId) => {
      const content = document.querySelector("#book-content");
      const asset = document.querySelector(`#cover-${bookId}`);
      const cover = document.querySelector("#ar-cover");
      return document.body.dataset.recognitionSource === "cover"
        && document.body.dataset.phase === "tracked"
        && cover.getAttribute("src") === `#cover-${bookId}`
        && cover.getObject3D("mesh")?.material.map?.image?.src === asset.src
        && content.object3D.visible && content.object3D.scale.x >= 0.99;
    }, id, { timeout: 20000 });
  };

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appUrl);
    await page.getByRole("button", { name: "START THE AR SCANNER" }).click();
    await expectCover("i-robot");
    await page.evaluate(() => {
      window.originalCoverGeometry = document.querySelector("#ar-cover").getObject3D("mesh").geometry;
      window.originalCoverAnimation = document.querySelector("#book-content").components.animation__reveal;
    });

    await expectCover("huckleberry-finn", "./assets/covers/huckleberry-finn-9780553210798.jpg");
    const stableComponents = await page.evaluate(() => {
      const content = document.querySelector("#book-content");
      return content.parentElement.id === "ar-scene"
        && content.object3D.parent.el.dataset.targetIndex === "1"
        && window.originalCoverGeometry === document.querySelector("#ar-cover").getObject3D("mesh").geometry
        && window.originalCoverAnimation === content.components.animation__reveal;
    });
    if (!stableComponents) throw new Error("Switching covers rebuilt the AR components or selected the wrong anchor.");

    await page.evaluate(() => window.scannerTestCamera.show("./assets/qrcodes/candide.png"));
    await page.waitForFunction(() => document.body.dataset.recognitionSource === "qr"
      && document.querySelector("#result-title").textContent === "Candide"
      && getComputedStyle(document.querySelector("#demo-card")).display === "block");

    await expectCover("merchant-of-venice", "./assets/covers/merchant-of-venice-title-page.jpg");
    const startRotation = await page.evaluate(() => document.querySelector("#ar-book").object3D.rotation.y);
    await page.waitForFunction((previous) => document.querySelector("#ar-book").object3D.rotation.y !== previous, startRotation);

    await page.evaluate(() => window.scannerTestCamera.show(null));
    await page.waitForFunction(() => !document.querySelector("#book-content").object3D.visible);
    await page.getByRole("button", { name: "Stop camera" }).click();
    await page.waitForFunction(() => document.body.dataset.phase === "intro" && !document.querySelector("video"));
    await page.getByRole("button", { name: "START THE AR SCANNER" }).click();
    await expectCover("i-robot");
    await page.getByRole("button", { name: "Stop camera" }).click();

    await page.goto(`${appUrl}?book=candide`);
    await page.waitForFunction(() => document.body.dataset.recognitionSource === "qr"
      && document.body.dataset.phase === "demo"
      && document.querySelector("#result-title").textContent === "Candide"
      && getComputedStyle(document.querySelector(".demo-card__book")).animationName === "book-spin");
    if (errors.length) throw new Error(errors.join("\n"));

    return {
      status: "passed",
      checks: ["cover detection and visible 3D book", "stable components across cover switches", "live QR detection", "QR-to-cover switching", "continuous rotation", "target loss", "camera stop/restart", "native QR deep link"],
      viewport: "390 × 844",
      note: "Uses configured cover images. Physical editions still need an on-device check.",
    };
  } finally {
    page.off("pageerror", onError);
  }
}
