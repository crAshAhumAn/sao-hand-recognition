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
const stepItems = new Map(
  Array.from(document.querySelectorAll("[data-step]")).map((item) => [item.dataset.step, item]),
);
const handSlotItems = new Map(
  Array.from(document.querySelectorAll("[data-hand-slot]")).map((item) => [
    item.dataset.handSlot,
    item,
  ]), 
); 
const fingerItems = new Map(
  Array.from(document.querySelectorAll("[data-finger]")).map((item) => [
    item.dataset.finger,
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

let hands = null;
let isRunning = false;
let isInitializing = false;
let animationFrameId = null;

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
    x: minX * canvasElement.width,
    y: minY * canvasElement.height,
    width: (maxX - minX) * canvasElement.width,
    height: (maxY - minY) * canvasElement.height,
    normalized: { minX, minY, maxX, maxY },
  };
}

function getHandednessLabel(results, handLandmarks, index) {
  const handedness = results.multiHandedness?.[index];
  const label =
    handedness?.label ?? handedness?.classification?.[0]?.label ?? handedness?.[0]?.label;

  if (label === "Left" || label === "Right") {
    return MIRRORED_HANDEDNESS[label];
  }

  return handLandmarks[0]?.x < 0.5 ? "Right" : "Left";
}

function resizeCanvasToDisplaySize() {
  if (!video) return;
  
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (canvasElement.width !== width || canvasElement.height !== height) {
    canvasElement.width = width;
    canvasElement.height = height;
  }
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
  const x = detection.tip.x * canvasElement.width;
  const y = detection.tip.y * canvasElement.height;
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

  handResults.forEach((result) => handsList.append(createHandCard(result)));
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
  indexResult.textContent = anyIndexExtended
    ? "Index finger extended"
    : "Index finger state: not detected";
  indexResult.classList.toggle("detected", anyIndexExtended);
  indexResult.classList.toggle("waiting", !anyIndexExtended);

  for (const [fingerName, item] of fingerItems.entries()) {
    const matchingDetections = handResults
      .map((result) => result.state.byName[fingerName])
      .filter(Boolean);
    const activeCount = matchingDetections.filter((detection) => detection.isExtended).length;
    const maxAngle = matchingDetections.length
      ? Math.max(...matchingDetections.map((detection) => detection.angleDegrees))
      : null;

    item.classList.toggle("active", activeCount > 0);
    item.querySelector(".finger-state").textContent =
      handResults.length === 0 ? "off" : `${activeCount}/${handResults.length} on`;
    item.querySelector(".finger-angle").textContent =
      maxAngle === null ? "Angle: --" : `Angle: ${Math.round(maxAngle)} deg`;
  }
}

function resetResults() {
  handState.textContent = "0";
  fingerCount.textContent = "0";
  detectionBoxLabel.textContent = "Detection boxes: waiting";
  updateHandSlots([]);
  updateHandCards([]);
  indexResult.textContent = "Index finger state: not detected";
  indexResult.classList.remove("detected");
  indexResult.classList.add("waiting");

  for (const item of fingerItems.values()) {
    item.classList.remove("active");
    item.querySelector(".finger-state").textContent = "off";
    item.querySelector(".finger-angle").textContent = "Angle: --";
  }
}

function drawNoHandFrame() {
  resetResults();
  setStep("hand", "active");
  setStep("fingers", "");
  canvasCtx.font = "700 22px monospace";
  canvasCtx.fillStyle = "#ffd166";
  canvasCtx.fillText("Present left hand, right hand, or both hands", 24, 44);
}

function onResults(results) {
  if (!isRunning) {
    return;
  }

  resizeCanvasToDisplaySize(results.image);
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, results.image.videoWidth || results.image.width, results.image.videoHeight || results.image.height, canvasElement.width, canvasElement.height);

  const detectedHands = results.multiHandLandmarks ?? [];
  if (detectedHands.length === 0) {
    drawNoHandFrame();
    canvasCtx.restore();
    return;
  }

  setStep("hand", "done");
  setStep("fingers", "active");

  const handResults = detectedHands.slice(0, 2).map((handLandmarks, index) => {
    const handedness = getHandednessLabel(results, handLandmarks, index);
    const color = HAND_COLORS[handedness] ?? HAND_COLORS.Unknown;
    const label = `${handedness} hand`;
    const box = getHandBoundingBox(handLandmarks);
    const state = detectFingers(handLandmarks);

    window.drawConnectors?.(canvasCtx, handLandmarks, HAND_CONNECTIONS, {
      color,
      lineWidth: 4,
    });
    window.drawLandmarks?.(canvasCtx, handLandmarks, {
      color: "#ffffff",
      lineWidth: 2,
      radius: 3,
    });
    drawDetectionBox(box, label, color);
    state.detections.forEach((detection) => drawFingerTip(detection, color));

    return { label, handedness, color, box, state };
  });

  handResults.sort((a, b) => {
    const order = { Left: 0, Right: 1 };
    return (order[a.handedness] ?? 2) - (order[b.handedness] ?? 2);
  });

  updateResults(handResults);
  setStep("fingers", "done");
  canvasCtx.restore();
}

function ensureMediaPipeLoaded() {
  if (!window.Hands) {
    throw new Error("MediaPipe Hands is not loaded. Check the network connection.");
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
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
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

    videoElement.srcObject = stream;
    videoElement.muted = true;
    await videoElement.play();
    isRunning = true;

    const processFrame = async () => {
      if (!isRunning || !hands) {
        return;
      }
      if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        await hands.send({ image: videoElement });
      }
      animationFrameId = requestAnimationFrame(processFrame);
    };
    animationFrameId = requestAnimationFrame(processFrame);

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

  const stream = videoElement.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach((track) => track.stop());
  }
  videoElement.srcObject = null;
}

function stopCamera() {
  isRunning = false;
  stopVideoStream();
  startButton.disabled = false;
  stopButton.disabled = true;
  emptyState.classList.remove("hidden");
  resetSteps();
  resetResults();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  setStatus("Camera stream terminated. Press Initialize camera to restart.");
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isRunning) {
    stopCamera();
  }
});
window.addEventListener("resize", resizeCanvasToDisplaySize);

resizeCanvasToDisplaySize(results.image);
resetResults();
resetSteps();
