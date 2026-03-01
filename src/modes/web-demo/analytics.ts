import { logger } from '../../utils/logger';

import {
  type IAnalyticsDashboard,
  type IAnalyticsStore,
  createAnalyticsStore,
  createDemoStartedEvent
} from './analytics-store';

export class WebDemoAnalyticsTracker {
  private readonly store: IAnalyticsStore;
  private readonly sessionStartAtMs = new Map<string, number>();
  private readonly sessionTurnCount = new Map<string, number>();

  public constructor(store?: IAnalyticsStore) {
    this.store = store ?? createAnalyticsStore();
  }

  public async trackDemoStarted(input: {
    readonly sessionId: string;
    readonly vertical: 'dental' | 'auto' | 'legal';
    readonly referrer: string;
    readonly country: string;
    readonly city: string;
    readonly ipAddress: string;
  }): Promise<void> {
    this.sessionStartAtMs.set(input.sessionId, Date.now());
    this.sessionTurnCount.set(input.sessionId, 0);
    await this.store.track(createDemoStartedEvent(input));
  }

  public async trackMessageSent(input: {
    readonly sessionId: string;
    readonly messageLength: number;
    readonly latencyMs: number;
  }): Promise<void> {
    this.sessionTurnCount.set(input.sessionId, (this.sessionTurnCount.get(input.sessionId) ?? 0) + 1);
    await this.store.track({
      type: 'message_sent',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      messageLength: input.messageLength,
      latencyMs: input.latencyMs
    });
  }

  public async trackMessageReceived(input: {
    readonly sessionId: string;
    readonly responseLength: number;
    readonly ttsLatencyMs: number;
  }): Promise<void> {
    await this.store.track({
      type: 'message_received',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      responseLength: input.responseLength,
      ttsLatencyMs: input.ttsLatencyMs
    });
  }

  public async trackError(input: {
    readonly sessionId?: string;
    readonly errorType: string;
    readonly category: 'client' | 'network' | 'server' | 'user';
    readonly recoverySuccess: boolean;
  }): Promise<void> {
    await this.store.track({
      type: 'error_occurred',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      errorType: input.errorType,
      category: input.category,
      recoverySuccess: input.recoverySuccess
    });
  }

  public async trackDemoCompleted(input: {
    readonly sessionId: string;
    readonly outcome: 'completed' | 'dropped' | 'error' | 'converted';
  }): Promise<void> {
    const startedAt = this.sessionStartAtMs.get(input.sessionId) ?? Date.now();
    const turns = this.sessionTurnCount.get(input.sessionId) ?? 0;
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));

    await this.store.track({
      type: 'demo_completed',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      durationSeconds,
      turnCount: turns,
      outcome: input.outcome
    });

    this.sessionStartAtMs.delete(input.sessionId);
    this.sessionTurnCount.delete(input.sessionId);
  }

  public async trackConversionClicked(input: {
    readonly sessionId?: string;
    readonly ctaType: 'pricing' | 'contact';
  }): Promise<void> {
    await this.store.track({
      type: 'conversion_clicked',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      ctaType: input.ctaType
    });
  }

  public async getDashboard(): Promise<IAnalyticsDashboard> {
    try {
      return await this.store.getDashboard(new Date());
    } catch (error: unknown) {
      logger.error('Failed to build analytics dashboard', {
        eventType: 'web_demo.analytics.dashboard_error',
        error: error instanceof Error ? error.message : 'Unknown dashboard error'
      });
      return {
        today: {
          demosStarted: 0,
          avgDurationSeconds: 0,
          conversionRate: 0
        },
        topVerticals: [],
        errorRates: [],
        geographicDistribution: []
      };
    }
  }

  public async cleanup(): Promise<void> {
    await this.store.cleanupExpiredSessions(new Date());
  }
}
