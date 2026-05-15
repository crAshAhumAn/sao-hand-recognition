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
const stepItems = new Map(
  Array.from(document.querySelectorAll("[data-step]")).map((item) => [
    item.dataset.step,
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
let hands = null;
let camera = null;
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

function drawDetectionBox(box) {
  canvasCtx.save();
  canvasCtx.strokeStyle = "#44d7a8";
  canvasCtx.lineWidth = 4;
  canvasCtx.shadowColor = "rgba(68, 215, 168, 0.85)";
  canvasCtx.shadowBlur = 16;
  canvasCtx.strokeRect(box.x, box.y, box.width, box.height);
  canvasCtx.shadowBlur = 0;
  canvasCtx.fillStyle = "rgba(4, 18, 14, 0.82)";
  canvasCtx.fillRect(box.x, Math.max(0, box.y - 30), 154, 26);
  canvasCtx.fillStyle = "#b9ffe8";
  canvasCtx.font = "700 14px system-ui, sans-serif";
  canvasCtx.fillText("Hand detected", box.x + 10, Math.max(18, box.y - 11));
  canvasCtx.restore();
}

function updateDetectionBoxLabel(box) {
  const { minX, minY, maxX, maxY } = box.normalized;
  detectionBoxLabel.textContent =
    `Detection box: x ${minX.toFixed(2)}-${maxX.toFixed(2)}, ` +
    `y ${minY.toFixed(2)}-${maxY.toFixed(2)}`;
}

function updateResults(state, box) {
  handState.textContent = "Yes";
  fingerCount.textContent = state.extendedCount;
  updateDetectionBoxLabel(box);
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
    item.querySelector(".finger-state").textContent = detection.isExtended ? "on" : "off";
    item.querySelector(".finger-angle").textContent =
      `Angle: ${Math.round(detection.angleDegrees)} deg`;
  }
}

function resetResults() {
  handState.textContent = "No";
  fingerCount.textContent = "0";
  detectionBoxLabel.textContent = "Detection box: waiting";
  indexResult.textContent = "Index finger not detected";
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

  setStep("hand", "done");
  setStep("fingers", "active");
  window.drawConnectors?.(canvasCtx, handLandmarks, HAND_CONNECTIONS, {
    color: "#44d7a8",
    lineWidth: 4,
  });
  window.drawLandmarks?.(canvasCtx, handLandmarks, {
    color: "#ffffff",
    lineWidth: 2,
    radius: 3,
  });

  const box = getHandBoundingBox(handLandmarks);
  drawDetectionBox(box);
  const state = detectFingers(handLandmarks);
  state.detections.forEach(drawFingerTip);
  updateResults(state, box);
  setStep("fingers", "done");
  canvasCtx.restore();
}

function ensureMediaPipeLoaded() {
  if (!window.Hands) {
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
    setStatus("Initializing MediaPipe hand model...", "initializing");

    hands = hands ?? createHandsPipeline();
    setStep("mediapipe", "done");
    setStep("camera", "active");
    setStatus("Waiting for camera permission...", "initializing");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });

    videoElement.srcObject = stream;
    await videoElement.play();
    isRunning = true;
    camera = {
      stop() {
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      },
    };

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
    setStatus("Camera is running. Show your hand inside the frame.", "ready");
  } catch (error) {
    isRunning = false;
    resetSteps();
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus(error.message);
    console.error(error);
  } finally {
    isInitializing = false;
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
  resetSteps();
  resetResults();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  setStatus("Press Initialize camera to begin.");
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
resetSteps();
