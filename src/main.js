import "./styles.css";

const dom = {
  body: document.body,
  scene: document.querySelector("#ar-scene"),
  target: document.querySelector("#book-target"),
  content: document.querySelector("#book-content"),
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
  arTitle: document.querySelector("#ar-title"),
  arKicker: document.querySelector("#ar-kicker"),
  arSummary: document.querySelector("#ar-summary"),
};

const phaseCopy = {
  intro: ["READY", "LOOKING FOR TARGET 01"],
  starting: ["STARTING", "OPENING CAMERA"],
  scanning: ["SCANNING", "LOOKING FOR TARGET 01"],
  tracked: ["MATCHED", "TARGET 01 LOCKED"],
  lost: ["SEARCHING", "MOVE BACK TO THE COVER"],
  demo: ["PREVIEW", "SIMULATED MATCH"],
  error: ["OFFLINE", "CAMERA NOT STARTED"],
};

let phase = "intro";
let arSystem = null;
let book = null;

function setPhase(nextPhase) {
  phase = nextPhase;
  dom.body.dataset.phase = nextPhase;
  const [status, footer] = phaseCopy[nextPhase] ?? phaseCopy.intro;
  dom.statusLabel.textContent = status;
  dom.scanFooterCopy.textContent = footer;

  const resultVisible = nextPhase === "tracked" || nextPhase === "demo";
  dom.resultPanel.setAttribute("aria-hidden", String(!resultVisible));
  dom.errorPanel.setAttribute("aria-hidden", String(nextPhase !== "error"));
  dom.introPanel.setAttribute("aria-hidden", String(nextPhase !== "intro"));
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
  if (!window.isSecureContext && !localHost) {
    return "Open this experience over HTTPS to use the camera.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not expose camera access. Try current Safari or Chrome.";
  }
  if (!supportsWebGL()) {
    return "WebGL is unavailable, so image tracking cannot run in this browser.";
  }
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
  if (error?.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
  }
  if (error?.name === "NotFoundError") {
    return "No camera was found on this device.";
  }
  if (error?.name === "NotReadableError") {
    return "The camera is already in use by another app or tab.";
  }
  return error?.message || "The AR camera could not start on this device.";
}

async function startCamera() {
  const preflightError = cameraPreflight();
  if (preflightError) {
    showError(preflightError);
    return;
  }

  setPhase("starting");
  dom.startButton.disabled = true;

  try {
    await waitForScene();
    arSystem = dom.scene.systems["mindar-image-system"];
    if (!arSystem?.start) throw new Error("The image-tracking engine did not load.");
    await arSystem.start();
  } catch (error) {
    showError(readableCameraError(error));
  } finally {
    dom.startButton.disabled = false;
  }
}

async function stopCamera() {
  try {
    await arSystem?.stop?.();
  } catch {
    // The browser may have already released the stream during page teardown.
  }
  dom.content.setAttribute("scale", "0.001 0.001 0.001");
  setPhase("intro");
}

function showError(message) {
  dom.errorMessage.textContent = message;
  setPhase("error");
}

function openDemo() {
  if (phase !== "intro" && phase !== "error") {
    arSystem?.stop?.();
  }
  setPhase("demo");
}

function applyBookData(data) {
  book = data;
  const author = data.authors?.[0] ?? "Isaac Asimov";
  document.title = `${data.title} — Banned Books AR`;
  dom.resultTitle.textContent = data.title;
  dom.resultSummary.textContent = data.displaySummary;
  dom.editionLabel.textContent = data.edition;
  dom.arTitle.setAttribute("value", data.title.toUpperCase());
  dom.arKicker.setAttribute("value", `FOUND / ${data.edition.toUpperCase()}`);
  dom.arSummary.setAttribute("value", data.arSummary);
  document.querySelector(".author").textContent = author;
}

async function loadBookData() {
  try {
    const response = await fetch("./data/book.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Book data returned ${response.status}`);
    applyBookData(await response.json());
  } catch (error) {
    console.warn("Using embedded book copy because metadata could not be loaded.", error);
  }
}

dom.scene.addEventListener("arReady", () => setPhase("scanning"));
dom.scene.addEventListener("arError", (event) => {
  showError(readableCameraError(event.detail?.error || event.detail));
});

dom.target.addEventListener("targetFound", () => {
  dom.content.setAttribute("scale", "0.001 0.001 0.001");
  dom.content.emit("reveal");
  setPhase("tracked");
});

dom.target.addEventListener("targetLost", () => {
  dom.content.setAttribute("scale", "0.001 0.001 0.001");
  setPhase("lost");
  window.setTimeout(() => {
    if (phase === "lost") setPhase("scanning");
  }, 1200);
});

dom.startButton.addEventListener("click", startCamera);
dom.demoButton.addEventListener("click", openDemo);
dom.retryButton.addEventListener("click", startCamera);
dom.fallbackButton.addEventListener("click", openDemo);
dom.exitButton.addEventListener("click", stopCamera);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && phase !== "intro") stopCamera();
});

window.addEventListener("pagehide", () => arSystem?.stop?.());

loadBookData();
