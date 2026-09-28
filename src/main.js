import "./styles.css";
import jsQR from "jsqr";

const dom = {
  body: document.body,
  video: document.querySelector("#camera-video"),
  canvas: document.querySelector("#scan-canvas"),
  statusLabel: document.querySelector("#status-label"),
  scanFooterCopy: document.querySelector("#scan-footer-copy"),
  introPanel: document.querySelector("#intro-panel"),
  resultPanel: document.querySelector("#result-panel"),
  errorPanel: document.querySelector("#error-panel"),
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
  introCover: document.querySelector("#intro-cover"),
  demoCover: document.querySelector("#demo-cover"),
  introIsbn: document.querySelector("#intro-isbn"),
  introCount: document.querySelector("#intro-count"),
  introTargetLabel: document.querySelector("#intro-target-label"),
  introTitle: document.querySelector("#intro-title"),
};

const canvasContext = dom.canvas.getContext("2d", { willReadFrequently: true });

let phase = "intro";
let books = [];
let bookById = new Map();
let book = null;
let mediaStream = null;
let scanFrame = 0;
let lastMatchAt = 0;
let lostTimer = 0;
let barcodeDetector = null;

function targetLabel(data = book) {
  return `TARGET ${String((data?.targetIndex ?? 0) + 1).padStart(2, "0")}`;
}

function phaseCopy(nextPhase) {
  const count = books.length || 5;
  const copy = {
    intro: ["READY", `${count} QR TARGETS`],
    starting: ["STARTING", "OPENING CAMERA"],
    scanning: ["SCANNING", `LOOKING FOR ${count} QR CODES`],
    tracked: ["MATCHED", `${targetLabel()} LOCKED`],
    lost: ["SEARCHING", "MOVE BACK TO THE QR CODE"],
    demo: ["PREVIEW", "SIMULATED MATCH"],
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
  const cameraLive = ["starting", "scanning", "tracked", "lost"].includes(nextPhase);
  dom.resultPanel.setAttribute("aria-hidden", String(!resultVisible));
  dom.errorPanel.setAttribute("aria-hidden", String(nextPhase !== "error"));
  dom.introPanel.setAttribute("aria-hidden", String(nextPhase !== "intro"));
  dom.video.setAttribute("aria-hidden", String(!cameraLive));
}

function cameraPreflight() {
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  if (!window.isSecureContext && !localHost) return "Open this experience over HTTPS to use the camera.";
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not expose camera access. Try current Safari or Chrome.";
  }
  return null;
}

function readableCameraError(error) {
  if (error?.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
  }
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is already in use by another app or tab.";
  return error?.message || "The camera could not start on this device.";
}

function resolveBookFromPayload(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  const direct = /^bbw:([a-z0-9-]+)$/i.exec(value);
  if (direct) return bookById.get(direct[1].toLowerCase()) ?? null;

  try {
    const url = new URL(value, location.href);
    const fromQuery = url.searchParams.get("book");
    if (fromQuery && bookById.has(fromQuery)) return bookById.get(fromQuery);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const fromHash = hashParams.get("book");
    if (fromHash && bookById.has(fromHash)) return bookById.get(fromHash);
  } catch {
    // Not a URL payload.
  }

  if (bookById.has(value)) return bookById.get(value);
  return null;
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

function stopScanLoop() {
  if (scanFrame) {
    cancelAnimationFrame(scanFrame);
    scanFrame = 0;
  }
}

function stopCameraTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  dom.video.srcObject = null;
}

async function stopCamera() {
  stopScanLoop();
  window.clearTimeout(lostTimer);
  stopCameraTracks();
  if (books[0]) applyBookData(books[0]);
  setPhase("intro");
}

function showError(message) {
  stopScanLoop();
  stopCameraTracks();
  dom.errorMessage.textContent = message;
  setPhase("error");
}

function openDemo(matchedBook = books[0]) {
  stopScanLoop();
  stopCameraTracks();
  if (matchedBook) applyBookData(matchedBook);
  setPhase("demo");
}

function applyBookData(data) {
  book = data;
  const author = data.authors?.[0] ?? "Unknown author";
  const isbn = data.isbn?.[0] ?? "EDITION PENDING";
  const status = data.coverStatus === "approved" ? "APPROVED COVER" : "CANDIDATE COVER";
  const number = targetLabel(data);
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
  dom.catalogLink.firstChild.textContent = data.recordUrl ? "VIEW SJPL RECORD " : "SEARCH SJPL CATALOG ";

  dom.introTitle.textContent = data.title;
  dom.introIsbn.textContent = data.qrPayload ?? `ISBN ${isbn}`;
  dom.introCount.textContent = `${books.length || 5} QR TARGETS`;
  dom.introTargetLabel.textContent = `${number} / QR ${data.qrPayload ?? data.id}`;
  dom.introCover.src = data.coverPath;
  dom.introCover.alt = coverAlt;
  dom.demoCover.src = data.coverPath;
  dom.demoCover.alt = coverAlt;
  document.querySelector(".author").textContent = author;
}

function handleMatch(matchedBook) {
  lastMatchAt = performance.now();
  window.clearTimeout(lostTimer);
  if (book?.id !== matchedBook.id || phase !== "tracked") {
    applyBookData(matchedBook);
  }
  if (phase !== "tracked") setPhase("tracked");
}

function handleMiss() {
  if (phase !== "tracked") return;
  if (performance.now() - lastMatchAt < 900) return;
  window.clearTimeout(lostTimer);
  setPhase("lost");
  lostTimer = window.setTimeout(() => {
    if (phase === "lost") setPhase("scanning");
  }, 1200);
}

async function detectWithBarcodeDetector() {
  const codes = await barcodeDetector.detect(dom.video);
  for (const code of codes) {
    const matched = resolveBookFromPayload(code.rawValue);
    if (matched) return matched;
  }
  return null;
}

function detectWithJsQR() {
  const width = dom.video.videoWidth;
  const height = dom.video.videoHeight;
  if (!width || !height) return null;

  const sample = Math.min(width, height, 720);
  const sx = Math.floor((width - sample) / 2);
  const sy = Math.floor((height - sample) / 2);
  dom.canvas.width = sample;
  dom.canvas.height = sample;
  canvasContext.drawImage(dom.video, sx, sy, sample, sample, 0, 0, sample, sample);
  const imageData = canvasContext.getImageData(0, 0, sample, sample);
  const code = jsQR(imageData.data, sample, sample, { inversionAttempts: "dontInvert" });
  return resolveBookFromPayload(code?.data);
}

async function scanLoop() {
  if (!mediaStream || phase === "intro" || phase === "error" || phase === "demo") return;

  try {
    if (dom.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const matched = barcodeDetector ? await detectWithBarcodeDetector() : detectWithJsQR();
      if (matched) handleMatch(matched);
      else handleMiss();
    }
  } catch (error) {
    console.warn("QR detection frame failed.", error);
  }

  scanFrame = requestAnimationFrame(scanLoop);
}

async function startCamera() {
  const preflightError = cameraPreflight();
  if (preflightError) {
    showError(preflightError);
    return;
  }
  if (!books.length) {
    showError("The book QR manifest did not load. Refresh the page and try again.");
    return;
  }

  setPhase("starting");
  dom.startButton.disabled = true;
  try {
    stopScanLoop();
    stopCameraTracks();
    barcodeDetector = await createBarcodeDetector();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    dom.video.srcObject = mediaStream;
    await dom.video.play();
    setPhase("scanning");
    scanFrame = requestAnimationFrame(scanLoop);
  } catch (error) {
    showError(readableCameraError(error));
  } finally {
    dom.startButton.disabled = false;
  }
}

function bookFromLocation() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("book");
  if (fromQuery && bookById.has(fromQuery)) return bookById.get(fromQuery);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const fromHash = hashParams.get("book");
  if (fromHash && bookById.has(fromHash)) return bookById.get(fromHash);
  return null;
}

async function loadBookData() {
  try {
    const response = await fetch("./data/books.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Book data returned ${response.status}`);
    const manifest = await response.json();
    books = manifest.books.sort((left, right) => left.targetIndex - right.targetIndex);
    books.forEach((entry, index) => {
      if (entry.targetIndex !== index) throw new Error("Target indexes are not contiguous.");
      if (!entry.qrPayload) throw new Error(`${entry.title} is missing a QR payload.`);
    });
    bookById = new Map(books.map((entry) => [entry.id, entry]));
    const deepLinked = bookFromLocation();
    applyBookData(deepLinked ?? books[0]);
    if (deepLinked) setPhase("demo");
    else setPhase("intro");
  } catch (error) {
    console.warn("The multi-book manifest could not be loaded.", error);
    dom.startButton.disabled = true;
    showError("The book QR manifest could not be loaded. Refresh after regenerating QR codes.");
  }
}

dom.startButton.addEventListener("click", startCamera);
dom.demoButton.addEventListener("click", () => openDemo(books[0]));
dom.retryButton.addEventListener("click", startCamera);
dom.fallbackButton.addEventListener("click", () => openDemo(books[0]));
dom.exitButton.addEventListener("click", stopCamera);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && phase !== "intro") stopCamera();
});
window.addEventListener("pagehide", () => {
  stopScanLoop();
  stopCameraTracks();
});

loadBookData();
