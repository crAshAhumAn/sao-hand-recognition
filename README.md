# sao-hand-recognition

Starter code for hand recognition. The first milestone is finger detection:
the webcam demo locates a hand with MediaPipe, detects the index finger first,
then reports all extended fingers.

## Setup

Use Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

## Run the finger detector

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

- `src/hand_recognition/webcam.py` captures webcam frames and asks MediaPipe
  for 21 hand landmarks.
- `src/hand_recognition/finger_detector.py` checks finger joint angles and
  fingertip distance from the wrist. This makes the basic heuristic less
  sensitive to hand rotation than a simple up/down pixel check.
- `detect_index_finger(...)` exposes the first focused step for finger-first
  recognition.

## Test the detection logic

The core finger-state logic does not need a webcam or MediaPipe to test:

```bash
PYTHONPATH=src python -m unittest discover -s tests
```