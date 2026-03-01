jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import type { Request, Response } from 'express';

import { createCallFlowController } from '../src/controllers/call-flow.controller';
import { CallFlowService } from '../src/services/call-flow.service';
import { ExotelService } from '../src/services/exotel.service';
import type { SarvamService } from '../src/services/sarvam.service';
import type { VoiceService } from '../src/services/voice.service';
import { logger } from '../src/utils/logger';

interface IMockResponse {
  readonly res: Response;
  readonly statusMock: jest.Mock;
  readonly jsonMock: jest.Mock;
  readonly sendMock: jest.Mock;
  readonly typeMock: jest.Mock;
  readonly setHeaderMock: jest.Mock;
}

const createMockResponse = (): IMockResponse => {
  const statusMock = jest.fn();
  const jsonMock = jest.fn();
  const sendMock = jest.fn();
  const typeMock = jest.fn();
  const setHeaderMock = jest.fn();

  const response = {
    status: statusMock,
    json: jsonMock,
    send: sendMock,
    type: typeMock,
    setHeader: setHeaderMock
  } as unknown as Response;

  statusMock.mockReturnValue(response);
  jsonMock.mockReturnValue(response);
  sendMock.mockReturnValue(response);
  typeMock.mockReturnValue(response);
  setHeaderMock.mockReturnValue(response);

  return { res: response, statusMock, jsonMock, sendMock, typeMock, setHeaderMock };
};

const createMockRequest = (input: {
  readonly body?: Record<string, unknown>;
  readonly params?: Record<string, string>;
  readonly host?: string;
  readonly protocol?: string;
  readonly headers?: Record<string, string>;
}): Request => {
  const headers = input.headers ?? {};
  const host = input.host ?? 'localhost:3000';
  const protocol = input.protocol ?? 'https';

  return {
    body: input.body ?? {},
    params: input.params ?? {},
    headers,
    protocol,
    get: (name: string): string | undefined => {
      if (name.toLowerCase() === 'host') {
        return host;
      }

      return headers[name] ?? headers[name.toLowerCase()];
    }
  } as unknown as Request;
};

describe('Echo bot call flow integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles call start -> recording callback -> playback audio with mocked Sarvam APIs', async () => {
    const ttsAudio = Buffer.from([82, 73, 70, 70, 10, 20, 30, 40]);
    const sarvamServiceMock = {
      transcribeAudio: jest.fn<Promise<string>, [string, 'hi-en' | 'mr-hi']>().mockResolvedValue('mera naam Rahul hai')
    } as unknown as SarvamService;
    const voiceServiceMock = {
      synthesizeSpeech: jest.fn<Promise<Buffer>, [string, 'meera' | 'pavitra']>().mockResolvedValue(ttsAudio),
      getAudioContentType: jest.fn<'audio/wav', []>().mockReturnValue('audio/wav'),
      getVoiceId: jest.fn<string, ['meera' | 'pavitra']>().mockReturnValue('bv-meera-bulbul-v3')
    } as unknown as VoiceService;

    const callFlowService = new CallFlowService({
      exotelService: new ExotelService(),
      sarvamService: sarvamServiceMock,
      voiceService: voiceServiceMock,
      nowFn: jest
        .fn<number, []>()
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1010)
        .mockReturnValueOnce(1100)
        .mockReturnValueOnce(1120)
        .mockReturnValueOnce(1200)
        .mockReturnValueOnce(1300)
        .mockReturnValueOnce(1400)
        .mockReturnValueOnce(1500),
      idGenerator: () => 'audio-123'
    });
    const controller = createCallFlowController({ callFlowService });

    const callStartReq = createMockRequest({
      body: {
        CallSid: 'call-echo-1',
        From: '+919999111111',
        To: '+918888777766',
        Direction: 'incoming'
      }
    });
    const callStartRes = createMockResponse();

    controller.handleCallStartWebhook(callStartReq, callStartRes.res);

    expect(callStartRes.statusMock).toHaveBeenCalledWith(200);
    expect(callStartRes.typeMock).toHaveBeenCalledWith('application/xml');
    const callStartXml = callStartRes.sendMock.mock.calls[0][0] as string;
    expect(callStartXml).toContain('<Record');
    expect(callStartXml).toContain('action="https://localhost:3000/webhook/call-recording"');

    const recordingReq = createMockRequest({
      body: {
        CallSid: 'call-echo-1',
        RecordingUrl: 'https://api.exotel.com/v1/recordings/call-echo-1.wav',
        From: '+919999111111',
        To: '+918888777766',
        Direction: 'incoming'
      }
    });
    const recordingRes = createMockResponse();

    await controller.handleRecordingCallbackWebhook(recordingReq, recordingRes.res);

    expect(sarvamServiceMock.transcribeAudio).toHaveBeenCalledWith(
      'https://api.exotel.com/v1/recordings/call-echo-1.wav',
      'hi-en'
    );
    expect(voiceServiceMock.synthesizeSpeech).toHaveBeenCalledWith('Aapne kaha: mera naam Rahul hai', 'meera');

    expect(recordingRes.statusMock).toHaveBeenCalledWith(200);
    expect(recordingRes.typeMock).toHaveBeenCalledWith('application/xml');
    const recordingXml = recordingRes.sendMock.mock.calls[0][0] as string;
    expect(recordingXml).toContain('<Play>https://localhost:3000/media/call-audio/audio-123</Play>');

    const mediaReq = createMockRequest({
      params: { audioId: 'audio-123' }
    });
    const mediaRes = createMockResponse();

    controller.handlePlaybackAudioRequest(mediaReq, mediaRes.res);

    expect(mediaRes.statusMock).toHaveBeenCalledWith(200);
    expect(mediaRes.typeMock).toHaveBeenCalledWith('audio/wav');
    expect(mediaRes.sendMock).toHaveBeenCalledWith(expect.any(Buffer));
    const returnedBuffer = mediaRes.sendMock.mock.calls[0][0] as Buffer;
    expect(returnedBuffer.equals(ttsAudio)).toBe(true);
  });

  it('plays fallback Hindi message when ASR fails', async () => {
    const sarvamServiceMock = {
      transcribeAudio: jest.fn<Promise<string>, [string, 'hi-en' | 'mr-hi']>().mockRejectedValue(new Error('ASR down'))
    } as unknown as SarvamService;
    const voiceServiceMock = {
      synthesizeSpeech: jest.fn<Promise<Buffer>, [string, 'meera' | 'pavitra']>(),
      getAudioContentType: jest.fn<'audio/wav', []>().mockReturnValue('audio/wav'),
      getVoiceId: jest.fn<string, ['meera' | 'pavitra']>().mockReturnValue('bv-meera-bulbul-v3')
    } as unknown as VoiceService;

    const controller = createCallFlowController({
      callFlowService: new CallFlowService({
        exotelService: new ExotelService(),
        sarvamService: sarvamServiceMock,
        voiceService: voiceServiceMock
      })
    });

    const req = createMockRequest({
      body: {
        CallSid: 'call-fallback-1',
        RecordingUrl: 'https://api.exotel.com/v1/recordings/call-fallback-1.wav'
      }
    });
    const res = createMockResponse();

    await controller.handleRecordingCallbackWebhook(req, res.res);

    expect(res.statusMock).toHaveBeenCalledWith(200);
    const xml = res.sendMock.mock.calls[0][0] as string;
    expect(xml).toContain('<Say>');
    expect(xml).toContain('Maaf kijiye');
    expect(voiceServiceMock.synthesizeSpeech).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Echo bot call flow failed, using fallback message',
      expect.objectContaining({
        eventType: 'call_flow.error',
        callSid: 'call-fallback-1'
      })
    );
  });
});
