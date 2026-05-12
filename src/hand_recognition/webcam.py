"""Webcam demo for finger detection."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from .finger_detector import FingerDetection, FingerState, describe_extended_fingers, detect_fingers


def _load_runtime_dependencies():
    try:
        import cv2
        import mediapipe as mp
    except ImportError as exc:
        raise SystemExit(
            "Missing runtime dependencies. Install them with: "
            "python -m pip install -e ."
        ) from exc
    return cv2, mp


def _landmark_to_pixel(tip: object, width: int, height: int) -> tuple[int, int]:
    return int(getattr(tip, "x") * width), int(getattr(tip, "y") * height)


def _draw_finger_tip(cv2, frame, detection: FingerDetection, width: int, height: int) -> None:
    x, y = _landmark_to_pixel(detection.tip, width, height)
    color = (0, 255, 0) if detection.is_extended else (130, 130, 130)
    cv2.circle(frame, (x, y), 9, color, -1)
    cv2.putText(
        frame,
        detection.name,
        (x + 8, y - 8),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        color,
        1,
        cv2.LINE_AA,
    )


def _draw_status(cv2, frame, state: FingerState) -> None:
    if state.index.is_extended:
        status = "Index finger detected"
        color = (0, 255, 0)
    else:
        status = "Show/extend your index finger"
        color = (0, 180, 255)

    cv2.putText(frame, status, (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2, cv2.LINE_AA)
    cv2.putText(
        frame,
        f"Extended: {state.extended_count} ({describe_extended_fingers(state.detections)})",
        (16, 64),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )


def _draw_detections(cv2, frame, state: FingerState) -> None:
    height, width = frame.shape[:2]
    for detection in state.detections:
        _draw_finger_tip(cv2, frame, detection, width, height)
    _draw_status(cv2, frame, state)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect extended fingers from a webcam feed.")
    parser.add_argument("--camera", type=int, default=0, help="Camera index to open.")
    parser.add_argument("--width", type=int, default=1280, help="Requested capture width.")
    parser.add_argument("--height", type=int, default=720, help="Requested capture height.")
    parser.add_argument(
        "--max-hands",
        type=int,
        default=1,
        help="Maximum number of hands to track.",
    )
    parser.add_argument(
        "--min-detection-confidence",
        type=float,
        default=0.7,
        help="Minimum confidence for initial hand detection.",
    )
    parser.add_argument(
        "--min-tracking-confidence",
        type=float,
        default=0.6,
        help="Minimum confidence for landmark tracking.",
    )
    parser.add_argument(
        "--no-mirror",
        action="store_true",
        help="Disable selfie-style horizontal mirroring.",
    )
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cv2, mp = _load_runtime_dependencies()

    capture = cv2.VideoCapture(args.camera)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    if not capture.isOpened():
        raise SystemExit(f"Unable to open camera index {args.camera}")

    drawing = mp.solutions.drawing_utils
    drawing_styles = mp.solutions.drawing_styles
    hands_solution = mp.solutions.hands

    with hands_solution.Hands(
        max_num_hands=args.max_hands,
        min_detection_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
    ) as hands:
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            if not args.no_mirror:
                frame = cv2.flip(frame, 1)

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb_frame.flags.writeable = False
            result = hands.process(rgb_frame)
            rgb_frame.flags.writeable = True

            if result.multi_hand_landmarks:
                for hand_landmarks in result.multi_hand_landmarks:
                    drawing.draw_landmarks(
                        frame,
                        hand_landmarks,
                        hands_solution.HAND_CONNECTIONS,
                        drawing_styles.get_default_hand_landmarks_style(),
                        drawing_styles.get_default_hand_connections_style(),
                    )
                    state = detect_fingers(hand_landmarks.landmark)
                    _draw_detections(cv2, frame, state)
            else:
                cv2.putText(
                    frame,
                    "No hand detected",
                    (16, 32),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 180, 255),
                    2,
                    cv2.LINE_AA,
                )

            cv2.imshow("Finger detector", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break

    capture.release()
    cv2.destroyAllWindows()
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
