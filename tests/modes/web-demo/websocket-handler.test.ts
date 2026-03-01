import type { IncomingMessage } from 'http';

import { WebDemoErrorManager } from '../../../src/modes/web-demo/error-handler';
import { WebDemoSessionStore } from '../../../src/modes/web-demo/session-store';
import { createVoiceWebSocketHandler } from '../../../src/modes/web-demo/websocket-handler';
import {
  createMockWebSocket,
  generateTestAudio,
  getBinaryFrames,
  getJsonMessages,
  waitForMessage
} from '../../utils/websocket-mock';

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

const flushAsync = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe('createVoiceWebSocketHandler', () => {
  it('routes transcript and streams audio frames', async () => {
    const sessionStore = new WebDemoSessionStore({
      sessionCleanupIntervalMinutes: 60
    });
    const errorManager = new WebDemoErrorManager();
    const coreService = {
      synthesizeFromContext: jest.fn().mockResolvedValue({
        text: 'Aapne kaha',
        audio: generateTestAudio(4000),
        voice: 'meera',
        voiceId: 'bv-meera'
      })
    };
    const analytics = {
      trackDemoStarted: jest.fn().mockResolvedValue(undefined),
      trackMessageSent: jest.fn().mockResolvedValue(undefined),
      trackMessageReceived: jest.fn().mockResolvedValue(undefined),
      trackError: jest.fn().mockResolvedValue(undefined),
      trackDemoCompleted: jest.fn().mockResolvedValue(undefined),
      trackConversionClicked: jest.fn().mockResolvedValue(undefined)
    };

    const handler = createVoiceWebSocketHandler({
      coreService: coreService as never,
      sessionStore,
      errorManager,
      analytics: analytics as never
    });
    const socket = createMockWebSocket();
    handler(socket as never, createRequest('/ws/voice?vertical=dental'));

    const session = await waitForMessage(socket, 'session');
    expect(session.sessionId).toEqual(expect.any(String));

    socket.emitJson({ type: 'init', vertical: 'dental' });
    await waitForMessage(socket, 'init');

    socket.emitJson({
      type: 'transcript',
      text: 'Mera naam Rahul hai aur appointment book karna hai',
      vertical: 'dental',
      sessionId: session.sessionId
    });

    const response = await waitForMessage(socket, 'response');
    expect(response.text).toEqual(expect.any(String));
    await waitForMessage(socket, 'audio_start');
    await waitForMessage(socket, 'audio_end');

    expect(getBinaryFrames(socket).length).toBeGreaterThan(0);
    expect(coreService.synthesizeFromContext).toHaveBeenCalledTimes(1);
    expect(analytics.trackMessageSent).toHaveBeenCalled();
    expect(analytics.trackMessageReceived).toHaveBeenCalled();
  });

  it('handles invalid payloads and empty transcript gracefully', async () => {
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
      errorManager,
      analytics: analytics as never
    });
    const socket = createMockWebSocket();
    handler(socket as never, createRequest('/ws/voice'));

    await waitForMessage(socket, 'session');
    socket.emitRaw('{invalid');
    await flushAsync();
    socket.emitJson({ type: 'transcript', text: '   ' });
    await flushAsync();

    const messages = getJsonMessages(socket).filter((message) => message.type === 'error');
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(analytics.trackError).toHaveBeenCalled();
  });
});
