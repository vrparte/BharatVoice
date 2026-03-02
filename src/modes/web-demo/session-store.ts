import { randomUUID } from 'crypto';

import type { ConversationCollectedData, ConversationState } from '../../core/conversation/state-machine';

export type IWebDemoVertical = 'dental' | 'auto' | 'legal';

export interface IConversationHistoryItem {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly timestamp: Date;
}

export interface IExtractedEntities {
  readonly name?: string;
  readonly phone?: string;
  readonly date?: string;
  readonly time?: string;
  readonly serviceType?: string;
}

export interface ISessionMetadata {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly referrer: string;
}

export interface IWebDemoSession {
  readonly sessionId: string;
  readonly vertical: IWebDemoVertical;
  readonly conversationHistory: IConversationHistoryItem[];
  readonly extractedEntities: IExtractedEntities;
  readonly conversationContext?: {
    readonly state: ConversationState;
    readonly missingFields: string[];
    readonly collectedData: ConversationCollectedData;
    readonly retryCount: number;
  };
  readonly lastActivity: Date;
  readonly metadata: ISessionMetadata;
}

interface IStoredAudio {
  readonly audioId: string;
  readonly sessionId: string;
  readonly contentType: string;
  readonly audio: Buffer;
  readonly createdAt: Date;
}

interface ISessionStoreDependencies {
  readonly nowFn?: () => number;
  readonly sessionTtlMinutes?: number;
  readonly sessionCleanupIntervalMinutes?: number;
}

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const AUDIO_TTL_MS = 10 * 60 * 1000;

const normalizeVertical = (vertical: string): IWebDemoVertical => {
  const candidate = vertical.trim().toLowerCase();
  if (candidate === 'auto') {
    return 'auto';
  }
  if (candidate === 'legal') {
    return 'legal';
  }
  return 'dental';
};

const sanitizeMetadata = (metadata: Partial<ISessionMetadata> | object): ISessionMetadata => {
  const value = metadata as Partial<ISessionMetadata>;
  const ipAddress = value.ipAddress?.trim();
  const userAgent = value.userAgent?.trim();
  const referrer = value.referrer?.trim();

  return {
    ipAddress: ipAddress && ipAddress.length > 0 ? ipAddress : 'unknown',
    userAgent: userAgent && userAgent.length > 0 ? userAgent : 'unknown',
    referrer: referrer && referrer.length > 0 ? referrer : 'direct'
  };
};

const cloneConversationHistory = (history: readonly IConversationHistoryItem[]): IConversationHistoryItem[] => {
  return history.map((entry) => ({
    role: entry.role,
    text: entry.text,
    timestamp: new Date(entry.timestamp)
  }));
};

const cloneSession = (session: IWebDemoSession): IWebDemoSession => {
  return {
    ...session,
    conversationHistory: cloneConversationHistory(session.conversationHistory),
    lastActivity: new Date(session.lastActivity),
    extractedEntities: { ...session.extractedEntities },
    conversationContext: session.conversationContext
      ? {
          state: session.conversationContext.state,
          missingFields: [...session.conversationContext.missingFields],
          collectedData: { ...session.conversationContext.collectedData },
          retryCount: session.conversationContext.retryCount
        }
      : undefined,
    metadata: { ...session.metadata }
  };
};

export class WebDemoSessionStore {
  private readonly nowFn: () => number;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, IWebDemoSession>();
  private readonly audioStore = new Map<string, IStoredAudio>();

  public constructor(dependencies?: ISessionStoreDependencies) {
    this.nowFn = dependencies?.nowFn ?? Date.now;
    this.sessionTtlMs =
      dependencies?.sessionTtlMinutes && dependencies.sessionTtlMinutes > 0
        ? dependencies.sessionTtlMinutes * 60 * 1000
        : DEFAULT_SESSION_TTL_MS;
    const cleanupIntervalMs =
      dependencies?.sessionCleanupIntervalMinutes && dependencies.sessionCleanupIntervalMinutes > 0
        ? dependencies.sessionCleanupIntervalMinutes * 60 * 1000
        : DEFAULT_SESSION_CLEANUP_INTERVAL_MS;

    const timer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, cleanupIntervalMs);
    timer.unref();
  }

  public createSession(vertical: string, metadata: object): IWebDemoSession {
    const session: IWebDemoSession = {
      sessionId: randomUUID(),
      vertical: normalizeVertical(vertical),
      conversationHistory: [],
      extractedEntities: {},
      lastActivity: new Date(this.nowFn()),
      metadata: sanitizeMetadata(metadata)
    };
    this.sessions.set(session.sessionId, session);
    return cloneSession(session);
  }

  public getSession(sessionId: string): IWebDemoSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (this.nowFn() - session.lastActivity.getTime() > this.sessionTtlMs) {
      this.sessions.delete(sessionId);
      return null;
    }

    return cloneSession(session);
  }

  public updateSession(sessionId: string, updates: Partial<IWebDemoSession>): void {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return;
    }

    const updated: IWebDemoSession = {
      ...current,
      ...updates,
      sessionId: current.sessionId,
      vertical: updates.vertical ? normalizeVertical(updates.vertical) : current.vertical,
      conversationHistory: updates.conversationHistory
        ? cloneConversationHistory(updates.conversationHistory)
        : current.conversationHistory,
      extractedEntities: {
        ...current.extractedEntities,
        ...(updates.extractedEntities ?? {})
      },
      conversationContext: updates.conversationContext
        ? {
            state: updates.conversationContext.state,
            missingFields: [...updates.conversationContext.missingFields],
            collectedData: { ...updates.conversationContext.collectedData },
            retryCount: updates.conversationContext.retryCount
          }
        : current.conversationContext,
      metadata: {
        ...current.metadata,
        ...(updates.metadata ?? {})
      },
      lastActivity: updates.lastActivity ? new Date(updates.lastActivity) : new Date(this.nowFn())
    };

    this.sessions.set(sessionId, updated);
  }

  public deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  public cleanupExpiredSessions(): void {
    const now = this.nowFn();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.sessionTtlMs) {
        this.sessions.delete(sessionId);
      }
    }

    for (const [audioId, audio] of this.audioStore.entries()) {
      if (now - audio.createdAt.getTime() > AUDIO_TTL_MS) {
        this.audioStore.delete(audioId);
      }
    }
  }

  public storeAudio(sessionId: string, audio: Buffer, contentType: string): string {
    const audioId = randomUUID();
    this.audioStore.set(audioId, {
      audioId,
      sessionId,
      contentType,
      audio: Buffer.from(audio),
      createdAt: new Date(this.nowFn())
    });
    return audioId;
  }

  public getAudio(audioId: string): IStoredAudio | undefined {
    const entry = this.audioStore.get(audioId);
    if (!entry) {
      return undefined;
    }

    if (this.nowFn() - entry.createdAt.getTime() > AUDIO_TTL_MS) {
      this.audioStore.delete(audioId);
      return undefined;
    }

    return {
      ...entry,
      audio: Buffer.from(entry.audio),
      createdAt: new Date(entry.createdAt)
    };
  }
}
