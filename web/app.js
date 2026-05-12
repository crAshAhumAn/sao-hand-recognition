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
let hands = null;
let camera = null;
let isRunning = false;

function setStatus(message) {
  statusMessage.textContent = message;
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
        tipIndex,
        tip: landmarks[tipIndex],
        angleDegrees,
        wristToTip,
        wristToBase,
        isExtended,
      };
    },
  );

  const byName = Object.fromEntries(detections.map((detection) => [detection.name, detection]));
  const extendedNames = detections
    .filter((detection) => detection.isExtended)
    .map((detection) => detection.name);

  return {
    detections,
    byName,
    extendedNames,
    extendedCount: extendedNames.length,
    index: byName.index,
  };
}

function resizeCanvasToDisplaySize() {
  const rect = canvasElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvasElement.width !== width || canvasElement.height !== height) {
    canvasElement.width = width;
    canvasElement.height = height;
  }
}

function drawFingerTip(detection) {
  const x = detection.tip.x * canvasElement.width;
  const y = detection.tip.y * canvasElement.height;

  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 9, 0, Math.PI * 2);
  canvasCtx.fillStyle = detection.isExtended ? "#44d7a8" : "rgba(255, 255, 255, 0.55)";
  canvasCtx.fill();

  canvasCtx.font = "600 13px system-ui, sans-serif";
  canvasCtx.fillStyle = detection.isExtended ? "#b9ffe8" : "#d7e2ef";
  canvasCtx.fillText(detection.name, x + 12, y - 10);
}

function updateResults(state) {
  handState.textContent = "Yes";
  fingerCount.textContent = state.extendedCount;
  indexResult.textContent = state.index.isExtended
    ? "Index finger detected"
    : "Index finger not detected";
  indexResult.classList.toggle("detected", state.index.isExtended);
  indexResult.classList.toggle("waiting", !state.index.isExtended);

  for (const detection of state.detections) {
    const item = fingerItems.get(detection.name);
    if (!item) {
      continue;
    }
    item.classList.toggle("active", detection.isExtended);
    item.querySelector("span").textContent = detection.isExtended ? "on" : "off";
  }
}

function resetResults() {
  handState.textContent = "No";
  fingerCount.textContent = "0";
  indexResult.textContent = "Index finger not detected";
  indexResult.classList.remove("detected");
  indexResult.classList.add("waiting");

  for (const item of fingerItems.values()) {
    item.classList.remove("active");
    item.querySelector("span").textContent = "off";
  }
}

function drawNoHandFrame() {
  resetResults();
  canvasCtx.font = "700 22px system-ui, sans-serif";
  canvasCtx.fillStyle = "#ffd99e";
  canvasCtx.fillText("Show one hand to the camera", 24, 44);
}

function onResults(results) {
  if (!isRunning) {
    return;
  }

  resizeCanvasToDisplaySize();
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  const handLandmarks = results.multiHandLandmarks?.[0];
  if (!handLandmarks) {
    drawNoHandFrame();
    canvasCtx.restore();
    return;
  }

  window.drawConnectors?.(canvasCtx, handLandmarks, HAND_CONNECTIONS, {
    color: "#44d7a8",
    lineWidth: 4,
  });
  window.drawLandmarks?.(canvasCtx, handLandmarks, {
    color: "#ffffff",
    lineWidth: 2,
    radius: 3,
  });

  const state = detectFingers(handLandmarks);
  state.detections.forEach(drawFingerTip);
  updateResults(state);
  canvasCtx.restore();
}

function ensureMediaPipeLoaded() {
  if (!window.Hands || !window.Camera) {
    throw new Error("MediaPipe scripts are not loaded. Check your network connection.");
  }
}

function createHandsPipeline() {
  const pipeline = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  pipeline.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });
  pipeline.onResults(onResults);
  return pipeline;
}

async function startCamera() {
  try {
    ensureMediaPipeLoaded();
    startButton.disabled = true;
    setStatus("Starting camera...");

    hands = hands ?? createHandsPipeline();
    camera = new window.Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 1280,
      height: 720,
    });

    isRunning = true;
    await camera.start();
    emptyState.classList.add("hidden");
    stopButton.disabled = false;
    setStatus("Camera is running. Extend your index finger.");
  } catch (error) {
    isRunning = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus(error.message);
    console.error(error);
  }
}

function stopVideoStream() {
  const stream = videoElement.srcObject;
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  videoElement.srcObject = null;
}

function stopCamera() {
  isRunning = false;
  camera?.stop?.();
  camera = null;
  stopVideoStream();
  startButton.disabled = false;
  stopButton.disabled = true;
  emptyState.classList.remove("hidden");
  resetResults();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  setStatus("Camera is off.");
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isRunning) {
    stopCamera();
  }
});

resizeCanvasToDisplaySize();
resetResults();
