# sao-hand-recognition

Starter code for hand recognition. The browser app locates left and/or right
hands with MediaPipe, labels each hand, detects index fingers first, then reports
all extended fingers.

## Run the website

The public GitHub Pages site is:

<https://crashahuman.github.io/sao-hand-recognition/>

The web app does not need a build step. It uses your browser's camera APIs, so
serve it from `localhost` or HTTPS:

```bash
python3 -m http.server 6463
```

Open <http://localhost:6463>, press **Initialize camera** to turn on the camera,
and show your left hand, right hand, or both hands. The page uses a professional
HUD-style interface with a top title, initialization protocol, camera controls,
a taller live video frame, and live detection results in a separate right-side
panel. The camera image is rendered with a contain/letterbox fit so its full
height remains visible instead of being cropped. Camera startup uses direct
browser `getUserMedia` access and does not start from page clicks. Press
**Terminate stream** or `Esc` to release the webcam.

## Python desktop demo setup

Use Python 3.10 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## Run the Python finger detector

```bash
finger-detector
```

Or run it as a module:

```bash
python -m hand_recognition.webcam
```

Controls:

- Show your left hand, right hand, or both hands to the camera.
- Extend your index finger to see `Index finger detected`.
- Press `q` or `Esc` to quit.

Useful options:

```bash
finger-detector --camera 1 --width 640 --height 480
finger-detector --no-mirror
```

## How it works

- `index.html` serves the GitHub Pages root.
- `web/index.html`, `web/styles.css`, and `web/app.js` provide a browser-based
  hand recognition application that tracks up to two hands and labels them as
  left or right.
- `src/hand_recognition/webcam.py` captures webcam frames and asks MediaPipe for
  21 hand landmarks.
- `src/hand_recognition/finger_detector.py` checks finger joint angles and
  fingertip distance from the wrist. This makes the basic heuristic less
  sensitive to hand rotation than a simple up/down pixel check.
- `detect_index_finger(...)` exposes the first focused step for finger-first
  recognition in Python, while `web/app.js` mirrors that logic for the website.

## Test the detection logic

The core finger-state logic does not need a webcam or MediaPipe to test:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests
```
