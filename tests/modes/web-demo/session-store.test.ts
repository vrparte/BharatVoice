import { WebDemoSessionStore } from '../../../src/modes/web-demo/session-store';

describe('WebDemoSessionStore', () => {
  it('expires sessions after TTL and cleanup', () => {
    let nowMs = 1_000;
    const store = new WebDemoSessionStore({
      nowFn: () => nowMs,
      sessionTtlMinutes: 1,
      sessionCleanupIntervalMinutes: 60
    });

    const session = store.createSession('dental', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      referrer: 'unit-test'
    });

    expect(store.getSession(session.sessionId)).not.toBeNull();

    nowMs += 61_000;
    store.cleanupExpiredSessions();

    expect(store.getSession(session.sessionId)).toBeNull();
  });

  it('persists updates for conversation history and entities', () => {
    const nowMs = 2_000;
    const store = new WebDemoSessionStore({
      nowFn: () => nowMs,
      sessionTtlMinutes: 10,
      sessionCleanupIntervalMinutes: 60
    });
    const session = store.createSession('auto', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      referrer: 'unit-test'
    });

    store.updateSession(session.sessionId, {
      conversationHistory: [
        {
          role: 'user',
          text: 'Meri gaadi service karni hai',
          timestamp: new Date(nowMs)
        }
      ],
      extractedEntities: {
        name: 'Rahul',
        phone: '9876543210',
        serviceType: 'car_service'
      }
    });

    const updated = store.getSession(session.sessionId);
    expect(updated).not.toBeNull();
    expect(updated?.conversationHistory).toHaveLength(1);
    expect(updated?.extractedEntities.name).toBe('Rahul');
    expect(updated?.extractedEntities.phone).toBe('9876543210');
    expect(updated?.vertical).toBe('auto');
  });

  it('removes audio buffers after audio TTL', () => {
    let nowMs = 5_000;
    const store = new WebDemoSessionStore({
      nowFn: () => nowMs,
      sessionCleanupIntervalMinutes: 60
    });
    const session = store.createSession('legal', {
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      referrer: 'unit-test'
    });

    const audioId = store.storeAudio(session.sessionId, Buffer.from([1, 2, 3]), 'audio/wav');
    expect(store.getAudio(audioId)).toBeDefined();

    nowMs += 11 * 60 * 1000;
    store.cleanupExpiredSessions();

    expect(store.getAudio(audioId)).toBeUndefined();
  });
});
