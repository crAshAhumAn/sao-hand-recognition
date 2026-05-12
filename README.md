# sao-hand-recognition

Starter code for hand recognition. The first milestone is finger detection:
the browser app locates a hand with MediaPipe, detects the index finger first,
then reports all extended fingers.

## Run the website

The public GitHub Pages site is:

<https://crashahuman.github.io/sao-hand-recognition/>

The web app is in `web/` and does not need a build step. It uses your browser's
camera APIs, so serve it from `localhost` or HTTPS:

```bash
python3 -m http.server --directory web 8000
```

Open <http://localhost:8000>, click anywhere on the page to initialize the
camera, and show one hand. The page displays initialization steps, the live
finger configuration, and a detection box around the hand captured by the
camera. Press **Stop camera** or `Esc` to release the webcam.

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

- Show one hand to the camera.
- Extend your index finger to see `Index finger detected`.
- Press `q` or `Esc` to quit.

Useful options:

```bash
finger-detector --camera 1 --width 640 --height 480
finger-detector --no-mirror
```

## How it works

- `web/index.html`, `web/styles.css`, and `web/app.js` provide a browser-based
  hand recognition application.
- `src/hand_recognition/webcam.py` captures webcam frames and asks MediaPipe
  for 21 hand landmarks.
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