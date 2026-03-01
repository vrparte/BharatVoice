import type { IncomingMessage } from 'http';
import { inflateSync } from 'zlib';

import { WebDemoErrorManager } from '../../../src/modes/web-demo/error-handler';
import { WebDemoSessionStore } from '../../../src/modes/web-demo/session-store';
import { createVoiceWebSocketHandler } from '../../../src/modes/web-demo/websocket-handler';
import {
  createMockWebSocket,
  generateTestAudio,
  getBinaryFrames,
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

describe('Web demo audio streaming', () => {
  it('streams compressed binary frames when client requests deflate', async () => {
    const sourceAudio = generateTestAudio(20_000);
    const handler = createVoiceWebSocketHandler({
      coreService: {
        synthesizeFromContext: jest.fn().mockResolvedValue({
          text: 'audio',
          audio: sourceAudio,
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

    const session = await waitForMessage(socket, 'session');
    socket.emitJson({
      type: 'init',
      vertical: 'dental',
      sessionId: session.sessionId,
      audio: {
        formats: ['ogg', 'wav'],
        compression: 'deflate',
        supportsDeflate: true,
        connectionSpeed: 'slow'
      }
    });
    await waitForMessage(socket, 'init');

    socket.emitJson({
      type: 'transcript',
      sessionId: session.sessionId,
      text: 'Daant checkup appointment'
    });

    const audioStart = await waitForMessage(socket, 'audio_start');
    await waitForMessage(socket, 'audio_end');

    expect(audioStart.compression).toBe('deflate');
    expect(audioStart.chunkSize).toBe(8192);

    const streamed = Buffer.concat(getBinaryFrames(socket));
    const inflated = inflateSync(streamed);
    expect(inflated.equals(sourceAudio)).toBe(true);
  });
});
