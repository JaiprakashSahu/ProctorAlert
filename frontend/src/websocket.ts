const WS_BASE_URL = (import.meta as any).env?.VITE_WS_BASE_URL || 'ws://localhost:8000';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface WebSocketManagerOptions {
    onMessage?: (data: any) => void;
    onStatusChange?: (status: ConnectionStatus) => void;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

export class WebSocketManager {
    private ws: WebSocket | null = null;
    private url: string = '';
    private reconnectAttempt = 0;
    private reconnectTimeout: number | null = null;
    private options: WebSocketManagerOptions;

    constructor(options: WebSocketManagerOptions = {}) {
        this.options = options;
    }

    connect(url: string): void {
        this.url = url;
        this.attemptConnect();
    }

    private attemptConnect(): void {
        if (!this.url) return;

        this.options.onStatusChange?.('connecting');

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.options.onStatusChange?.('connected');
                this.reconnectAttempt = 0;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.options.onMessage?.(data);
                } catch {
                    this.options.onMessage?.(event.data);
                }
            };

            this.ws.onerror = () => {
                console.error('WebSocket error');
            };

            this.ws.onclose = (event) => {
                this.options.onStatusChange?.('disconnected');
                this.ws = null;

                if (!event.wasClean) {
                    const delay = RECONNECT_DELAYS[
                        Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
                    ];
                    this.reconnectAttempt++;
                    this.reconnectTimeout = window.setTimeout(() => this.attemptConnect(), delay);
                }
            };
        } catch (err) {
            console.error('WebSocket connection error:', err);
            this.options.onStatusChange?.('disconnected');
        }
    }

    disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'User disconnect');
            this.ws = null;
        }
        this.options.onStatusChange?.('disconnected');
    }

    send(data: string | object): boolean {
        if (this.ws?.readyState === WebSocket.OPEN) {
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            this.ws.send(message);
            return true;
        }
        return false;
    }

    getBaseUrl(): string {
        return WS_BASE_URL;
    }
}
