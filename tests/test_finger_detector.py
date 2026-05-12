import unittest

from hand_recognition.finger_detector import (
    Landmark,
    count_extended_fingers,
    detect_fingers,
    detect_index_finger,
    joint_angle_degrees,
)


def make_landmarks_with_index_extended() -> list[Landmark]:
    landmarks = [Landmark(0.5, 0.8) for _ in range(21)]

    landmarks[0] = Landmark(0.5, 0.9)

    landmarks[2] = Landmark(0.40, 0.76)
    landmarks[3] = Landmark(0.38, 0.73)
    landmarks[4] = Landmark(0.44, 0.74)

    landmarks[5] = Landmark(0.50, 0.62)
    landmarks[6] = Landmark(0.50, 0.42)
    landmarks[8] = Landmark(0.50, 0.18)

    landmarks[9] = Landmark(0.58, 0.64)
    landmarks[10] = Landmark(0.58, 0.45)
    landmarks[12] = Landmark(0.58, 0.60)

    landmarks[13] = Landmark(0.65, 0.65)
    landmarks[14] = Landmark(0.65, 0.48)
    landmarks[16] = Landmark(0.65, 0.61)

    landmarks[17] = Landmark(0.72, 0.67)
    landmarks[18] = Landmark(0.72, 0.52)
    landmarks[20] = Landmark(0.72, 0.63)

    return landmarks


class FingerDetectorTest(unittest.TestCase):
    def test_joint_angle_degrees_returns_expected_angle(self) -> None:
        angle = joint_angle_degrees(
            Landmark(0.0, 1.0),
            Landmark(0.0, 0.0),
            Landmark(1.0, 0.0),
        )

        self.assertAlmostEqual(angle, 90.0)

    def test_detect_index_finger_first(self) -> None:
        detection = detect_index_finger(make_landmarks_with_index_extended())

        self.assertEqual(detection.name, "index")
        self.assertTrue(detection.is_extended)
        self.assertEqual(detection.tip_index, 8)

    def test_detect_fingers_reports_only_index_extended(self) -> None:
        state = detect_fingers(make_landmarks_with_index_extended())

        self.assertEqual(state.extended_names, ("index",))
        self.assertEqual(state.extended_count, 1)
        self.assertEqual(
            state.as_dict(),
            {
                "thumb": False,
                "index": True,
                "middle": False,
                "ring": False,
                "pinky": False,
            },
        )

    def test_count_extended_fingers(self) -> None:
        self.assertEqual(count_extended_fingers(make_landmarks_with_index_extended()), 1)

    def test_rejects_incomplete_landmark_set(self) -> None:
        with self.assertRaises(ValueError):
            detect_fingers([Landmark(0.0, 0.0)])


if __name__ == "__main__":
    unittest.main()
