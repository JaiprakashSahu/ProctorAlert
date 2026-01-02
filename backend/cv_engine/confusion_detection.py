"""CV Engine - Confusion Detection using temporal facial landmark analysis.

Confusion is detected via a custom rule-based approach analyzing:
1. Brow Furrowing - Reduced distance between inner eyebrow landmarks
2. Mouth Neutrality - Stable mouth width (no smile)
3. Head Micro-Movements - Small pose changes over time

Scoring uses exponential moving average for temporal smoothing.
Baseline is recalibrated from short-term neutral observations.
"""

import mediapipe as mp
import numpy as np
from dataclasses import dataclass, field
from collections import deque
import time


@dataclass
class ConfusionResult:
    confusion_score: float
    brow_furrow_detected: bool
    smile_detected: bool
    head_tilt_detected: bool


INNER_BROW_LEFT = 107
INNER_BROW_RIGHT = 336
OUTER_BROW_LEFT = 70
OUTER_BROW_RIGHT = 300
MOUTH_LEFT = 61
MOUTH_RIGHT = 291
NOSE_TIP = 1

BROW_FURROW_THRESHOLD = 0.85
SMILE_THRESHOLD = 1.15
HEAD_TILT_VARIANCE_THRESHOLD = 0.002

EMA_ALPHA = 0.3
BASELINE_WINDOW_SECONDS = 5.0
CONFUSION_HYSTERESIS_LOW = 0.4
CONFUSION_HYSTERESIS_HIGH = 0.6


@dataclass
class BaselineState:
    brow_distances: deque = field(default_factory=lambda: deque(maxlen=30))
    mouth_widths: deque = field(default_factory=lambda: deque(maxlen=30))
    head_positions: deque = field(default_factory=lambda: deque(maxlen=30))
    timestamps: deque = field(default_factory=lambda: deque(maxlen=30))
    
    def get_baseline_brow(self) -> float | None:
        if len(self.brow_distances) < 5:
            return None
        return float(np.median(list(self.brow_distances)))
    
    def get_baseline_mouth(self) -> float | None:
        if len(self.mouth_widths) < 5:
            return None
        return float(np.median(list(self.mouth_widths)))
    
    def get_head_variance(self) -> float:
        if len(self.head_positions) < 5:
            return 0.0
        positions = np.array(list(self.head_positions))
        return float(np.var(positions))


class ConfusionDetector:
    def __init__(self):
        self._face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self._confusion_score = 0.0
        self._baseline = BaselineState()
        self._is_calibrating = True
        self._calibration_start = time.time()
    
    def detect(self, frame: np.ndarray) -> ConfusionResult:
        """Analyze frame for confusion indicators."""
        rgb_frame = frame[:, :, ::-1]
        results = self._face_mesh.process(rgb_frame)
        
        if not results.multi_face_landmarks:
            return ConfusionResult(self._confusion_score, False, False, False)
        
        landmarks = results.multi_face_landmarks[0].landmark
        h, w = frame.shape[:2]
        
        brow_left = np.array([landmarks[INNER_BROW_LEFT].x * w, landmarks[INNER_BROW_LEFT].y * h])
        brow_right = np.array([landmarks[INNER_BROW_RIGHT].x * w, landmarks[INNER_BROW_RIGHT].y * h])
        brow_distance = np.linalg.norm(brow_right - brow_left)
        
        mouth_left = np.array([landmarks[MOUTH_LEFT].x * w, landmarks[MOUTH_LEFT].y * h])
        mouth_right = np.array([landmarks[MOUTH_RIGHT].x * w, landmarks[MOUTH_RIGHT].y * h])
        mouth_width = np.linalg.norm(mouth_right - mouth_left)
        
        nose_pos = np.array([landmarks[NOSE_TIP].x, landmarks[NOSE_TIP].y])
        
        now = time.time()
        self._baseline.brow_distances.append(brow_distance)
        self._baseline.mouth_widths.append(mouth_width)
        self._baseline.head_positions.append(nose_pos)
        self._baseline.timestamps.append(now)
        
        if self._is_calibrating:
            if now - self._calibration_start > BASELINE_WINDOW_SECONDS:
                self._is_calibrating = False
            return ConfusionResult(0.0, False, False, False)
        
        baseline_brow = self._baseline.get_baseline_brow()
        baseline_mouth = self._baseline.get_baseline_mouth()
        head_variance = self._baseline.get_head_variance()
        
        brow_furrow_detected = False
        if baseline_brow and baseline_brow > 0:
            brow_ratio = brow_distance / baseline_brow
            brow_furrow_detected = brow_ratio < BROW_FURROW_THRESHOLD
        
        smile_detected = False
        if baseline_mouth and baseline_mouth > 0:
            mouth_ratio = mouth_width / baseline_mouth
            smile_detected = mouth_ratio > SMILE_THRESHOLD
        
        head_tilt_detected = head_variance > HEAD_TILT_VARIANCE_THRESHOLD
        
        score_delta = 0.0
        if brow_furrow_detected:
            score_delta += 0.15
        if head_tilt_detected:
            score_delta += 0.1
        if smile_detected:
            score_delta -= 0.2
        
        target_score = max(0.0, min(1.0, self._confusion_score + score_delta))
        self._confusion_score = (EMA_ALPHA * target_score + 
                                  (1 - EMA_ALPHA) * self._confusion_score)
        self._confusion_score = max(0.0, min(1.0, self._confusion_score))
        
        return ConfusionResult(
            confusion_score=self._confusion_score,
            brow_furrow_detected=brow_furrow_detected,
            smile_detected=smile_detected,
            head_tilt_detected=head_tilt_detected
        )
    
    def reset_baseline(self):
        """Reset baseline for recalibration when student returns to FOCUSED."""
        self._baseline = BaselineState()
        self._is_calibrating = True
        self._calibration_start = time.time()
    
    def close(self):
        self._face_mesh.close()
