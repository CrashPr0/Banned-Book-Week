import "./styles.css";
import jsQR from "jsqr";

const dom = {
  body: document.body,
  scene: document.querySelector("#ar-scene"),
  scanCanvas: document.querySelector("#scan-canvas"),
  targets: [...document.querySelectorAll(".book-target")],
  content: document.querySelector("#book-content"),
  statusLabel: document.querySelector("#status-label"),
  scanFooterCopy: document.querySelector("#scan-footer-copy"),
  introPanel: document.querySelector("#intro-panel"),
  collectionPanel: document.querySelector("#collection-panel"),
  collectionGrid: document.querySelector("#collection-grid"),
  collectionClose: document.querySelector("#collection-close"),
  resultPanel: document.querySelector("#result-panel"),
  errorPanel: document.querySelector("#error-panel"),
  errorTitle: document.querySelector("#error-panel h2"),
  errorMessage: document.querySelector("#error-message"),
  startButton: document.querySelector("#start-button"),
  demoButton: document.querySelector("#demo-button"),
  retryButton: document.querySelector("#retry-button"),
  fallbackButton: document.querySelector("#fallback-button"),
  exitButton: document.querySelector("#exit-button"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  editionLabel: document.querySelector("#edition-label"),
  coverStatus: document.querySelector("#cover-status"),
  catalogLink: document.querySelector("#catalog-link"),
  matchBadge: document.querySelector("#match-badge"),
  demoCover: document.querySelector("#demo-cover"),
  arCover: document.querySelector("#ar-cover"),
  resultEyebrow: document.querySelector("#result-panel .eyebrow"),
};

let phase = "intro";
let arSystem = null;
let books = [];
let book = null;
let activeTarget = null;
let qrLaunchBook = null;
let cameraStartVersion = 0;
let qrScanTimer = 0;
let qrScanSession = 0;
let barcodeDetector = null;
let recognitionSource = "cover";
const QR_SCAN_INTERVAL_MS = 250;
const scanCanvasContext = dom.scanCanvas?.getContext("2d", { willReadFrequently: true });

function targetLabel(data = book) {
  return `TARGET ${String((data?.targetIndex ?? 0) + 1).padStart(2, "0")}`;
}

function phaseCopy(nextPhase) {
  const count = books.length || dom.targets.length;
  const copy = {
    intro: ["READY", `${count} COVER TARGETS`],
    starting: ["STARTING", "OPENING CAMERA"],
    scanning: ["SCANNING", `QR STICKERS OR ${count} COVERS`],
    tracked: ["MATCHED", recognitionSource === "qr" ? `${targetLabel()} QR RECOGNIZED` : `${targetLabel()} LOCKED`],
    lost: ["SEARCHING", "MOVE BACK TO THE COVER"],
    demo:
      recognitionSource === "qr"
        ? ["MATCHED", `${targetLabel()} QR RECOGNIZED`]
        : ["PREVIEW", "SIMULATED MATCH"],
    collection: ["COLLECTION", `${count} FEATURED BOOKS`],
    error: ["OFFLINE", "CAMERA NOT STARTED"],
  };
  return copy[nextPhase] ?? copy.intro;
}

function setPhase(nextPhase) {
  phase = nextPhase;
  dom.body.dataset.phase = nextPhase;
  const [status, footer] = phaseCopy(nextPhase);
  dom.statusLabel.textContent = status;
  dom.scanFooterCopy.textContent = footer;

  const resultVisible = nextPhase === "tracked" || nextPhase === "demo";
  dom.resultPanel.setAttribute("aria-hidden", String(!resultVisible));
  dom.errorPanel.setAttribute("aria-hidden", String(nextPhase !== "error"));
  dom.introPanel.setAttribute("aria-hidden", String(nextPhase !== "intro"));
  dom.collectionPanel.setAttribute("aria-hidden", String(nextPhase !== "collection"));
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function cameraPreflight() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (!window.isSecureContext && !localHost) return "Open this experience over HTTPS to use the camera.";
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not expose camera access. Try current Safari or Chrome.";
  }
  if (!supportsWebGL()) return "WebGL is unavailable, so image tracking cannot run in this browser.";
  return null;
}

function waitForScene() {
  if (dom.scene.hasLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("AR scene timed out while loading.")), 12000);
    dom.scene.addEventListener(
      "loaded",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function readableCameraError(error) {
  if (error === "VIDEO_FAIL") {
    return "The camera could not open. Allow camera access in your browser, then try again.";
  }
  if (error?.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
  }
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is already in use by another app or tab.";
  return error?.message || "The AR camera could not start on this device.";
}

function stopQrScanLoop() {
  window.clearTimeout(qrScanTimer);
  qrScanTimer = 0;
  qrScanSession += 1;
}

function scanVideoElement() {
  return arSystem?.video ?? dom.scene?.querySelector("video") ?? document.querySelector("video");
}

async function createBarcodeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("qr_code")) return null;
    return new window.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function resolveBookFromPayload(raw) {
  if (!raw) return null;
  const value = String(raw).trim();

  const legacy = /^bbw:([a-z0-9-]+)$/i.exec(value);
  if (legacy) return books.find((entry) => entry.id === legacy[1].toLowerCase()) ?? null;

  try {
    const url = new URL(value, location.href);
    const fromQuery = url.searchParams.get("book");
    if (fromQuery) return books.find((entry) => entry.id === fromQuery) ?? null;
  } catch {
    // Not a URL payload.
  }

  return books.find((entry) => entry.id === value) ?? null;
}

function setRecognitionSource(source) {
  recognitionSource = source;
  dom.body.dataset.recognitionSource = source;
  if (dom.resultEyebrow) {
    const labels = {
      cover: "COVER RECOGNIZED",
      preview: "BOOK PREVIEW",
      qr: "QR RECOGNIZED",
    };
    dom.resultEyebrow.textContent = labels[source] ?? labels.cover;
  }
}

function handleQrMatch(matchedBook) {
  // A visible cover owns the result until MindAR loses its physical anchor.
  if (activeTarget) return;
  if (book?.id !== matchedBook.id || recognitionSource !== "qr" || phase !== "tracked") {
    setRecognitionSource("qr");
    applyBookData(matchedBook);
  }
  if (phase !== "tracked") setPhase("tracked");
}

async function detectQrFromVideo() {
  const video = scanVideoElement();
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;

  if (barcodeDetector) {
    const codes = await barcodeDetector.detect(video);
    for (const code of codes) {
      const matched = resolveBookFromPayload(code.rawValue);
      if (matched) return matched;
    }
    return null;
  }

  if (!scanCanvasContext || !dom.scanCanvas) return null;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const cropSize = Math.min(width, height);
  const sample = Math.min(cropSize, 480);
  const sx = Math.floor((width - cropSize) / 2);
  const sy = Math.floor((height - cropSize) / 2);
  if (dom.scanCanvas.width !== sample) {
    dom.scanCanvas.width = sample;
    dom.scanCanvas.height = sample;
  }
  scanCanvasContext.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, sample, sample);
  const imageData = scanCanvasContext.getImageData(0, 0, sample, sample);
  const code = jsQR(imageData.data, sample, sample, { inversionAttempts: "dontInvert" });
  return resolveBookFromPayload(code?.data);
}

async function qrScanLoop(session) {
  const scanningPhases = ["scanning", "tracked", "lost"];
  if (session !== qrScanSession || !arSystem || !scanningPhases.includes(phase)) return;

  // Let MindAR keep its frame budget, and never overlap asynchronous QR reads.
  if (!activeTarget) {
    try {
      const matched = await detectQrFromVideo();
      if (session === qrScanSession && scanningPhases.includes(phase) && matched) {
        handleQrMatch(matched);
      }
    } catch (error) {
      console.warn("QR detection frame failed.", error);
    }
  }

  if (session === qrScanSession && scanningPhases.includes(phase)) {
    qrScanTimer = window.setTimeout(() => qrScanLoop(session), QR_SCAN_INTERVAL_MS);
  }
}

function startQrScanLoop() {
  stopQrScanLoop();
  void qrScanLoop(qrScanSession);
}

async function startCamera() {
  if (phase === "starting") return;
  const preflightError = cameraPreflight();
  if (preflightError) {
    showError(preflightError);
    return;
  }
  if (books.length !== dom.targets.length) {
    showError("The book target manifest did not load. Refresh the page and try again.");
    return;
  }

  const startVersion = ++cameraStartVersion;
  setPhase("starting");
  dom.startButton.disabled = true;
  dom.retryButton.disabled = true;
  try {
    await waitForScene();
    if (startVersion !== cameraStartVersion) return;
    barcodeDetector = await createBarcodeDetector();
    if (startVersion !== cameraStartVersion) return;
    arSystem = dom.scene.systems["mindar-image-system"];
    if (!arSystem?.start) throw new Error("The image-tracking engine did not load.");
    await arSystem.start();
  } catch (error) {
    if (startVersion === cameraStartVersion) showError(readableCameraError(error));
  } finally {
    if (startVersion === cameraStartVersion || phase !== "starting") {
      dom.startButton.disabled = false;
      dom.retryButton.disabled = false;
    }
  }
}

function releaseCamera() {
  cameraStartVersion += 1;
  stopQrScanLoop();
  hideArContent();
  activeTarget = null;
  const video = arSystem?.video;
  if (!video) return;
  try {
    if (video.srcObject && arSystem.controller) {
      arSystem.stop();
      return;
    }
    arSystem?.controller?.stopProcessVideo?.();
  } catch {
    // The browser may have already released the stream during page teardown.
  }
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.remove();
}

function stopCamera() {
  releaseCamera();
  qrLaunchBook = null;
  book = null;
  setRecognitionSource("cover");
  document.title = "Let Books Be — Banned Books Week AR";
  setPhase("intro");
}

function showError(message) {
  releaseCamera();
  dom.errorTitle.textContent = qrLaunchBook ? "Start AR for this book." : "Use the visual preview instead.";
  dom.errorMessage.textContent = qrLaunchBook ? `${qrLaunchBook.title} is ready. ${message}` : message;
  dom.retryButton.textContent = qrLaunchBook ? "START AR" : "TRY AGAIN";
  dom.fallbackButton.textContent = qrLaunchBook ? "View book preview" : "Browse collection";
  setPhase("error");
}

function openDemo(matchedBook) {
  releaseCamera();
  qrLaunchBook = null;
  if (!matchedBook) {
    openCollection();
    return;
  }
  setRecognitionSource("preview");
  applyBookData(matchedBook);
  setPhase("demo");
}

function openCollection() {
  releaseCamera();
  qrLaunchBook = null;
  setPhase("collection");
  dom.collectionClose.focus();
}

function closeCollection() {
  document.title = "Let Books Be — Banned Books Week AR";
  setPhase("intro");
  dom.demoButton.focus();
}

function bookFromLocation() {
  const fromQuery = new URLSearchParams(location.search).get("book");
  if (!fromQuery) return null;
  return books.find((entry) => entry.id === fromQuery) ?? null;
}

function applyBookData(data) {
  book = data;
  const status = data.coverStatus === "approved" ? "APPROVED COVER" : "CANDIDATE COVER";
  const number = targetLabel(data);
  const coverSelector = `#cover-${data.id}`;
  const coverAlt = `${data.edition} cover of ${data.title}`;
  const catalogUrl = data.recordUrl || data.catalogSearchUrl;

  document.title = `${data.title} — Banned Books AR`;
  dom.resultTitle.textContent = data.title;
  dom.resultSummary.textContent = data.displaySummary;
  dom.editionLabel.textContent = data.edition;
  dom.coverStatus.textContent = status;
  dom.coverStatus.dataset.status = data.coverStatus;
  dom.matchBadge.textContent = `MATCH ${number.slice(-2)}`;
  dom.catalogLink.href = catalogUrl;
  dom.catalogLink.firstChild.textContent = "View SJSU King Library Record ";

  dom.demoCover.src = data.coverPath;
  dom.demoCover.alt = coverAlt;

  if (dom.arCover.getAttribute("src") !== coverSelector) {
    // A-Frame reuses image textures, but WebGL cannot resize their immutable storage.
    dom.arCover.setAttribute("material", "src", "");
    dom.arCover.setAttribute("src", coverSelector);
  }
}

function renderCollection() {
  dom.collectionGrid.replaceChildren();
  for (const entry of books) {
    const card = document.createElement("button");
    card.className = "book-card";
    card.type = "button";
    card.setAttribute("aria-label", `Preview ${entry.title}`);

    const cover = document.createElement("img");
    cover.src = entry.coverPath;
    cover.alt = "";

    const copy = document.createElement("span");
    copy.className = "book-card__copy";
    const index = document.createElement("span");
    index.className = "book-card__index";
    index.textContent = `BOOK ${String(entry.targetIndex + 1).padStart(2, "0")}`;
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const author = document.createElement("span");
    author.textContent = entry.authors?.[0] || "Sacred text";
    copy.append(index, title, author);
    card.append(cover, copy);
    card.addEventListener("click", () => openDemo(entry));
    dom.collectionGrid.append(card);
  }
}

async function loadBookData() {
  try {
    const response = await fetch("./data/books.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Book data returned ${response.status}`);
    const manifest = await response.json();
    books = manifest.books.sort((left, right) => left.targetIndex - right.targetIndex);
    if (books.length !== dom.targets.length) {
      throw new Error(`Expected ${dom.targets.length} books but received ${books.length}.`);
    }
    books.forEach((entry, index) => {
      if (entry.targetIndex !== index) throw new Error("Target indexes are not contiguous.");
    });
    renderCollection();
    const deepLinked = bookFromLocation();
    const countLabel = `${books.length} COVER TARGETS`;
    const countEl = document.querySelector("#intro-target-count");
    if (countEl) countEl.textContent = countLabel;
    if (deepLinked) {
      qrLaunchBook = deepLinked;
      setRecognitionSource("qr");
      applyBookData(deepLinked);
      await startCamera();
    } else {
      book = null;
      document.title = "Let Books Be — Banned Books Week AR";
      setPhase("intro");
    }
  } catch (error) {
    console.warn("The multi-book manifest could not be loaded.", error);
    dom.startButton.disabled = true;
    showError("The book target manifest could not be loaded. Refresh after redeploying the app.");
  }
}

dom.scene.addEventListener("arReady", () => {
  if (phase !== "starting") {
    // MindAR can finish loading after the visitor exits. Stop after its event
    // handler returns, since it starts processing video immediately afterwards.
    window.setTimeout(() => {
      if (!["starting", "scanning", "tracked", "lost"].includes(phase)) releaseCamera();
    }, 0);
    return;
  }
  setPhase("scanning");
  if (qrLaunchBook) handleQrMatch(qrLaunchBook);
  startQrScanLoop();
});
dom.scene.addEventListener("arError", (event) => {
  if (!["starting", "scanning", "tracked", "lost"].includes(phase)) return;
  showError(readableCameraError(event.detail?.error || event.detail));
});

function hideArContent() {
  dom.content.emit("hide", null, false);
  dom.content.setAttribute("visible", false);
  dom.content.setAttribute("scale", "0.001 0.001 0.001");
}

for (const target of dom.targets) {
  target.addEventListener("targetFound", () => {
    if (!["scanning", "tracked", "lost"].includes(phase)) return;
    const targetIndex = Number(target.dataset.targetIndex);
    const matchedBook = books[targetIndex];
    if (!matchedBook) return;
    activeTarget = target;
    // Moving an A-Frame DOM entity tears down its geometry and animation.
    // Attach only its Three.js object so the initialized components stay alive.
    target.object3D.add(dom.content.object3D);
    setRecognitionSource("cover");
    applyBookData(matchedBook);
    dom.content.setAttribute("scale", "0.001 0.001 0.001");
    dom.content.setAttribute("visible", true);
    dom.content.emit("reveal", null, false);
    setPhase("tracked");
  });

  target.addEventListener("targetLost", () => {
    if (target !== activeTarget) return;
    hideArContent();
    activeTarget = null;
    setPhase("lost");
    window.setTimeout(() => {
      if (phase === "lost") setPhase("scanning");
    }, 1200);
  });
}

dom.startButton.addEventListener("click", startCamera);
dom.demoButton.addEventListener("click", openCollection);
dom.retryButton.addEventListener("click", startCamera);
dom.fallbackButton.addEventListener("click", () => {
  if (qrLaunchBook) openDemo(qrLaunchBook);
  else openCollection();
});
dom.exitButton.addEventListener("click", stopCamera);
dom.collectionClose.addEventListener("click", closeCollection);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || phase === "intro") return;
  if (phase === "collection") closeCollection();
  else stopCamera();
});
window.addEventListener("pagehide", () => {
  releaseCamera();
});

loadBookData();
