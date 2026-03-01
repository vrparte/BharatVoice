import type { IncomingMessage } from 'http';

import { WebDemoErrorManager } from '../../../src/modes/web-demo/error-handler';
import { WebDemoSessionStore } from '../../../src/modes/web-demo/session-store';
import { createVoiceWebSocketHandler } from '../../../src/modes/web-demo/websocket-handler';
import { createMockWebSocket, generateTestAudio, waitForMessage } from '../../utils/websocket-mock';

const createRequest = (url: string): IncomingMessage => {
  return {
    url,
    headers: {
      host: 'localhost:3001',
      'user-agent': 'jest-load-client',
      origin: 'http://localhost:3000'
    },
    socket: {
      remoteAddress: '127.0.0.1'
    }
  } as unknown as IncomingMessage;
};

describe('Web demo concurrent sessions', () => {
  it('supports 100 simultaneous websocket session initializations', async () => {
    const handler = createVoiceWebSocketHandler({
      coreService: {
        synthesizeFromContext: jest.fn().mockResolvedValue({
          text: 'ok',
          audio: generateTestAudio(256),
          voice: 'meera',
          voiceId: 'bv-meera'
        })
      } as never,
      sessionStore: new WebDemoSessionStore({
        sessionCleanupIntervalMinutes: 60
      }),
      errorManager: new WebDemoErrorManager(),
      analytics: {
        trackDemoStarted: jest.fn().mockResolvedValue(undefined),
        trackMessageSent: jest.fn().mockResolvedValue(undefined),
        trackMessageReceived: jest.fn().mockResolvedValue(undefined),
        trackError: jest.fn().mockResolvedValue(undefined),
        trackDemoCompleted: jest.fn().mockResolvedValue(undefined),
        trackConversionClicked: jest.fn().mockResolvedValue(undefined)
      } as never
    });

    const sockets = Array.from({ length: 100 }, () => createMockWebSocket());
    for (const socket of sockets) {
      handler(socket as never, createRequest('/ws/voice?vertical=auto'));
    }

    const sessions = await Promise.all(sockets.map((socket) => waitForMessage(socket, 'session', 2000)));
    const ids = new Set(sessions.map((message) => message.sessionId as string));

    expect(ids.size).toBe(100);
  });
});
