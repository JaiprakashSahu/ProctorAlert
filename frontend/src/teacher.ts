import { WebSocketManager } from './websocket';

const MAX_TIMELINE_POINTS = 180;

interface TelemetryData {
    timestamp: string;
    student_id: string;
    face_count: number;
    gaze: string;
    confusion_score: number;
    status: 'FOCUSED' | 'CONFUSED' | 'PROCTOR_ALERT';
}

interface TimelinePoint {
    status: string;
    timestamp: string;
}

export class TeacherDashboard {
    private container: HTMLElement;
    private studentId: string = '';
    private wsManager: WebSocketManager;
    private wsStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
    private telemetry: TelemetryData | null = null;
    private timeline: TimelinePoint[] = [];
    private chartCanvas: HTMLCanvasElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.wsManager = new WebSocketManager({
            onMessage: (data) => this.handleTelemetry(data),
            onStatusChange: (status) => {
                this.wsStatus = status;
                this.updateConnectionUI();
            }
        });
        this.renderConnectForm();
    }

    private renderConnectForm(): void {
        this.container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Teacher Dashboard</h1>
        <p class="page-subtitle">Enter a student ID to begin monitoring</p>
      </header>

      <div class="card" style="max-width: 500px">
        <h2 class="card-title">Connect to Student</h2>
        <div class="input-group">
          <label class="input-label">Student Session ID</label>
          <input type="text" id="student-id-input" class="input-field" placeholder="e.g., student_abc123">
        </div>
        <button id="connect-btn" class="btn btn-primary" disabled>Connect</button>
      </div>
    `;

        const input = document.getElementById('student-id-input') as HTMLInputElement;
        const btn = document.getElementById('connect-btn') as HTMLButtonElement;

        input?.addEventListener('input', () => {
            btn.disabled = !input.value.trim();
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                this.connectToStudent(input.value.trim());
            }
        });

        btn?.addEventListener('click', () => {
            if (input.value.trim()) {
                this.connectToStudent(input.value.trim());
            }
        });
    }

    private connectToStudent(id: string): void {
        this.studentId = id;
        this.telemetry = null;
        this.timeline = [];
        this.renderDashboard();

        const baseUrl = this.wsManager.getBaseUrl();
        this.wsManager.connect(`${baseUrl}/ws/teacher/${this.studentId}`);
    }

    private renderDashboard(): void {
        this.container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Teacher Dashboard</h1>
        <p class="page-subtitle">Monitoring: ${this.studentId}</p>
      </header>

      <div class="grid-2">
        <div class="card">
          <h2 class="card-title">
            Current Status
            <span id="connection-indicator" class="connection-indicator disconnected" style="margin-left: auto">
              <span class="status-dot"></span>
              <span id="connection-text">disconnected</span>
            </span>
          </h2>

          <div id="ws-error" class="error-message hidden"></div>

          <div class="flex-center">
            <span id="status-badge" class="status-badge">
              <span class="status-dot"></span>
              <span id="status-text">Waiting...</span>
            </span>
          </div>

          <div class="telemetry-grid">
            <div class="telemetry-item">
              <div class="telemetry-label">Faces</div>
              <div id="face-count" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Gaze</div>
              <div id="gaze" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Confusion</div>
              <div id="confusion" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Last Update</div>
              <div id="last-update" class="telemetry-value" style="font-size: 0.9rem">—</div>
            </div>
          </div>

          <button id="disconnect-btn" class="btn btn-danger mt-2">Disconnect</button>
        </div>

        <div class="card">
          <h2 class="card-title">Engagement Timeline (Last 3 min)</h2>
          <canvas id="timeline-chart" class="timeline-chart" width="600" height="200"></canvas>
          <div class="chart-legend">
            <span class="legend-focused">● Focused</span>
            <span class="legend-confused">● Confused</span>
            <span class="legend-alert">● Alert</span>
          </div>
        </div>
      </div>
    `;

        this.chartCanvas = document.getElementById('timeline-chart') as HTMLCanvasElement;

        document.getElementById('disconnect-btn')?.addEventListener('click', () => {
            this.disconnect();
        });

        this.drawChart();
    }

    private handleTelemetry(data: TelemetryData): void {
        this.telemetry = data;

        this.timeline.push({ status: data.status, timestamp: data.timestamp });
        if (this.timeline.length > MAX_TIMELINE_POINTS) {
            this.timeline = this.timeline.slice(-MAX_TIMELINE_POINTS);
        }

        this.updateTelemetryUI();
        this.drawChart();
    }

    private updateTelemetryUI(): void {
        if (!this.telemetry) return;

        const badge = document.getElementById('status-badge');
        const statusText = document.getElementById('status-text');
        const faceCount = document.getElementById('face-count');
        const gaze = document.getElementById('gaze');
        const confusion = document.getElementById('confusion');
        const lastUpdate = document.getElementById('last-update');

        if (badge) {
            badge.className = 'status-badge';
            switch (this.telemetry.status) {
                case 'FOCUSED':
                    badge.classList.add('status-focused');
                    break;
                case 'CONFUSED':
                    badge.classList.add('status-confused');
                    break;
                case 'PROCTOR_ALERT':
                    badge.classList.add('status-alert');
                    break;
            }
        }

        if (statusText) {
            const labels: Record<string, string> = {
                FOCUSED: 'Focused',
                CONFUSED: 'Confused',
                PROCTOR_ALERT: 'Proctor Alert'
            };
            statusText.textContent = labels[this.telemetry.status] || this.telemetry.status;
        }

        if (faceCount) {
            faceCount.textContent = String(this.telemetry.face_count);
            faceCount.style.color = this.telemetry.face_count === 1
                ? 'var(--accent-green)'
                : 'var(--accent-red)';
        }

        if (gaze) {
            gaze.textContent = this.telemetry.gaze;
            gaze.style.color = this.telemetry.gaze === 'CENTER'
                ? 'var(--accent-green)'
                : 'var(--accent-yellow)';
        }

        if (confusion) {
            confusion.textContent = `${Math.round(this.telemetry.confusion_score * 100)}%`;
        }

        if (lastUpdate) {
            lastUpdate.textContent = new Date(this.telemetry.timestamp).toLocaleTimeString();
        }
    }

    private updateConnectionUI(): void {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');

        if (indicator) {
            indicator.className = `connection-indicator ${this.wsStatus}`;
        }
        if (text) {
            text.textContent = this.wsStatus;
        }
    }

    private drawChart(): void {
        const canvas = this.chartCanvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 30, right: 20, bottom: 30, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        ctx.fillStyle = '#12121a';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        const yLabels = ['Alert', 'Confused', 'Focused'];
        ctx.fillStyle = '#6b6b7b';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'right';

        for (let i = 0; i < 3; i++) {
            const y = padding.top + (chartHeight / 2) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.fillText(yLabels[i], padding.left - 10, y + 4);
        }

        if (this.timeline.length < 2) {
            ctx.fillStyle = '#6b6b7b';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for data...', width / 2, height / 2);
            return;
        }

        const statusToY = (status: string): number => {
            switch (status) {
                case 'FOCUSED': return padding.top;
                case 'CONFUSED': return padding.top + chartHeight / 2;
                case 'PROCTOR_ALERT': return padding.top + chartHeight;
                default: return padding.top + chartHeight / 2;
            }
        };

        const getStatusColor = (status: string): string => {
            switch (status) {
                case 'FOCUSED': return '#10b981';
                case 'CONFUSED': return '#f59e0b';
                case 'PROCTOR_ALERT': return '#ef4444';
                default: return '#6b6b7b';
            }
        };

        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (let i = 1; i < this.timeline.length; i++) {
            const x1 = padding.left + ((i - 1) / (this.timeline.length - 1)) * chartWidth;
            const x2 = padding.left + (i / (this.timeline.length - 1)) * chartWidth;
            const y1 = statusToY(this.timeline[i - 1].status);
            const y2 = statusToY(this.timeline[i].status);

            ctx.strokeStyle = getStatusColor(this.timeline[i].status);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        const lastPoint = this.timeline[this.timeline.length - 1];
        const x = padding.left + chartWidth;
        const y = statusToY(lastPoint.status);

        ctx.fillStyle = getStatusColor(lastPoint.status);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        const now = new Date();
        ctx.fillStyle = '#6b6b7b';
        ctx.textAlign = 'center';
        ctx.fillText(
            `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
            width - padding.right,
            height - 10
        );

        const firstTime = new Date(this.timeline[0].timestamp);
        ctx.fillText(
            `${firstTime.getHours().toString().padStart(2, '0')}:${firstTime.getMinutes().toString().padStart(2, '0')}`,
            padding.left,
            height - 10
        );
    }

    private disconnect(): void {
        this.wsManager.disconnect();
        this.studentId = '';
        this.telemetry = null;
        this.timeline = [];
        this.renderConnectForm();
    }

    destroy(): void {
        this.wsManager.disconnect();
    }
}
