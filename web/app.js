const videoElement = document.querySelector("#input-video");
const canvasElement = document.querySelector("#output-canvas");
const canvasCtx = canvasElement.getContext("2d");
const startButton = document.querySelector("#start-button");
const stopButton = document.querySelector("#stop-button");
const statusMessage = document.querySelector("#status-message");
const emptyState = document.querySelector("#empty-state");
const indexResult = document.querySelector("#index-result");
const fingerCount = document.querySelector("#finger-count");
const handState = document.querySelector("#hand-state");
const detectionBoxLabel = document.querySelector("#detection-box-label");
const handsList = document.querySelector("#hands-list");
const handResultsBody = document.querySelector("#hand-results-body");
const interactionPageButton = document.querySelector("#interaction-page-button");
const interactionTarget = document.querySelector("#interaction-target");
const interactionFeedback = document.querySelector("#interaction-feedback");
const backButton = document.querySelector("#back-button");
const stepItems = new Map(
  Array.from(document.querySelectorAll("[data-step]")).map((item) => [item.dataset.step, item]),
);
const handSlotItems = new Map(
  Array.from(document.querySelectorAll("[data-hand-slot]")).map((item) => [
    item.dataset.handSlot,
    item,
  ]), 
); 
const FINGER_SPECS = [
  ["thumb", 2, 3, 4, 2],
  ["index", 5, 6, 8, 6],
  ["middle", 9, 10, 12, 10],
  ["ring", 13, 14, 16, 14],
  ["pinky", 17, 18, 20, 18],
];
 
const HAND_CONNECTIONS = window.HAND_CONNECTIONS ?? [];
const HAND_COLORS = {
  Left: "#65a8ff",
  Right: "#33ffcc",
  Unknown: "#ffd166",
};
const MIRRORED_HANDEDNESS = {
  Left: "Right",
  Right: "Left",
};
const MIRROR_DISPLAY = true;
const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

let hands = null;
let isRunning = false;
let isInitializing = false;
let animationFrameId = null;
let videoFrameCallbackId = null;
let lastFrameProcessedAt = 0;
let videoRect = { x: 0, y: 0, width: 1, height: 1 };
let canvasLocked = false;
const isInteractionPage = document.body.dataset.page === "interaction";
let interactionMode = isInteractionPage;
let interactionTriggered = false;
let latestHandResults = [];
let bothHandsCompleted = false;
let isProcessingFrame = false;

function setStatus(message, state = "") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("initializing", state === "initializing");
  statusMessage.classList.toggle("ready", state === "ready");
}

function setStep(name, state) {
  const item = stepItems.get(name);
  if (!item) {
    return;
  }
  item.classList.toggle("active", state === "active");
  item.classList.toggle("done", state === "done");
}

function resetSteps() {
  for (const item of stepItems.values()) {
    item.classList.remove("active", "done");
  }
}

function updateHandSlots(handResults = []) {
  for (const [slotName, item] of handSlotItems.entries()) {
    const handResult = handResults.find((result) => result.handedness === slotName);
    const status = item.querySelector("span");
    item.classList.toggle("detected", Boolean(handResult));
    status.textContent = handResult ? "active" : "waiting";
  }
}

function distance(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function jointAngleDegrees(pointA, joint, pointC) {
  const vectorA = { x: pointA.x - joint.x, y: pointA.y - joint.y };
  const vectorC = { x: pointC.x - joint.x, y: pointC.y - joint.y };
  const magnitudeA = Math.hypot(vectorA.x, vectorA.y);
  const magnitudeC = Math.hypot(vectorC.x, vectorC.y);

  if (magnitudeA === 0 || magnitudeC === 0) {
    return 0;
  }

  const cosine =
    (vectorA.x * vectorC.x + vectorA.y * vectorC.y) / (magnitudeA * magnitudeC);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function detectFingers(landmarks, minAngleDegrees = 150, distanceMargin = 0.03) {
  if (!landmarks || landmarks.length < 21) {
    throw new Error("Expected 21 hand landmarks.");
  }

  const wrist = landmarks[0];
  const detections = FINGER_SPECS.map(
    ([name, proximalIndex, jointIndex, tipIndex, baseIndex]) => {
      const angleDegrees = jointAngleDegrees(
        landmarks[proximalIndex],
        landmarks[jointIndex],
        landmarks[tipIndex],
      );
      const wristToTip = distance(wrist, landmarks[tipIndex]);
      const wristToBase = distance(wrist, landmarks[baseIndex]);
      const isExtended =
        angleDegrees >= minAngleDegrees && wristToTip > wristToBase + distanceMargin;

      return {
        name,
        tip: landmarks[tipIndex],
        angleDegrees,
        isExtended,
      };
    },
  );

  const byName = Object.fromEntries(detections.map((detection) => [detection.name, detection]));
  return {
    detections,
    byName,
    extendedCount: detections.filter((detection) => detection.isExtended).length,
    index: byName.index,
  };
}

function getHandBoundingBox(landmarks, padding = 0.045) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.max(0, Math.min(...xs) - padding);
  const maxX = Math.min(1, Math.max(...xs) + padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxY = Math.min(1, Math.max(...ys) + padding);

  return {
    x: videoRect.x + (MIRROR_DISPLAY ? 1 - maxX : minX) * videoRect.width,
    y: videoRect.y + minY * videoRect.height,
    width: (maxX - minX) * videoRect.width,
    height: (maxY - minY) * videoRect.height,
    normalized: { minX, minY, maxX, maxY },
  };
}

function getHandednessLabel(results, handLandmarks, index) {
  const handedness = results.multiHandedness?.[index];
  const label =
    handedness?.label ?? handedness?.classification?.[0]?.label ?? handedness?.[0]?.label;

  if (label === "Left" || label === "Right") {
    return MIRROR_DISPLAY ? MIRRORED_HANDEDNESS[label] : label;
  }

  const appearsOnLeft = MIRROR_DISPLAY ? handLandmarks[0]?.x > 0.5 : handLandmarks[0]?.x < 0.5;
  return appearsOnLeft ? "Left" : "Right";
}

function resizeCanvasToDisplaySize({ force = false } = {}) {
  if (canvasLocked && !force) {
    return;
  }

  const rect = canvasElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvasElement.width !== width || canvasElement.height !== height) {
    canvasElement.width = width;
    canvasElement.height = height;
  }
}

function getContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function updateVideoRect(source) {
  const sourceWidth = videoElement.videoWidth || source?.width || canvasElement.width;
  const sourceHeight = videoElement.videoHeight || source?.height || canvasElement.height;
  videoRect = getContainRect(sourceWidth, sourceHeight, canvasElement.width, canvasElement.height);
}

function mapLandmark(point) {
  const normalizedX = MIRROR_DISPLAY ? 1 - point.x : point.x;
  return {
    x: videoRect.x + normalizedX * videoRect.width,
    y: videoRect.y + point.y * videoRect.height,
  };
}

function drawVideoFrame(image) {
  if (!MIRROR_DISPLAY) {
    canvasCtx.drawImage(image, videoRect.x, videoRect.y, videoRect.width, videoRect.height);
    return;
  }

  canvasCtx.save();
  canvasCtx.translate(videoRect.x + videoRect.width, videoRect.y);
  canvasCtx.scale(-1, 1);
  canvasCtx.drawImage(image, 0, 0, videoRect.width, videoRect.height);
  canvasCtx.restore();
}

function canvasPointToViewport(point) {
  const canvasRect = canvasElement.getBoundingClientRect();
  return {
    x: canvasRect.left + (point.x / canvasElement.width) * canvasRect.width,
    y: canvasRect.top + (point.y / canvasElement.height) * canvasRect.height,
  };
}

function isPointInsideRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function drawHandLandmarks(landmarks, color) {
  canvasCtx.save();
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 3;

  for (const [startIndex, endIndex] of HAND_CONNECTIONS) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end) {
      continue;
    }
    const startPoint = mapLandmark(start);
    const endPoint = mapLandmark(end);
    canvasCtx.beginPath();
    canvasCtx.moveTo(startPoint.x, startPoint.y);
    canvasCtx.lineTo(endPoint.x, endPoint.y);
    canvasCtx.stroke();
  }

  for (const landmark of landmarks) {
    const point = mapLandmark(landmark);
    canvasCtx.beginPath();
    canvasCtx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.fill();
  }
  canvasCtx.restore();
}

function drawDetectionBox(box, label, color) {
  canvasCtx.save();
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 4;
  canvasCtx.shadowColor = color;
  canvasCtx.shadowBlur = 16;
  canvasCtx.strokeRect(box.x, box.y, box.width, box.height);
  canvasCtx.shadowBlur = 0;
  canvasCtx.fillStyle = "rgba(4, 18, 14, 0.84)";
  canvasCtx.fillRect(box.x, Math.max(0, box.y - 30), 176, 26);
  canvasCtx.fillStyle = "#bbffff";
  canvasCtx.font = "700 14px monospace";
  canvasCtx.fillText(label, box.x + 10, Math.max(18, box.y - 11));
  canvasCtx.restore();
}

function drawFingerTip(detection, color) {
  const { x, y } = mapLandmark(detection.tip);
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 8, 0, Math.PI * 2);
  canvasCtx.fillStyle = detection.isExtended ? color : "rgba(255,255,255,0.58)";
  canvasCtx.fill();
}

function updateDetectionBoxLabel(handResults) {
  if (handResults.length === 0) {
    detectionBoxLabel.textContent = "Detection boxes: waiting";
    return;
  }

  detectionBoxLabel.textContent = `Detection boxes: ${handResults
    .map((result) => {
      const { minX, minY, maxX, maxY } = result.box.normalized;
      return `${result.label} x ${minX.toFixed(2)}-${maxX.toFixed(2)}, y ${minY.toFixed(
        2,
      )}-${maxY.toFixed(2)}`;
    })
    .join(" | ")}`;
}

function createHandCard(handResult) {
  const card = document.createElement("article");
  card.className = "hand-card";
  card.style.setProperty("--hand-color", handResult.color);

  const title = document.createElement("h3");
  title.textContent = `${handResult.label} configuration`;
  card.append(title);

  const summary = document.createElement("p");
  summary.className = "hand-summary";
  summary.textContent = `${handResult.state.extendedCount} extended finger${
    handResult.state.extendedCount === 1 ? "" : "s"
  }`;
  card.append(summary);

  const list = document.createElement("ul");
  list.className = "hand-finger-list";

  for (const detection of handResult.state.detections) {
    const item = document.createElement("li");
    item.classList.toggle("active", detection.isExtended);
    const name = document.createElement("span");
    name.textContent = detection.name;
    const state = document.createElement("strong");
    state.textContent = detection.isExtended
      ? `on (${Math.round(detection.angleDegrees)} deg)`
      : `off (${Math.round(detection.angleDegrees)} deg)`;
    item.append(name, state);
    list.append(item);
  }

  card.append(list);
  return card;
}

function updateHandCards(handResults) {
  handsList.replaceChildren();

  if (handResults.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hands-empty";
    empty.textContent = "No hand data available.";
    handsList.append(empty);
    return;
  }

  // Kept for screen-reader status only; the visible result table is stable.
  const summary = document.createElement("p");
  summary.textContent = handResults.map((result) => result.label).join(", ");
  handsList.append(summary);
}

function renderHandResultsTable(handResults) {
  handResultsBody.replaceChildren();

  const leftHand = handResults.find((result) => result.handedness === "Left");
  const rightHand = handResults.find((result) => result.handedness === "Right");

  for (const [fingerName] of FINGER_SPECS) {
    const leftDetection = leftHand?.state.byName[fingerName];
    const rightDetection = rightHand?.state.byName[fingerName];
    const row = document.createElement("tr");
    row.classList.toggle("active", Boolean(leftDetection?.isExtended || rightDetection?.isExtended));
    row.innerHTML = `
      <td>${fingerName}</td>
      <td><span class="finger-state">${leftDetection?.isExtended ? "on" : "off"}</span></td>
      <td><span class="finger-state">${rightDetection?.isExtended ? "on" : "off"}</span></td>
    `;
    handResultsBody.append(row);
  }
}

function updateInteractionAccess(handResults) {
  const hasLeft = handResults.some((result) => result.handedness === "Left");
  const hasRight = handResults.some((result) => result.handedness === "Right");
  const ready = hasLeft && hasRight;
  if (ready) {
    bothHandsCompleted = true;
    setStep("mediapipe", "done");
    setStep("camera", "done");
    setStep("hand", "done");
    setStep("fingers", "done");
  }
  interactionPageButton.disabled = !bothHandsCompleted;
  interactionPageButton.classList.toggle("ready", bothHandsCompleted);
  interactionPageButton.textContent = "Open interaction screen";
}

function checkInteractionTarget(handResults) {
  if (!interactionMode || interactionTriggered || handResults.length === 0) {
    return;
  }

  const targetRect = interactionTarget.getBoundingClientRect();
  for (const handResult of handResults) {
    for (const detection of handResult.state.detections) {
      const viewportPoint = canvasPointToViewport(mapLandmark(detection.tip));
      if (isPointInsideRect(viewportPoint, targetRect)) {
        interactionTriggered = true;
        interactionFeedback.textContent = `Clicked by ${handResult.label} ${detection.name}!`;
        interactionFeedback.classList.add("clicked");
        interactionTarget.classList.add("target-hit");
        window.setTimeout(() => {
          interactionTriggered = false;
          interactionFeedback.textContent = "Move a fingertip to the target";
          interactionFeedback.classList.remove("clicked");
          interactionTarget.classList.remove("target-hit");
        }, 1000);
        return;
      }
    }
  }
}

function openInteractionScreen() {
  if (interactionPageButton.disabled) {
    return;
  }

  const href = interactionPageButton.dataset.interactionHref;
  if (href) {
    window.location.href = href;
    return;
  }

  interactionMode = true;
  interactionTriggered = false;
  document.body.classList.add("interaction-mode");
  interactionFeedback.textContent = "Move a fingertip to the target";
  interactionFeedback.classList.remove("clicked");
  interactionTarget.classList.remove("target-hit");
}

function closeInteractionScreen() {
  if (isInteractionPage) {
    return;
  }
  interactionMode = false;
  document.body.classList.remove("interaction-mode");
  interactionFeedback.classList.remove("clicked");
  interactionTarget.classList.remove("target-hit");
}

function updateResults(handResults) {
  const totalExtendedFingers = handResults.reduce(
    (total, result) => total + result.state.extendedCount,
    0,
  );
  const anyIndexExtended = handResults.some((result) => result.state.index.isExtended);

  handState.textContent = String(handResults.length);
  fingerCount.textContent = String(totalExtendedFingers);
  updateDetectionBoxLabel(handResults);
  updateHandSlots(handResults);
  updateHandCards(handResults);
  renderHandResultsTable(handResults);
  updateInteractionAccess(handResults);
  indexResult.textContent = anyIndexExtended ? "Index finger extended" : "Awaiting finger extension";
  indexResult.classList.toggle("detected", anyIndexExtended);
  indexResult.classList.toggle("waiting", !anyIndexExtended);
}

function resetResults() {
  handState.textContent = "0";
  fingerCount.textContent = "0";
  detectionBoxLabel.textContent = "Detection boxes: waiting";
  updateHandSlots([]);
  updateHandCards([]);
  renderHandResultsTable([]);
  updateInteractionAccess([]);
  indexResult.textContent = "Awaiting hand landmarks";
  indexResult.classList.remove("detected");
  indexResult.classList.add("waiting");
}

function restoreCompletedSteps() {
  if (!bothHandsCompleted) {
    return;
  }

  setStep("mediapipe", "done");
  setStep("camera", "done");
  setStep("hand", "done");
  setStep("fingers", "done");
}

function drawNoHandFrame() {
  latestHandResults = [];
  resetResults();
  if (!bothHandsCompleted) {
    setStep("hand", "active");
    setStep("fingers", "");
  }
  restoreCompletedSteps();
  canvasCtx.font = "700 22px monospace";
  canvasCtx.fillStyle = "#ffd166";
  canvasCtx.fillText("Present left hand, right hand, or both hands", 24, 44);
}

function onResults(results) {
  if (!isRunning) {
    return;
  }

  updateVideoRect(results.image);
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  drawVideoFrame(results.image);

  const detectedHands = results.multiHandLandmarks ?? [];
  if (detectedHands.length === 0) {
    drawNoHandFrame();
    canvasCtx.restore();
    return;
  }

  if (bothHandsCompleted) {
    setStep("hand", "done");
    setStep("fingers", "done");
  } else {
    setStep("hand", "done");
    setStep("fingers", "active");
  }

  const handResults = detectedHands.slice(0, 2).map((handLandmarks, index) => {
    const handedness = getHandednessLabel(results, handLandmarks, index);
    const color = HAND_COLORS[handedness] ?? HAND_COLORS.Unknown;
    const label = `${handedness} hand`;
    const box = getHandBoundingBox(handLandmarks);
    const state = detectFingers(handLandmarks);

    drawHandLandmarks(handLandmarks, color);
    drawDetectionBox(box, label, color);
    state.detections.forEach((detection) => drawFingerTip(detection, color));

    return { label, handedness, color, box, state };
  });

  handResults.sort((a, b) => {
    const order = { Left: 0, Right: 1 };
    return (order[a.handedness] ?? 2) - (order[b.handedness] ?? 2);
  });

  latestHandResults = handResults;
  updateResults(handResults);
  checkInteractionTarget(handResults);
  if (bothHandsCompleted) {
    setStep("fingers", "done");
  }
  canvasCtx.restore();
}

function ensureMediaPipeLoaded() {
  if (!window.Hands) {
    throw new Error("MediaPipe Hands is not loaded. Check the network connection.");
  }
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    throw new Error("Camera access requires HTTPS or localhost.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is unavailable. Use localhost or HTTPS in a supported browser.");
  }
}

function createHandsPipeline() {
  const pipeline = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  pipeline.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  pipeline.onResults(onResults);
  return pipeline;
}

async function startCamera() {
  if (isRunning || isInitializing) {
    return;
  }

  try {
    isInitializing = true;
    bothHandsCompleted = false;
    resetSteps();
    resetResults();
    ensureMediaPipeLoaded();
    startButton.disabled = true;
    setStep("mediapipe", "active");
    setStatus("Loading hand detection model...", "initializing");

    hands = hands ?? createHandsPipeline();
    setStep("mediapipe", "done");
    setStep("camera", "active");
    setStatus("Requesting camera access...", "initializing");

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });

    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    await videoElement.play();
    canvasLocked = false;
    resizeCanvasToDisplaySize({ force: true });
    canvasLocked = true;
    updateVideoRect(videoElement);
    isRunning = true;
    document.body.classList.add("camera-running");

    const scheduleFrame = () => {
      if (!isRunning) {
        return;
      }

      if ("requestVideoFrameCallback" in videoElement) {
        videoFrameCallbackId = videoElement.requestVideoFrameCallback(processFrame);
      } else {
        animationFrameId = requestAnimationFrame(processFrame);
      }
    };

    const processFrame = async (now = performance.now()) => {
      if (!isRunning || !hands) {
        return;
      }
      const timestamp = typeof now === "number" ? now : performance.now();

      if (timestamp - lastFrameProcessedAt < FRAME_INTERVAL_MS) {
        scheduleFrame();
        return;
      }

      if (isProcessingFrame || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleFrame();
        return;
      }

      try {
        isProcessingFrame = true;
        lastFrameProcessedAt = timestamp;
        await hands.send({ image: videoElement });
      } catch (error) {
        console.error(error);
        setStatus(`Detection error: ${error.message}`);
      } finally {
        isProcessingFrame = false;
      }
      scheduleFrame();
    };
    scheduleFrame();

    setStep("camera", "done");
    setStep("hand", "active");
    emptyState.classList.add("hidden");
    stopButton.disabled = false;
    setStatus("Camera active. Present left hand, right hand, or both hands.", "ready");
  } catch (error) {
    isRunning = false;
    resetSteps();
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus(`Camera error: ${error.message}`);
    console.error(error);
  } finally {
    isInitializing = false;
  }
}

function stopVideoStream() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (videoFrameCallbackId !== null && "cancelVideoFrameCallback" in videoElement) {
    videoElement.cancelVideoFrameCallback(videoFrameCallbackId);
    videoFrameCallbackId = null;
  }
  isProcessingFrame = false;
  lastFrameProcessedAt = 0;

  const stream = videoElement.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach((track) => track.stop());
  }
  videoElement.srcObject = null;
}

function stopCamera() {
  isRunning = false;
  stopVideoStream();
  canvasLocked = false;
  latestHandResults = [];
  document.body.classList.remove("camera-running");
  if (!isInteractionPage) {
    closeInteractionScreen();
  }
  startButton.disabled = false;
  stopButton.disabled = true;
  emptyState.classList.remove("hidden");
  resetSteps();
  resetResults();
  restoreCompletedSteps();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  setStatus("Camera stream terminated. Press Initialize camera to restart.");
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
interactionPageButton.addEventListener("click", openInteractionScreen);
backButton.addEventListener("click", closeInteractionScreen);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isRunning) {
    if (interactionMode) {
      closeInteractionScreen();
    } else {
      stopCamera();
    }
  }
});

resizeCanvasToDisplaySize();
if (isInteractionPage) {
  document.body.classList.add("interaction-page", "interaction-mode");
}
resetResults();
resetSteps();
