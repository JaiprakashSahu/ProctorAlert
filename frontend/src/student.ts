import { WebSocketManager } from './websocket';

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const FRAME_INTERVAL_MS = 250;
const JPEG_QUALITY = 0.7;

export class StudentPortal {
    private container: HTMLElement;
    private studentId: string;
    private videoElement: HTMLVideoElement | null = null;
    private canvasElement: HTMLCanvasElement | null = null;
    private stream: MediaStream | null = null;
    private frameInterval: number | null = null;
    private isStreaming = false;
    private wsManager: WebSocketManager;
    private wsStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

    constructor(container: HTMLElement) {
        this.container = container;
        this.studentId = `student_${Math.random().toString(36).substring(2, 10)}`;
        this.wsManager = new WebSocketManager({
            onStatusChange: (status) => {
                this.wsStatus = status;
                this.updateConnectionUI();
            }
        });
        this.render();
        this.initCamera();
        this.setupVisibilityListener();
    }

    private render(): void {
        this.container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Student Portal</h1>
        <p class="page-subtitle">Session ID: ${this.studentId}</p>
      </header>

      <div class="grid-2">
        <div class="card">
          <h2 class="card-title">Camera Feed</h2>
          <div id="camera-error" class="error-message hidden"></div>
          <div class="video-container">
            <video id="video" class="video-element" autoplay playsinline muted></video>
            <div class="video-overlay">
              <span id="connection-status" class="connection-indicator disconnected">
                <span class="status-dot"></span>
                <span id="connection-text">Not streaming</span>
              </span>
              <span id="tab-hidden-badge" class="status-badge status-alert hidden">Tab Hidden</span>
            </div>
          </div>
          <canvas id="capture-canvas" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" style="display:none"></canvas>
          <div class="flex-row mt-1">
            <button id="toggle-btn" class="btn btn-primary" disabled>Start Session</button>
            <span id="camera-status" style="color: var(--text-muted)">Initializing camera...</span>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Session Information</h2>
          <div class="info-message">
            Share your Session ID with your teacher so they can monitor your engagement.
          </div>
          <div class="telemetry-grid">
            <div class="telemetry-item">
              <div class="telemetry-label">Camera</div>
              <div id="cam-status" class="telemetry-value" style="color: var(--accent-yellow)">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Connection</div>
              <div id="ws-status" class="telemetry-value" style="color: var(--text-muted)">disconnected</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Frame Rate</div>
              <div id="frame-rate" class="telemetry-value">—</div>
            </div>
            <div class="telemetry-item">
              <div class="telemetry-label">Resolution</div>
              <div class="telemetry-value">${VIDEO_WIDTH}×${VIDEO_HEIGHT}</div>
            </div>
          </div>
        </div>
      </div>
    `;

        this.videoElement = document.getElementById('video') as HTMLVideoElement;
        this.canvasElement = document.getElementById('capture-canvas') as HTMLCanvasElement;

        document.getElementById('toggle-btn')?.addEventListener('click', () => this.toggleStreaming());
    }

    private async initCamera(): Promise<void> {
        const statusEl = document.getElementById('camera-status');
        const camStatus = document.getElementById('cam-status');
        const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
        const errorEl = document.getElementById('camera-error');

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, facingMode: 'user' },
                audio: false
            });

            if (this.videoElement) {
                this.videoElement.srcObject = this.stream;
            }

            if (statusEl) statusEl.textContent = 'Camera ready';
            if (camStatus) {
                camStatus.textContent = 'Ready';
                camStatus.style.color = 'var(--accent-green)';
            }
            if (toggleBtn) toggleBtn.disabled = false;
            if (errorEl) errorEl.classList.add('hidden');

            this.stream.getVideoTracks()[0].addEventListener('ended', () => {
                this.handleCameraDisconnect();
            });

        } catch (err: any) {
            let message = 'Camera error';
            if (err.name === 'NotAllowedError') {
                message = 'Camera permission denied. Please allow camera access and refresh.';
            } else if (err.name === 'NotFoundError') {
                message = 'No camera found. Please connect a camera and refresh.';
            }

            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
            }
            if (statusEl) statusEl.textContent = 'Error';
            if (camStatus) {
                camStatus.textContent = 'Error';
                camStatus.style.color = 'var(--accent-red)';
            }
        }
    }

    private handleCameraDisconnect(): void {
        const errorEl = document.getElementById('camera-error');
        const camStatus = document.getElementById('cam-status');

        if (errorEl) {
            errorEl.textContent = 'Camera disconnected. Please reconnect and refresh.';
            errorEl.classList.remove('hidden');
        }
        if (camStatus) {
            camStatus.textContent = 'Disconnected';
            camStatus.style.color = 'var(--accent-red)';
        }

        this.stopStreaming();
    }

    private toggleStreaming(): void {
        if (this.isStreaming) {
            this.stopStreaming();
        } else {
            this.startStreaming();
        }
    }

    private startStreaming(): void {
        this.isStreaming = true;
        const baseUrl = this.wsManager.getBaseUrl();
        this.wsManager.connect(`${baseUrl}/ws/student/${this.studentId}`);

        this.frameInterval = window.setInterval(() => this.captureAndSend(), FRAME_INTERVAL_MS);

        const toggleBtn = document.getElementById('toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = 'Stop Session';
            toggleBtn.className = 'btn btn-danger';
        }

        const frameRate = document.getElementById('frame-rate');
        if (frameRate) frameRate.textContent = `${1000 / FRAME_INTERVAL_MS} fps`;
    }

    private stopStreaming(): void {
        this.isStreaming = false;
        this.wsManager.disconnect();

        if (this.frameInterval) {
            clearInterval(this.frameInterval);
            this.frameInterval = null;
        }

        const toggleBtn = document.getElementById('toggle-btn');
        if (toggleBtn) {
            toggleBtn.textContent = 'Start Session';
            toggleBtn.className = 'btn btn-primary';
        }

        const frameRate = document.getElementById('frame-rate');
        if (frameRate) frameRate.textContent = '—';
    }

    private captureAndSend(): void {
        if (!this.videoElement || !this.canvasElement || document.hidden) return;
        if (this.videoElement.readyState !== 4) return;

        const ctx = this.canvasElement.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(this.videoElement, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
        const frameData = this.canvasElement.toDataURL('image/jpeg', JPEG_QUALITY);
        this.wsManager.send(frameData);
    }

    private updateConnectionUI(): void {
        const indicator = document.getElementById('connection-status');
        const text = document.getElementById('connection-text');
        const wsStatus = document.getElementById('ws-status');

        if (indicator) {
            indicator.className = `connection-indicator ${this.isStreaming ? this.wsStatus : 'disconnected'}`;
        }

        if (text) {
            if (!this.isStreaming) {
                text.textContent = 'Not streaming';
            } else if (this.wsStatus === 'connecting') {
                text.textContent = 'Connecting...';
            } else if (this.wsStatus === 'connected') {
                text.textContent = 'Connected';
            } else {
                text.textContent = 'Disconnected';
            }
        }

        if (wsStatus) {
            wsStatus.textContent = this.wsStatus;
            wsStatus.style.color = this.wsStatus === 'connected'
                ? 'var(--accent-green)'
                : 'var(--text-muted)';
        }
    }

    private setupVisibilityListener(): void {
        document.addEventListener('visibilitychange', () => {
            const badge = document.getElementById('tab-hidden-badge');
            if (badge) {
                badge.classList.toggle('hidden', !document.hidden);
            }
        });
    }

    destroy(): void {
        this.stopStreaming();
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }
}
