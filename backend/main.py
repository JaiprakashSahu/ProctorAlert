"""SmartSession Backend - FastAPI Application with WebSocket routes.

Architecture:
- /health - Health check endpoint
- /ws/student/{student_id} - Receives JPEG frames, processes CV, emits telemetry
- /ws/teacher/{student_id} - Receives telemetry for specific student

CV inference runs in a thread executor to avoid blocking the async event loop.
Frame dropping ensures only the latest frame is processed.
"""

import asyncio
import base64
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from cv_engine import FaceDetector, GazeTracker, ConfusionDetector
from session_manager import SessionManager, StudentSession

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CVPipeline:
    """Thread-safe CV processing pipeline."""
    
    def __init__(self):
        self.face_detector = FaceDetector()
        self.gaze_tracker = GazeTracker()
        self.confusion_detector = ConfusionDetector()
    
    def process_frame(self, frame: np.ndarray, session: StudentSession) -> dict[str, Any]:
        """Run full CV pipeline on a frame. Called from executor thread."""
        face_result = self.face_detector.detect(frame)
        session.update_face_detection(face_result.face_count)
        
        gaze_result = self.gaze_tracker.track(frame)
        session.update_gaze(gaze_result.direction.value)
        
        confusion_result = self.confusion_detector.detect(frame)
        session.update_confusion(confusion_result.confusion_score)
        
        session.compute_status()
        
        return session.get_telemetry()
    
    def close(self):
        self.face_detector.close()
        self.gaze_tracker.close()
        self.confusion_detector.close()


class ConnectionManager:
    """Manages WebSocket connections for students and teachers."""
    
    def __init__(self):
        self.student_connections: dict[str, WebSocket] = {}
        self.teacher_connections: dict[str, list[WebSocket]] = {}
    
    async def connect_student(self, student_id: str, websocket: WebSocket):
        await websocket.accept()
        self.student_connections[student_id] = websocket
        logger.info(f"Student {student_id} connected")
    
    def disconnect_student(self, student_id: str):
        self.student_connections.pop(student_id, None)
        logger.info(f"Student {student_id} disconnected")
    
    async def connect_teacher(self, student_id: str, websocket: WebSocket):
        await websocket.accept()
        if student_id not in self.teacher_connections:
            self.teacher_connections[student_id] = []
        self.teacher_connections[student_id].append(websocket)
        logger.info(f"Teacher connected to student {student_id}")
    
    def disconnect_teacher(self, student_id: str, websocket: WebSocket):
        if student_id in self.teacher_connections:
            try:
                self.teacher_connections[student_id].remove(websocket)
            except ValueError:
                pass
            if not self.teacher_connections[student_id]:
                del self.teacher_connections[student_id]
        logger.info(f"Teacher disconnected from student {student_id}")
    
    async def broadcast_to_teachers(self, student_id: str, message: dict):
        """Send telemetry to all teachers watching this student."""
        if student_id not in self.teacher_connections:
            return
        
        disconnected = []
        for websocket in self.teacher_connections[student_id]:
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(websocket)
        
        for ws in disconnected:
            self.disconnect_teacher(student_id, ws)


cv_pipeline: CVPipeline | None = None
connection_manager = ConnectionManager()
session_manager = SessionManager()
executor = ThreadPoolExecutor(max_workers=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global cv_pipeline
    cv_pipeline = CVPipeline()
    logger.info("CV Pipeline initialized")
    yield
    cv_pipeline.close()
    executor.shutdown(wait=True)
    logger.info("CV Pipeline closed")


app = FastAPI(
    title="SmartSession Backend",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


class FrameBuffer:
    """Ensures only the latest frame is processed, dropping stale frames."""
    
    def __init__(self):
        self._latest_frame: np.ndarray | None = None
        self._lock = asyncio.Lock()
        self._processing = False
    
    async def set_frame(self, frame: np.ndarray) -> bool:
        """Set latest frame. Returns True if frame should be processed."""
        async with self._lock:
            self._latest_frame = frame
            if self._processing:
                return False
            self._processing = True
            return True
    
    async def get_and_clear(self) -> np.ndarray | None:
        """Get latest frame and mark as processing complete."""
        async with self._lock:
            frame = self._latest_frame
            self._latest_frame = None
            self._processing = False
            return frame


def decode_frame(data: str) -> np.ndarray | None:
    """Decode base64 JPEG to numpy array."""
    try:
        if "," in data:
            data = data.split(",")[1]
        
        img_bytes = base64.b64decode(data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return frame
    except Exception as e:
        logger.error(f"Frame decode error: {e}")
        return None


@app.websocket("/ws/student/{student_id}")
async def student_websocket(websocket: WebSocket, student_id: str):
    await connection_manager.connect_student(student_id, websocket)
    session = session_manager.get_or_create(student_id)
    frame_buffer = FrameBuffer()
    
    async def process_latest_frame():
        """Process frames in background without blocking receive loop."""
        while True:
            frame = await frame_buffer.get_and_clear()
            if frame is None:
                await asyncio.sleep(0.05)
                continue
            
            try:
                loop = asyncio.get_event_loop()
                telemetry = await loop.run_in_executor(
                    executor,
                    cv_pipeline.process_frame,
                    frame,
                    session
                )
                await connection_manager.broadcast_to_teachers(student_id, telemetry)
            except Exception as e:
                logger.error(f"CV processing error: {e}")
    
    processor_task = asyncio.create_task(process_latest_frame())
    
    try:
        while True:
            data = await websocket.receive_text()
            frame = decode_frame(data)
            if frame is not None:
                await frame_buffer.set_frame(frame)
    except WebSocketDisconnect:
        logger.info(f"Student {student_id} WebSocket disconnected")
    except Exception as e:
        logger.error(f"Student WebSocket error: {e}")
    finally:
        processor_task.cancel()
        try:
            await processor_task
        except asyncio.CancelledError:
            pass
        connection_manager.disconnect_student(student_id)
        session_manager.remove(student_id)


@app.websocket("/ws/teacher/{student_id}")
async def teacher_websocket(websocket: WebSocket, student_id: str):
    await connection_manager.connect_teacher(student_id, websocket)
    
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(f"Teacher disconnected from {student_id}")
    except Exception as e:
        logger.error(f"Teacher WebSocket error: {e}")
    finally:
        connection_manager.disconnect_teacher(student_id, websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
