import "./styles.css";

const dom = {
  body: document.body,
  scene: document.querySelector("#ar-scene"),
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
  arTitle: document.querySelector("#ar-title"),
  arKicker: document.querySelector("#ar-kicker"),
  arSummary: document.querySelector("#ar-summary"),
};

let phase = "intro";
let arSystem = null;
let books = [];
let book = null;
let activeTarget = null;

function targetLabel(data = book) {
  return `TARGET ${String((data?.targetIndex ?? 0) + 1).padStart(2, "0")}`;
}

function phaseCopy(nextPhase) {
  const count = books.length || dom.targets.length;
  const copy = {
    intro: ["READY", `${count} COVER TARGETS`],
    starting: ["STARTING", "OPENING CAMERA"],
    scanning: ["SCANNING", `LOOKING FOR ${count} COVERS`],
    tracked: ["MATCHED", `${targetLabel()} LOCKED`],
    lost: ["SEARCHING", "MOVE BACK TO THE COVER"],
    demo: ["PREVIEW", "SIMULATED MATCH"],
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
  if (error?.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
  }
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is already in use by another app or tab.";
  return error?.message || "The AR camera could not start on this device.";
}

async function startCamera() {
  const preflightError = cameraPreflight();
  if (preflightError) {
    showError(preflightError);
    return;
  }
  if (books.length !== dom.targets.length) {
    showError("The book target manifest did not load. Refresh the page and try again.");
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
  activeTarget = null;
  book = null;
  document.title = "Let Books Be — Banned Books Week AR";
  setPhase("intro");
}

function showError(message) {
  dom.errorMessage.textContent = message;
  setPhase("error");
}

function openDemo(matchedBook) {
  if (phase !== "intro" && phase !== "error") arSystem?.stop?.();
  if (!matchedBook) {
    openCollection();
    return;
  }
  applyBookData(matchedBook);
  setPhase("demo");
}

function openCollection() {
  if (phase !== "intro" && phase !== "error" && phase !== "collection") arSystem?.stop?.();
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
  dom.catalogLink.firstChild.textContent = data.recordUrl ? "VIEW SJPL RECORD " : "SEARCH SJPL CATALOG ";

  dom.demoCover.src = data.coverPath;
  dom.demoCover.alt = coverAlt;

  dom.arCover.setAttribute("src", coverSelector);
  dom.arTitle.setAttribute("value", data.title.toUpperCase());
  dom.arKicker.setAttribute("value", `FOUND / ${status}`);
  dom.arSummary.setAttribute("value", data.arSummary);
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
      applyBookData(deepLinked);
      setPhase("demo");
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

dom.scene.addEventListener("arReady", () => setPhase("scanning"));
dom.scene.addEventListener("arError", (event) => {
  showError(readableCameraError(event.detail?.error || event.detail));
});

for (const target of dom.targets) {
  target.addEventListener("targetFound", () => {
    const targetIndex = Number(target.dataset.targetIndex);
    const matchedBook = books[targetIndex];
    if (!matchedBook) return;
    activeTarget = target;
    target.appendChild(dom.content);
    applyBookData(matchedBook);
    dom.content.setAttribute("scale", "0.001 0.001 0.001");
    dom.content.emit("reveal");
    setPhase("tracked");
  });

  target.addEventListener("targetLost", () => {
    if (target !== activeTarget) return;
    dom.content.setAttribute("scale", "0.001 0.001 0.001");
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
dom.fallbackButton.addEventListener("click", openCollection);
dom.exitButton.addEventListener("click", stopCamera);
dom.collectionClose.addEventListener("click", closeCollection);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || phase === "intro") return;
  if (phase === "collection") closeCollection();
  else stopCamera();
});
window.addEventListener("pagehide", () => arSystem?.stop?.());

loadBookData();
