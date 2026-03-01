import { WebDemoSessionStore } from '../../../src/modes/web-demo/session-store';

describe('Web demo session memory behavior', () => {
  it('expires and clears 1000 short-lived sessions after cleanup', () => {
    let nowMs = 100_000;
    const store = new WebDemoSessionStore({
      nowFn: () => nowMs,
      sessionTtlMinutes: 1,
      sessionCleanupIntervalMinutes: 60
    });

    const sessionIds: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const session = store.createSession('dental', {
        ipAddress: `10.0.0.${index % 255}`,
        userAgent: 'memory-test',
        referrer: 'load-suite'
      });
      sessionIds.push(session.sessionId);
    }

    nowMs += 61_000;
    store.cleanupExpiredSessions();

    const remaining = sessionIds.reduce((count, sessionId) => {
      return store.getSession(sessionId) ? count + 1 : count;
    }, 0);

    expect(remaining).toBe(0);
  });
});
