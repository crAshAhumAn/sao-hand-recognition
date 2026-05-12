"""Finger-state detection helpers built around MediaPipe hand landmarks.

The functions in this module are intentionally independent of OpenCV and
MediaPipe imports so they can be unit tested with plain Python landmark data.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import acos, degrees, hypot
from typing import Iterable, Sequence


@dataclass(frozen=True)
class Landmark:
    """A normalized hand landmark point.

    MediaPipe provides x, y, and z attributes normalized to the input image.
    This dataclass mirrors that shape for tests and non-MediaPipe callers.
    """

    x: float
    y: float
    z: float = 0.0


@dataclass(frozen=True)
class FingerDetection:
    """Detection details for one finger."""

    name: str
    tip_index: int
    tip: Landmark
    is_extended: bool
    angle_degrees: float
    wrist_to_tip: float
    wrist_to_base: float


@dataclass(frozen=True)
class FingerState:
    """Extended/collapsed state for all five fingers on one hand."""

    thumb: FingerDetection
    index: FingerDetection
    middle: FingerDetection
    ring: FingerDetection
    pinky: FingerDetection

    @property
    def detections(self) -> tuple[FingerDetection, ...]:
        return (self.thumb, self.index, self.middle, self.ring, self.pinky)

    @property
    def extended_names(self) -> tuple[str, ...]:
        return tuple(detection.name for detection in self.detections if detection.is_extended)

    @property
    def extended_count(self) -> int:
        return len(self.extended_names)

    def as_dict(self) -> dict[str, bool]:
        return {detection.name: detection.is_extended for detection in self.detections}


WRIST = 0

# name, proximal joint, middle joint, tip, base distance joint
FINGER_SPECS: tuple[tuple[str, int, int, int, int], ...] = (
    ("thumb", 2, 3, 4, 2),
    ("index", 5, 6, 8, 6),
    ("middle", 9, 10, 12, 10),
    ("ring", 13, 14, 16, 14),
    ("pinky", 17, 18, 20, 18),
)


def normalize_landmarks(landmarks: Sequence[object]) -> list[Landmark]:
    """Convert MediaPipe-style landmark objects into ``Landmark`` instances."""

    if len(landmarks) < 21:
        raise ValueError(f"Expected at least 21 hand landmarks, got {len(landmarks)}")

    normalized: list[Landmark] = []
    for landmark in landmarks:
        try:
            normalized.append(
                Landmark(
                    x=float(getattr(landmark, "x")),
                    y=float(getattr(landmark, "y")),
                    z=float(getattr(landmark, "z", 0.0)),
                )
            )
        except (TypeError, ValueError) as exc:
            raise ValueError("Landmarks must expose numeric x, y, and optional z attributes") from exc
    return normalized


def distance(point_a: Landmark, point_b: Landmark) -> float:
    """Return Euclidean distance in normalized image coordinates."""

    return hypot(point_a.x - point_b.x, point_a.y - point_b.y)


def joint_angle_degrees(point_a: Landmark, joint: Landmark, point_c: Landmark) -> float:
    """Return the angle made by point_a -> joint -> point_c."""

    vector_a = (point_a.x - joint.x, point_a.y - joint.y)
    vector_c = (point_c.x - joint.x, point_c.y - joint.y)
    magnitude_a = hypot(*vector_a)
    magnitude_c = hypot(*vector_c)
    if magnitude_a == 0.0 or magnitude_c == 0.0:
        return 0.0

    cosine = (vector_a[0] * vector_c[0] + vector_a[1] * vector_c[1]) / (magnitude_a * magnitude_c)
    clamped = max(-1.0, min(1.0, cosine))
    return degrees(acos(clamped))


def detect_fingers(
    landmarks: Sequence[object],
    *,
    min_angle_degrees: float = 150.0,
    distance_margin: float = 0.03,
) -> FingerState:
    """Detect which fingers are extended for one hand.

    A finger is considered extended when its primary joint is nearly straight
    and its tip is farther from the wrist than the comparison base joint. This
    keeps the heuristic independent of hand rotation in the camera frame.
    """

    points = normalize_landmarks(landmarks)
    wrist = points[WRIST]
    detections: list[FingerDetection] = []

    for name, proximal_index, joint_index, tip_index, base_index in FINGER_SPECS:
        angle = joint_angle_degrees(
            points[proximal_index],
            points[joint_index],
            points[tip_index],
        )
        wrist_to_tip = distance(wrist, points[tip_index])
        wrist_to_base = distance(wrist, points[base_index])
        is_extended = angle >= min_angle_degrees and wrist_to_tip > wrist_to_base + distance_margin
        detections.append(
            FingerDetection(
                name=name,
                tip_index=tip_index,
                tip=points[tip_index],
                is_extended=is_extended,
                angle_degrees=angle,
                wrist_to_tip=wrist_to_tip,
                wrist_to_base=wrist_to_base,
            )
        )

    thumb, index, middle, ring, pinky = detections
    return FingerState(thumb=thumb, index=index, middle=middle, ring=ring, pinky=pinky)


def detect_index_finger(landmarks: Sequence[object]) -> FingerDetection:
    """Detect the index finger first, as a focused starting point."""

    return detect_fingers(landmarks).index


def count_extended_fingers(landmarks: Sequence[object]) -> int:
    """Return the number of extended fingers on one detected hand."""

    return detect_fingers(landmarks).extended_count


def describe_extended_fingers(detections: Iterable[FingerDetection]) -> str:
    """Create a compact label for UI overlays."""

    extended = [detection.name for detection in detections if detection.is_extended]
    return ", ".join(extended) if extended else "none"
