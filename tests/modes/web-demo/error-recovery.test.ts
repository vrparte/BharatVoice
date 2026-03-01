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
      'user-agent': 'jest-client',
      origin: 'http://localhost:3000'
    },
    socket: {
      remoteAddress: '127.0.0.1'
    }
  } as unknown as IncomingMessage;
};

describe('Web demo error recovery', () => {
  it('restores existing session on reconnect with same sessionId', async () => {
    const sessionStore = new WebDemoSessionStore({
      sessionCleanupIntervalMinutes: 60
    });
    const handler = createVoiceWebSocketHandler({
      coreService: {
        synthesizeFromContext: jest.fn().mockResolvedValue({
          text: 'ok',
          audio: generateTestAudio(),
          voice: 'meera',
          voiceId: 'bv-meera'
        })
      } as never,
      sessionStore,
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

    const firstSocket = createMockWebSocket();
    handler(firstSocket as never, createRequest('/ws/voice?vertical=legal'));
    const firstSession = await waitForMessage(firstSocket, 'session');
    const sessionId = firstSession.sessionId as string;

    firstSocket.emitClose();

    const secondSocket = createMockWebSocket();
    handler(secondSocket as never, createRequest(`/ws/voice?sessionId=${sessionId}&vertical=legal`));
    const resumed = await waitForMessage(secondSocket, 'session');
    expect(resumed.sessionId).toBe(sessionId);
  });

  it('creates a new session and sends session_recovered when unknown sessionId is provided', async () => {
    const handler = createVoiceWebSocketHandler({
      coreService: {
        synthesizeFromContext: jest.fn().mockResolvedValue({
          text: 'ok',
          audio: generateTestAudio(),
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

    const socket = createMockWebSocket();
    handler(socket as never, createRequest('/ws/voice?vertical=dental'));
    await waitForMessage(socket, 'session');

    socket.emitJson({
      type: 'transcript',
      sessionId: 'missing-session-id',
      text: 'hello'
    });

    const recovered = await waitForMessage(socket, 'session_recovered');
    expect(recovered.sessionId).toEqual(expect.any(String));
    expect(recovered.sessionId).not.toBe('missing-session-id');
  });
});
