jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import express from 'express';
import request from 'supertest';

import { createCallFlowController } from '../src/controllers/call-flow.controller';
import type { ICallPlaybackAudio } from '../src/types/call.types';

interface ICallFlowServiceMock {
  startEchoBotCall: jest.Mock;
  handleRecordingAndGeneratePlayback: jest.Mock;
  getPlaybackAudio: jest.Mock;
}

const createTestApp = (callFlowServiceMock: ICallFlowServiceMock): express.Express => {
  const app = express();
  const controller = createCallFlowController({
    callFlowService: callFlowServiceMock as never
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.post('/webhook/call-start', controller.handleCallStartWebhook);
  app.post('/webhook/call-recording', (req, res) => {
    void controller.handleRecordingCallbackWebhook(req, res);
  });
  app.get('/media/call-audio/:audioId', controller.handlePlaybackAudioRequest);

  return app;
};

describe('App route integration (Phase 1 webhooks)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /webhook/call-start returns ExoML record response for form-encoded payload', async () => {
    const callFlowServiceMock: ICallFlowServiceMock = {
      startEchoBotCall: jest.fn().mockReturnValue({
        exotelResponse: {
          contentType: 'application/xml',
          body: '<?xml version="1.0"?><Response><Record /></Response>'
        },
        callSid: 'call-http-1'
      }),
      handleRecordingAndGeneratePlayback: jest.fn(),
      getPlaybackAudio: jest.fn()
    };

    const app = createTestApp(callFlowServiceMock);
    const response = await request(app)
      .post('/webhook/call-start')
      .type('form')
      .send({
        CallSid: 'call-http-1',
        From: '+919999000001',
        To: '+918888777766',
        Direction: 'incoming'
      });

    expect(response.status).toBe(200);
    expect(response.type).toContain('xml');
    expect(response.text).toContain('<Record');
    expect(callFlowServiceMock.startEchoBotCall).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ CallSid: 'call-http-1' }),
        recordingActionUrl: expect.stringContaining('/webhook/call-recording')
      })
    );
  });

  it('POST /webhook/call-recording returns ExoML play response on successful processing', async () => {
    const callFlowServiceMock: ICallFlowServiceMock = {
      startEchoBotCall: jest.fn(),
      handleRecordingAndGeneratePlayback: jest.fn().mockResolvedValue({
        exotelResponse: {
          contentType: 'application/xml',
          body: '<?xml version="1.0"?><Response><Play>https://example.com/audio.wav</Play></Response>'
        },
        callSid: 'call-http-2',
        responseText: 'Aapne kaha: test'
      }),
      getPlaybackAudio: jest.fn()
    };

    const app = createTestApp(callFlowServiceMock);
    const response = await request(app)
      .post('/webhook/call-recording')
      .type('form')
      .send({
        CallSid: 'call-http-2',
        RecordingUrl: 'https://example.com/recording.wav'
      });

    expect(response.status).toBe(200);
    expect(response.type).toContain('xml');
    expect(response.text).toContain('<Play>');
  });

  it('POST /webhook/call-recording returns 400 for invalid payload errors', async () => {
    const callFlowServiceMock: ICallFlowServiceMock = {
      startEchoBotCall: jest.fn(),
      handleRecordingAndGeneratePlayback: jest
        .fn()
        .mockRejectedValue(new Error('Invalid Exotel recording payload: RecordingUrl is missing.')),
      getPlaybackAudio: jest.fn()
    };

    const app = createTestApp(callFlowServiceMock);
    const response = await request(app).post('/webhook/call-recording').type('form').send({
      CallSid: 'call-http-3'
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'Invalid Exotel call recording payload'
      })
    );
  });

  it('GET /media/call-audio/:audioId returns audio when present', async () => {
    const playbackAudio: ICallPlaybackAudio = {
      audioId: 'audio-1',
      callSid: 'call-1',
      contentType: 'audio/wav',
      audio: Buffer.from([82, 73, 70, 70]),
      createdAtMs: Date.now(),
      responseText: 'Aapne kaha: test'
    };
    const callFlowServiceMock: ICallFlowServiceMock = {
      startEchoBotCall: jest.fn(),
      handleRecordingAndGeneratePlayback: jest.fn(),
      getPlaybackAudio: jest.fn().mockReturnValue(playbackAudio)
    };

    const app = createTestApp(callFlowServiceMock);
    const response = await request(app).get('/media/call-audio/audio-1');

    expect(response.status).toBe(200);
    expect(response.type).toContain('audio/wav');
    expect(response.header['x-bharatvoice-callsid']).toBe('call-1');
  });

  it('GET /media/call-audio/:audioId returns 404 when audio is missing/expired', async () => {
    const callFlowServiceMock: ICallFlowServiceMock = {
      startEchoBotCall: jest.fn(),
      handleRecordingAndGeneratePlayback: jest.fn(),
      getPlaybackAudio: jest.fn().mockReturnValue(undefined)
    };

    const app = createTestApp(callFlowServiceMock);
    const response = await request(app).get('/media/call-audio/missing-audio');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Audio not found' });
  });
});
