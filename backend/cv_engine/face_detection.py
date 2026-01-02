"""CV Engine - Face Detection using MediaPipe."""

import mediapipe as mp
import numpy as np
from dataclasses import dataclass


@dataclass
class FaceDetectionResult:
    face_count: int
    face_box: tuple[int, int, int, int] | None = None


class FaceDetector:
    def __init__(self, min_detection_confidence: float = 0.5):
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence
        )
    
    def detect(self, frame: np.ndarray) -> FaceDetectionResult:
        """Detect faces in a BGR frame. Returns face count and primary face box."""
        rgb_frame = frame[:, :, ::-1]
        results = self._detector.process(rgb_frame)
        
        if not results.detections:
            return FaceDetectionResult(face_count=0)
        
        face_count = len(results.detections)
        
        if face_count >= 1:
            detection = results.detections[0]
            bbox = detection.location_data.relative_bounding_box
            h, w = frame.shape[:2]
            face_box = (
                int(bbox.xmin * w),
                int(bbox.ymin * h),
                int(bbox.width * w),
                int(bbox.height * h)
            )
            return FaceDetectionResult(face_count=face_count, face_box=face_box)
        
        return FaceDetectionResult(face_count=face_count)
    
    def close(self):
        self._detector.close()
