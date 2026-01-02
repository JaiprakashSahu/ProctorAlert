"""CV Engine - Gaze Tracking using MediaPipe Face Mesh landmarks."""

import mediapipe as mp
import numpy as np
from enum import Enum
from dataclasses import dataclass


class GazeDirection(str, Enum):
    CENTER = "CENTER"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    UP = "UP"
    DOWN = "DOWN"
    UNKNOWN = "UNKNOWN"


@dataclass
class GazeResult:
    direction: GazeDirection
    horizontal_ratio: float
    vertical_ratio: float


LEFT_EYE_INDICES = [33, 133]
RIGHT_EYE_INDICES = [362, 263]
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473

HORIZONTAL_THRESHOLD = 0.35
VERTICAL_THRESHOLD = 0.3


class GazeTracker:
    def __init__(self):
        self._face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
    
    def track(self, frame: np.ndarray) -> GazeResult:
        """Track gaze direction from a BGR frame."""
        rgb_frame = frame[:, :, ::-1]
        results = self._face_mesh.process(rgb_frame)
        
        if not results.multi_face_landmarks:
            return GazeResult(GazeDirection.UNKNOWN, 0.5, 0.5)
        
        landmarks = results.multi_face_landmarks[0].landmark
        h, w = frame.shape[:2]
        
        left_eye_left = np.array([landmarks[LEFT_EYE_INDICES[0]].x * w, 
                                   landmarks[LEFT_EYE_INDICES[0]].y * h])
        left_eye_right = np.array([landmarks[LEFT_EYE_INDICES[1]].x * w,
                                    landmarks[LEFT_EYE_INDICES[1]].y * h])
        left_iris = np.array([landmarks[LEFT_IRIS_CENTER].x * w,
                               landmarks[LEFT_IRIS_CENTER].y * h])
        
        right_eye_left = np.array([landmarks[RIGHT_EYE_INDICES[0]].x * w,
                                    landmarks[RIGHT_EYE_INDICES[0]].y * h])
        right_eye_right = np.array([landmarks[RIGHT_EYE_INDICES[1]].x * w,
                                     landmarks[RIGHT_EYE_INDICES[1]].y * h])
        right_iris = np.array([landmarks[RIGHT_IRIS_CENTER].x * w,
                                landmarks[RIGHT_IRIS_CENTER].y * h])
        
        left_eye_center = (left_eye_left + left_eye_right) / 2
        right_eye_center = (right_eye_left + right_eye_right) / 2
        
        left_eye_width = np.linalg.norm(left_eye_right - left_eye_left)
        right_eye_width = np.linalg.norm(right_eye_right - right_eye_left)
        
        if left_eye_width < 1 or right_eye_width < 1:
            return GazeResult(GazeDirection.UNKNOWN, 0.5, 0.5)
        
        left_h_ratio = (left_iris[0] - left_eye_left[0]) / left_eye_width
        right_h_ratio = (right_iris[0] - right_eye_left[0]) / right_eye_width
        horizontal_ratio = (left_h_ratio + right_h_ratio) / 2
        
        left_v_offset = left_iris[1] - left_eye_center[1]
        right_v_offset = right_iris[1] - right_eye_center[1]
        avg_eye_height = (left_eye_width + right_eye_width) / 4
        vertical_ratio = ((left_v_offset + right_v_offset) / 2) / avg_eye_height if avg_eye_height > 0 else 0
        
        direction = self._classify_gaze(horizontal_ratio, vertical_ratio)
        
        return GazeResult(direction, horizontal_ratio, vertical_ratio)
    
    def _classify_gaze(self, h_ratio: float, v_ratio: float) -> GazeDirection:
        """Classify gaze based on iris position ratios."""
        if h_ratio < HORIZONTAL_THRESHOLD:
            return GazeDirection.LEFT
        elif h_ratio > (1 - HORIZONTAL_THRESHOLD):
            return GazeDirection.RIGHT
        elif v_ratio < -VERTICAL_THRESHOLD:
            return GazeDirection.UP
        elif v_ratio > VERTICAL_THRESHOLD:
            return GazeDirection.DOWN
        else:
            return GazeDirection.CENTER
    
    def close(self):
        self._face_mesh.close()
