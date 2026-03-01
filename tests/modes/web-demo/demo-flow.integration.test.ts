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

describe('Web demo full conversation flow', () => {
  it('simulates init -> transcript -> response -> close lifecycle', async () => {
    const sessionStore = new WebDemoSessionStore({
      sessionCleanupIntervalMinutes: 60
    });
    const errorManager = new WebDemoErrorManager();
    const analytics = {
      trackDemoStarted: jest.fn().mockResolvedValue(undefined),
      trackMessageSent: jest.fn().mockResolvedValue(undefined),
      trackMessageReceived: jest.fn().mockResolvedValue(undefined),
      trackError: jest.fn().mockResolvedValue(undefined),
      trackDemoCompleted: jest.fn().mockResolvedValue(undefined),
      trackConversionClicked: jest.fn().mockResolvedValue(undefined)
    };
    const coreService = {
      synthesizeFromContext: jest.fn().mockResolvedValue({
        text: 'Aapne kaha test',
        audio: generateTestAudio(),
        voice: 'meera',
        voiceId: 'bv-meera'
      })
    };

    const handler = createVoiceWebSocketHandler({
      coreService: coreService as never,
      sessionStore,
      errorManager,
      analytics: analytics as never
    });

    const socket = createMockWebSocket();
    handler(socket as never, createRequest('/ws/voice?vertical=auto'));

    const session = await waitForMessage(socket, 'session');
    const sessionId = session.sessionId as string;

    socket.emitJson({
      type: 'init',
      vertical: 'auto',
      sessionId
    });
    await waitForMessage(socket, 'init');

    socket.emitJson({
      type: 'transcript',
      sessionId,
      vertical: 'auto',
      text: 'Mera naam Aman hai, meri gaadi service karni hai'
    });

    await waitForMessage(socket, 'response');
    await waitForMessage(socket, 'audio_end');

    const updated = sessionStore.getSession(sessionId);
    expect(updated).not.toBeNull();
    expect(updated?.conversationHistory.length).toBeGreaterThanOrEqual(2);
    expect(analytics.trackDemoStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId
      })
    );
    expect(analytics.trackMessageReceived).toHaveBeenCalled();

    socket.emitClose();
    expect(analytics.trackDemoCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        outcome: 'dropped'
      })
    );
  });
});
