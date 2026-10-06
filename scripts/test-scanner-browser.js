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
      requests: 0,
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
      window.scannerTestCamera.requests += 1;
      if (sessionStorage.getItem("scannerTestDenyCamera")) {
        throw new DOMException("Camera access denied for the permission test.", "NotAllowedError");
      }
      clearInterval(timer);
      await window.scannerTestCamera.show(new URLSearchParams(location.search).has("book")
        ? null : "./assets/i-robot-cover.jpg");
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
      && document.body.dataset.phase === "tracked"
      && document.querySelector("#result-title").textContent === "Candide"
      && document.querySelector("#ar-scene").systems["mindar-image-system"].controller?.processingVideo
      && document.querySelector("video")?.srcObject?.active
      && getComputedStyle(document.querySelector(".demo-card__book")).animationName === "book-spin");
    const automaticCamera = await page.evaluate(() => window.scannerTestCamera.requests === 1);
    if (!automaticCamera) throw new Error("The QR link did not start exactly one camera session automatically.");
    await expectCover("huckleberry-finn", "./assets/covers/huckleberry-finn-9780553210798.jpg");
    await page.getByRole("button", { name: "Stop camera" }).click();

    await page.evaluate(() => sessionStorage.setItem("scannerTestDenyCamera", "1"));
    await page.goto(`${appUrl}?book=candide`);
    await page.getByRole("button", { name: "START AR", exact: true }).waitFor({ state: "visible" });
    if (await page.locator("#error-message").textContent().then((text) => !text.includes("Candide"))) {
      throw new Error("A camera permission failure lost the selected QR book.");
    }
    await page.evaluate(() => sessionStorage.removeItem("scannerTestDenyCamera"));
    await page.getByRole("button", { name: "START AR", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.phase === "tracked"
      && document.body.dataset.recognitionSource === "qr"
      && document.querySelector("#result-title").textContent === "Candide"
      && document.querySelector("video")?.srcObject?.active);
    if (await page.locator("video").count() !== 1) throw new Error("Retry left an unused camera video behind.");
    await page.getByRole("button", { name: "Stop camera" }).click();

    await page.goto(`${appUrl}?book=unknown-book`);
    await page.waitForFunction(() => document.body.dataset.phase === "intro"
      && document.querySelectorAll(".book-card").length === 18);
    if (await page.evaluate(() => window.scannerTestCamera.requests !== 0)) {
      throw new Error("An invalid book link opened the camera.");
    }
    await page.getByRole("button", { name: "Browse all featured books" }).click();
    await page.getByRole("button", { name: "Preview Candide", exact: true }).click();
    await page.waitForFunction(() => document.body.dataset.phase === "demo"
      && document.querySelector("#result-title").textContent === "Candide");
    if (await page.evaluate(() => window.scannerTestCamera.requests !== 0)) {
      throw new Error("Manual book preview opened the camera.");
    }
    if (errors.length) throw new Error(errors.join("\n"));

    return {
      status: "passed",
      checks: ["cover detection and visible 3D book", "stable components across cover switches", "live QR detection", "QR-to-cover switching", "continuous rotation", "target loss", "camera stop/restart", "QR link automatically opens live AR", "camera permission retry preserves the QR book", "unknown book links stay on the homepage", "manual previews keep the camera off"],
      viewport: "390 × 844",
      note: "Uses configured cover images. Physical editions still need an on-device check.",
    };
  } finally {
    page.off("pageerror", onError);
  }
}
