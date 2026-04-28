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
    private timeline: TimelinePoint[] = [];
    private chartCanvas: HTMLCanvasElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.wsManager = new WebSocketManager({
            onMessage: (data) => {
                // DIRECT DOM UPDATE - no render loop, no delay
                this.updateUI(data);
            },
            onStatusChange: (status) => {
                this.wsStatus = status;
                this.updateConnectionStatus();
            },
            onReconnect: () => {
                console.log('[Teacher] Reconnecting');
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

        input?.addEventListener('input', () => { btn.disabled = !input.value.trim(); });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) this.connectToStudent(input.value.trim());
        });
        btn?.addEventListener('click', () => {
            if (input.value.trim()) this.connectToStudent(input.value.trim());
        });
    }

    private connectToStudent(id: string): void {
        this.studentId = id;
        this.timeline = [];
        this.buildDashboard();
        this.wsManager.connect(`${this.wsManager.getBaseUrl()}/ws/teacher/${this.studentId}`);
    }

    private buildDashboard(): void {
        this.container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Teacher Dashboard</h1>
        <p class="page-subtitle">Monitoring: <strong>${this.studentId}</strong></p>
      </header>
      <div class="grid-2">
        <div class="card">
          <h2 class="card-title">
            📊 Status
            <span id="conn-status" class="connection-indicator disconnected" style="margin-left:auto">
              <span class="status-dot"></span><span id="conn-text">disconnected</span>
            </span>
          </h2>
          <div class="flex-center">
            <span id="status-badge" class="status-badge">
              <span class="status-dot"></span><span id="status-text">Waiting...</span>
            </span>
          </div>
          <div class="telemetry-grid">
            <div class="telemetry-item">
              <div class="telemetry-label">👤 Faces</div>
              <div id="t-faces" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">👁 Gaze</div>
              <div id="t-gaze" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">🤔 Confusion</div>
              <div id="t-conf" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">🕐 Updated</div>
              <div id="t-time" class="telemetry-value">—</div>
            </div>
          </div>
          <button id="disconnect-btn" class="btn btn-danger mt-2">Disconnect</button>
        </div>
        <div class="card">
          <h2 class="card-title">📈 Timeline <span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted)">Last 3 min</span></h2>
          <canvas id="chart" class="timeline-chart" width="600" height="220"></canvas>
          <div class="chart-legend">
            <span class="legend-focused">● Focused</span>
            <span class="legend-confused">● Confused</span>
            <span class="legend-alert">● Alert</span>
          </div>
        </div>
      </div>
    `;
        this.chartCanvas = document.getElementById('chart') as HTMLCanvasElement;
        document.getElementById('disconnect-btn')?.addEventListener('click', () => this.disconnect());
        this.drawChart();
    }

    /**
     * DIRECTLY update DOM - called from WebSocket onmessage
     */
    private updateUI(data: TelemetryData): void {
        // Update timeline
        this.timeline.push({ status: data.status, timestamp: data.timestamp });
        if (this.timeline.length > MAX_TIMELINE_POINTS) {
            this.timeline = this.timeline.slice(-MAX_TIMELINE_POINTS);
        }

        // Status badge
        const badge = document.getElementById('status-badge');
        const statusText = document.getElementById('status-text');
        if (badge) {
            badge.className = 'status-badge';
            if (data.status === 'FOCUSED') badge.classList.add('status-focused');
            else if (data.status === 'CONFUSED') badge.classList.add('status-confused');
            else if (data.status === 'PROCTOR_ALERT') badge.classList.add('status-alert');
        }
        if (statusText) {
            statusText.textContent = data.status === 'PROCTOR_ALERT' ? 'Proctor Alert' :
                data.status === 'CONFUSED' ? 'Confused' : 'Focused';
        }

        // Telemetry values
        const faces = document.getElementById('t-faces');
        const gaze = document.getElementById('t-gaze');
        const conf = document.getElementById('t-conf');
        const time = document.getElementById('t-time');

        if (faces) {
            faces.textContent = String(data.face_count);
            faces.style.color = data.face_count === 1 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
        if (gaze) {
            gaze.textContent = data.gaze;
            gaze.style.color = data.gaze === 'CENTER' ? 'var(--accent-green)' : 'var(--accent-yellow)';
        }
        if (conf) {
            conf.textContent = `${Math.round(data.confusion_score * 100)}%`;
        }
        if (time) {
            time.textContent = new Date(data.timestamp).toLocaleTimeString();
        }

        // Chart
        this.drawChart();
    }

    private updateConnectionStatus(): void {
        const indicator = document.getElementById('conn-status');
        const text = document.getElementById('conn-text');
        if (indicator) indicator.className = `connection-indicator ${this.wsStatus}`;
        if (text) text.textContent = this.wsStatus;
    }

    private drawChart(): void {
        const canvas = this.chartCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width, h = canvas.height;
        const pad = { top: 30, right: 20, bottom: 30, left: 50 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0c0c14';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#6b6b7b';
        ctx.font = '11px Inter,sans-serif';
        ctx.textAlign = 'right';

        const yLabels = ['Alert', 'Confused', 'Focused'];
        for (let i = 0; i < 3; i++) {
            const y = pad.top + (ch / 2) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillText(yLabels[i], pad.left - 10, y + 4);
        }

        if (this.timeline.length < 2) {
            ctx.fillStyle = '#6b6b7b';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for data...', w / 2, h / 2);
            return;
        }

        const statusY = (s: string) => s === 'FOCUSED' ? pad.top : s === 'CONFUSED' ? pad.top + ch / 2 : pad.top + ch;
        const statusColor = (s: string) => s === 'FOCUSED' ? '#22c55e' : s === 'CONFUSED' ? '#fbbf24' : '#f43f5e';

        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (let i = 1; i < this.timeline.length; i++) {
            const x1 = pad.left + ((i - 1) / (this.timeline.length - 1)) * cw;
            const x2 = pad.left + (i / (this.timeline.length - 1)) * cw;
            ctx.strokeStyle = statusColor(this.timeline[i].status);
            ctx.beginPath();
            ctx.moveTo(x1, statusY(this.timeline[i - 1].status));
            ctx.lineTo(x2, statusY(this.timeline[i].status));
            ctx.stroke();
        }

        const last = this.timeline[this.timeline.length - 1];
        ctx.fillStyle = statusColor(last.status);
        ctx.beginPath();
        ctx.arc(pad.left + cw, statusY(last.status), 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#6b6b7b';
        ctx.textAlign = 'center';
        const now = new Date();
        ctx.fillText(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`, w - pad.right, h - 10);
        const first = new Date(this.timeline[0].timestamp);
        ctx.fillText(`${first.getHours().toString().padStart(2, '0')}:${first.getMinutes().toString().padStart(2, '0')}`, pad.left, h - 10);
    }

    private disconnect(): void {
        this.wsManager.disconnect();
        this.studentId = '';
        this.timeline = [];
        this.renderConnectForm();
    }

    destroy(): void {
        this.wsManager.disconnect();
    }
}
