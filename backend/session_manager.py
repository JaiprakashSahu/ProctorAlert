"""Session Manager - Per-student session state management.

Tracks:
- Gaze history with timestamps for proctor alert detection
- Confusion score with temporal smoothing
- Face detection status with grace period
- Overall session status
"""

import time
from dataclasses import dataclass, field
from collections import deque
from enum import Enum
from typing import Any


class SessionStatus(str, Enum):
    FOCUSED = "FOCUSED"
    CONFUSED = "CONFUSED"
    PROCTOR_ALERT = "PROCTOR_ALERT"


@dataclass
class GazeEntry:
    direction: str
    timestamp: float


GAZE_ALERT_THRESHOLD_SECONDS = 4.0
FACE_LOSS_GRACE_PERIOD_SECONDS = 2.0
CONFUSION_THRESHOLD = 0.6
CONFUSION_DURATION_SECONDS = 3.0
FOCUSED_THRESHOLD = 0.4
FOCUSED_DURATION_SECONDS = 2.0


@dataclass 
class StudentSession:
    student_id: str
    gaze_history: deque = field(default_factory=lambda: deque(maxlen=60))
    confusion_scores: deque = field(default_factory=lambda: deque(maxlen=60))
    last_face_detected: float = field(default_factory=time.time)
    last_face_count: int = 1
    current_status: SessionStatus = SessionStatus.FOCUSED
    status_start_time: float = field(default_factory=time.time)
    confusion_start_time: float | None = None
    focused_start_time: float | None = None
    
    def update_face_detection(self, face_count: int) -> None:
        """Update face detection state with grace period logic."""
        now = time.time()
        if face_count == 1:
            self.last_face_detected = now
        self.last_face_count = face_count
    
    def update_gaze(self, direction: str) -> None:
        """Add gaze direction to history."""
        self.gaze_history.append(GazeEntry(direction=direction, timestamp=time.time()))
    
    def update_confusion(self, score: float) -> None:
        """Add confusion score to history."""
        self.confusion_scores.append((score, time.time()))
    
    def check_gaze_alert(self) -> bool:
        """Check if gaze has been non-CENTER for longer than threshold."""
        if not self.gaze_history:
            return False
        
        now = time.time()
        non_center_start: float | None = None
        
        for entry in reversed(self.gaze_history):
            if entry.direction == "CENTER":
                break
            if non_center_start is None:
                non_center_start = entry.timestamp
        
        if non_center_start is None:
            return False
        
        non_center_duration = now - non_center_start
        return non_center_duration >= GAZE_ALERT_THRESHOLD_SECONDS
    
    def check_face_alert(self) -> bool:
        """Check if face count is invalid beyond grace period."""
        if self.last_face_count == 1:
            return False
        
        now = time.time()
        time_since_valid_face = now - self.last_face_detected
        return time_since_valid_face >= FACE_LOSS_GRACE_PERIOD_SECONDS
    
    def get_avg_confusion(self) -> float:
        """Get average confusion score from recent history."""
        if not self.confusion_scores:
            return 0.0
        
        now = time.time()
        recent = [(s, t) for s, t in self.confusion_scores if now - t < 5.0]
        if not recent:
            return 0.0
        return sum(s for s, _ in recent) / len(recent)
    
    def compute_status(self) -> SessionStatus:
        """Compute current session status with hysteresis."""
        now = time.time()
        
        if self.check_face_alert() or self.check_gaze_alert():
            self.current_status = SessionStatus.PROCTOR_ALERT
            self.confusion_start_time = None
            self.focused_start_time = None
            return self.current_status
        
        avg_confusion = self.get_avg_confusion()
        
        if avg_confusion >= CONFUSION_THRESHOLD:
            if self.confusion_start_time is None:
                self.confusion_start_time = now
            elif now - self.confusion_start_time >= CONFUSION_DURATION_SECONDS:
                self.current_status = SessionStatus.CONFUSED
            self.focused_start_time = None
        elif avg_confusion <= FOCUSED_THRESHOLD:
            if self.focused_start_time is None:
                self.focused_start_time = now
            elif now - self.focused_start_time >= FOCUSED_DURATION_SECONDS:
                self.current_status = SessionStatus.FOCUSED
            self.confusion_start_time = None
        
        return self.current_status
    
    def get_telemetry(self) -> dict[str, Any]:
        """Generate telemetry object for teacher dashboard."""
        return {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "student_id": self.student_id,
            "face_count": self.last_face_count,
            "gaze": self.gaze_history[-1].direction if self.gaze_history else "UNKNOWN",
            "confusion_score": round(self.get_avg_confusion(), 2),
            "status": self.current_status.value
        }


class SessionManager:
    """Manages all active student sessions."""
    
    def __init__(self):
        self._sessions: dict[str, StudentSession] = {}
    
    def get_or_create(self, student_id: str) -> StudentSession:
        """Get existing session or create new one."""
        if student_id not in self._sessions:
            self._sessions[student_id] = StudentSession(student_id=student_id)
        return self._sessions[student_id]
    
    def remove(self, student_id: str) -> None:
        """Remove session when student disconnects."""
        self._sessions.pop(student_id, None)
    
    def get_session(self, student_id: str) -> StudentSession | None:
        """Get session by ID without creating."""
        return self._sessions.get(student_id)
