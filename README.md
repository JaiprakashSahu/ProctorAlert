# SmartSession

Real-time student engagement monitoring platform with transparent, rule-based computer vision analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SmartSession                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐         WebSocket          ┌──────────────────┐   │
│  │  Student Portal  │ ──────────────────────────▶│    FastAPI       │   │
│  │  (Vanilla TS)    │     JPEG frames            │    Backend       │   │
│  │                  │     ~250ms interval        │                  │   │
│  └──────────────────┘                            │  ┌────────────┐  │   │
│                                                   │  │ CV Engine  │  │   │
│  ┌──────────────────┐         WebSocket          │  │ MediaPipe  │  │   │
│  │ Teacher Dashboard│ ◀──────────────────────────│  │ + OpenCV   │  │   │
│  │  (Vanilla TS)    │     Telemetry JSON         │  └────────────┘  │   │
│  └──────────────────┘     (per-student scope)    │                  │   │
│                                                   │  ┌────────────┐  │   │
│                                                   │  │  Session   │  │   │
│                                                   │  │  Manager   │  │   │
│                                                   │  └────────────┘  │   │
│                                                   └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Student Browser** → Webcam capture → Downscale to 640×480 → JPEG encode → WebSocket
2. **Backend** → Receive frame → CV Pipeline (face → gaze → confusion) → Update session
3. **Backend** → Emit telemetry JSON to teachers subscribed to that student
4. **Teacher Dashboard** → Render status badge + update timeline chart

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- Webcam

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:
- Student Portal: http://localhost:5173/student
- Teacher Dashboard: http://localhost:5173/teacher

## Confusion Detection Logic

This system uses a **custom, rule-based approach** — NOT a pretrained emotion classifier.

### Signals Analyzed

| Signal | Detection Method | Rationale |
|--------|------------------|-----------|
| **Brow Furrowing** | Distance between inner eyebrow landmarks (107, 336) | Reduced distance indicates strain/concentration |
| **Mouth Neutrality** | Mouth width stability (landmarks 61, 291) | No smile = lack of positive engagement |
| **Head Micro-Movements** | Nose tip position variance over time | Repeated tilts suggest cognitive effort |

### Scoring Algorithm

```python
# Short-term neutral baseline recalibrated when the student is in a FOCUSED state.
# This avoids bias from natural facial structure differences.

confusion_score = 0.0

# Increase score for confusion indicators
if brow_distance < baseline * 0.85:
    confusion_score += 0.15
if head_tilt_variance > threshold:
    confusion_score += 0.1

# Decrease score for positive indicators
if smile_detected:
    confusion_score -= 0.2

# Temporal smoothing (EMA α=0.3)
confusion_score = 0.3 * new_score + 0.7 * previous_score

# Status with hysteresis to prevent flicker
if score > 0.6 for 3 seconds → CONFUSED
if score < 0.4 for 2 seconds → FOCUSED
```

### Why This Approach?

- **Explainable**: Every decision can be traced to specific landmark measurements
- **No Black Box**: No opaque neural network predictions
- **Adaptive**: Short-term neutral baseline is recalibrated when FOCUSED, handling natural facial variation
- **Robust**: Temporal smoothing + hysteresis prevents false positives from transient expressions

## Proctoring Rules

| Condition | Detection | Threshold | Result |
|-----------|-----------|-----------|--------|
| No face | `face_count == 0` | 2s grace period | PROCTOR_ALERT |
| Multiple faces | `face_count > 1` | 2s grace period | PROCTOR_ALERT |
| Looking away | `gaze ≠ CENTER` | 4 seconds | PROCTOR_ALERT |

## Design Trade-offs

| Decision | Rationale |
|----------|-----------|
| **Rule-based CV over deep learning** | Ensures explainability and debuggability; every decision traceable to landmark measurements |
| **JPEG frame streaming over raw video** | Reduces bandwidth (~30KB/frame vs ~1MB raw); sufficient for facial landmark extraction |
| **Single-instance backend** | Maintains WebSocket state consistency; avoids distributed state complexity for MVP |
| **Temporal smoothing + hysteresis** | Avoids noisy, frame-level decisions; patterns emerge over 3-5 second windows |
| **Vanilla TypeScript frontend** | Keeps media capture and WebSocket logic explicit; no framework abstraction |
| **Per-student teacher subscriptions** | Teachers subscribe to specific students, avoiding broadcast scaling issues |

## Technical Decisions

### Non-Blocking CV Inference

CPU-bound CV inference is isolated from the async WebSocket loop using `run_in_executor()`:

```python
telemetry = await loop.run_in_executor(
    executor,
    cv_pipeline.process_frame,
    frame,
    session
)
```

This prevents latency spikes during video processing.

### Frame Dropping

A lightweight in-memory frame buffer ensures that only the most recent frame is processed, preventing backlog under high load:

```python
class FrameBuffer:
    async def set_frame(self, frame) -> bool:
        # Returns False if already processing
        # Only latest frame is kept
```

This prevents memory buildup and latency drift. The backend prioritizes freshness over completeness.

### Timeline Memory Limit

Dashboard stores max 180 data points (~3 minutes at 1s resolution) to bound memory usage.

## API Reference

### WebSocket Endpoints

| Endpoint | Direction | Payload |
|----------|-----------|---------|
| `/ws/student/{student_id}` | Client → Server | Base64 JPEG frame |
| `/ws/teacher/{student_id}` | Server → Client | Telemetry JSON |

### Telemetry Object

```json
{
  "timestamp": "2026-01-02T07:38:25.000Z",
  "student_id": "student_abc123",
  "face_count": 1,
  "gaze": "CENTER",
  "confusion_score": 0.42,
  "status": "FOCUSED"
}
```

Status values: `FOCUSED`, `CONFUSED`, `PROCTOR_ALERT`

### Health Check

```
GET /health → { "status": "ok" }
```

## Deployment

### Docker (Recommended)

```bash
cd backend
docker build -t smartsession-backend .
docker run -p 8000:8000 smartsession-backend
```

### Fly.io

```bash
cd backend
flyctl launch
flyctl deploy
```

### Frontend (Vercel/Netlify)

Set environment variable:
```
VITE_WS_BASE_URL=wss://your-backend-url.fly.dev
```

## Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Camera permission denied | Clear error message with retry button |
| Camera disconnected | Detect stream end, show reconnect UI |
| WebSocket disconnect | Auto-reconnect with exponential backoff |
| Temporary face loss | 2-second grace period before alert |
| Tab minimized | Pause frame capture, resume on focus |

## Project Structure

```
SmartSession/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket routes
│   ├── session_manager.py   # Per-student session state
│   ├── cv_engine/
│   │   ├── face_detection.py
│   │   ├── gaze_tracking.py
│   │   └── confusion_detection.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.ts             # Entry point + routing
│   │   ├── student.ts          # Student Portal
│   │   ├── teacher.ts          # Teacher Dashboard
│   │   ├── websocket.ts        # WebSocket manager
│   │   └── styles.css          # Design system
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
└── README.md
```

## Limitations

This MVP is designed for single-student sessions and does not yet include multi-student classroom aggregation, persistent session storage, or horizontal scaling across multiple backend instances.

## License

MIT
