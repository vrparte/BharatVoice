import { logger } from '../../utils/logger';

export type IWebDemoErrorCategory = 'client' | 'network' | 'server' | 'user';

export interface IWebDemoErrorEvent {
  readonly timestamp: Date;
  readonly category: IWebDemoErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly stack?: string;
  readonly metadata?: Record<string, unknown>;
}

interface IWebDemoHealthSnapshot {
  readonly websocket: {
    readonly status: 'up' | 'degraded' | 'down';
    readonly connectedClients: number;
  };
  readonly ttsService: {
    readonly status: 'up' | 'degraded' | 'down';
    readonly textOnlyMode: boolean;
    readonly consecutiveFailures: number;
  };
  readonly recentErrorRate: number;
  readonly recentErrors: number;
  readonly recentRequests: number;
}

interface IWebDemoErrorManagerDependencies {
  readonly nowFn?: () => number;
}

const WINDOW_MS = 5 * 60 * 1000;
const ALERT_THRESHOLD_PERCENT = 5;
const MIN_REQUESTS_FOR_ALERT = 10;
const MAX_EVENTS = 1000;

const HINGLISH_MESSAGES: Readonly<Record<string, string>> = {
  MIC_PERMISSION_DENIED: 'Microphone access deny hua hai. Kripya permission allow karke fir se koshish karein.',
  STT_TIMEOUT: "Didn't catch that, please speak clearly. Kripya fir se koshish karein.",
  WS_DISCONNECT: 'Connection toot gaya hai. Internet connection check karein.',
  AUDIO_UNAVAILABLE: 'Audio sunne mein problem hai, text padhein.',
  SESSION_LOST: 'Session reset ho gaya. Maafi chahte hain, kripya fir se koshish karein.',
  GENERIC_RETRY: 'Kripya fir se koshish karein.'
};

export class WebDemoErrorManager {
  private readonly nowFn: () => number;
  private readonly errorEvents: IWebDemoErrorEvent[] = [];
  private readonly requestTimestamps: number[] = [];
  private connectedClients = 0;
  private ttsConsecutiveFailures = 0;
  private textOnlyMode = false;

  public constructor(dependencies?: IWebDemoErrorManagerDependencies) {
    this.nowFn = dependencies?.nowFn ?? Date.now;
  }

  public markRequest(): void {
    this.requestTimestamps.push(this.nowFn());
    this.prune();
  }

  public recordError(event: Omit<IWebDemoErrorEvent, 'timestamp'>): void {
    const item: IWebDemoErrorEvent = {
      ...event,
      timestamp: new Date(this.nowFn())
    };
    this.errorEvents.push(item);
    this.prune();

    logger.error('Web demo error captured', {
      eventType: 'web_demo.error',
      category: item.category,
      code: item.code,
      message: item.message,
      sessionId: item.sessionId ?? null,
      stack: item.stack ?? null,
      metadata: item.metadata ?? {}
    });

    if (this.shouldAlert()) {
      logger.error('Web demo error rate threshold breached', {
        eventType: 'web_demo.error_rate_alert',
        recentErrorRate: this.getRecentErrorRate(),
        threshold: ALERT_THRESHOLD_PERCENT
      });
    }
  }

  public incrementConnectedClients(): void {
    this.connectedClients += 1;
  }

  public decrementConnectedClients(): void {
    this.connectedClients = Math.max(0, this.connectedClients - 1);
  }

  public markTtsSuccess(): void {
    this.ttsConsecutiveFailures = 0;
    this.textOnlyMode = false;
  }

  public markTtsFailure(sessionId?: string, message?: string): void {
    this.ttsConsecutiveFailures += 1;
    this.recordError({
      category: 'server',
      code: 'TTS_FAILURE',
      message: message ?? 'TTS synthesis failed',
      sessionId
    });

    if (this.ttsConsecutiveFailures >= 3) {
      this.textOnlyMode = true;
      logger.warn('Web demo switched to text-only mode due to repeated TTS failures', {
        eventType: 'web_demo.degrade.text_only',
        consecutiveFailures: this.ttsConsecutiveFailures
      });
    }
  }

  public isTextOnlyMode(): boolean {
    return this.textOnlyMode;
  }

  public getUserMessage(code: string): string {
    return HINGLISH_MESSAGES[code] ?? HINGLISH_MESSAGES.GENERIC_RETRY;
  }

  public getHealthSnapshot(): IWebDemoHealthSnapshot {
    this.prune();
    return {
      websocket: {
        status: this.connectedClients > 0 ? 'up' : 'degraded',
        connectedClients: this.connectedClients
      },
      ttsService: {
        status: this.textOnlyMode ? 'degraded' : 'up',
        textOnlyMode: this.textOnlyMode,
        consecutiveFailures: this.ttsConsecutiveFailures
      },
      recentErrorRate: this.getRecentErrorRate(),
      recentErrors: this.getRecentErrorCount(),
      recentRequests: this.getRecentRequestCount()
    };
  }

  private getRecentErrorCount(): number {
    const cutoff = this.nowFn() - WINDOW_MS;
    return this.errorEvents.filter((event) => event.timestamp.getTime() >= cutoff).length;
  }

  private getRecentRequestCount(): number {
    const cutoff = this.nowFn() - WINDOW_MS;
    return this.requestTimestamps.filter((timestamp) => timestamp >= cutoff).length;
  }

  private getRecentErrorRate(): number {
    const errors = this.getRecentErrorCount();
    const requests = this.getRecentRequestCount();
    if (requests === 0) {
      return 0;
    }
    return Number(((errors / requests) * 100).toFixed(2));
  }

  private shouldAlert(): boolean {
    const requests = this.getRecentRequestCount();
    if (requests < MIN_REQUESTS_FOR_ALERT) {
      return false;
    }
    return this.getRecentErrorRate() > ALERT_THRESHOLD_PERCENT;
  }

  private prune(): void {
    const cutoff = this.nowFn() - WINDOW_MS;

    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }

    while (this.errorEvents.length > 0 && this.errorEvents[0].timestamp.getTime() < cutoff) {
      this.errorEvents.shift();
    }

    if (this.errorEvents.length > MAX_EVENTS) {
      this.errorEvents.splice(0, this.errorEvents.length - MAX_EVENTS);
    }
  }
}
