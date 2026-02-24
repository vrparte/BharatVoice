jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import { SarvamService } from '../src/services/sarvam.service';

interface IMockFetchCall {
  readonly url: string | URL | Request;
  readonly init?: RequestInit;
}

const createJsonResponse = (body: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
};

describe('SarvamService', () => {
  it('transcribes Hinglish audio and sends Sarvam codemix request', async () => {
    const fetchCalls: IMockFetchCall[] = [];
    const sleepFn = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    const nowFn = jest
      .fn<number, []>()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1125);

    const fetchMock = jest
      .fn<Promise<Response>, [string | URL | Request, RequestInit?]>()
      .mockImplementationOnce(async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: {
            'content-type': 'audio/wav'
          }
        });
      })
      .mockImplementationOnce(async (url, init) => {
        fetchCalls.push({ url, init });
        return createJsonResponse({
          request_id: 'req-123',
          transcript: 'Hello ji, aapka call receive ho gaya hai',
          language_code: 'hi-IN'
        });
      });

    const sarvamService = new SarvamService({
      fetchFn: fetchMock as unknown as typeof fetch,
      sleepFn,
      nowFn
    });

    const transcript = await sarvamService.transcribeAudio(
      'https://cdn.example.com/audio/test-call.wav',
      'hi-en'
    );

    expect(transcript).toBe('Hello ji, aapka call receive ho gaya hai');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepFn).not.toHaveBeenCalled();

    const audioDownloadCall = fetchCalls[0];
    expect(audioDownloadCall.url).toBe('https://cdn.example.com/audio/test-call.wav');
    expect(audioDownloadCall.init?.method).toBe('GET');

    const sarvamApiCall = fetchCalls[1];
    expect(sarvamApiCall.url).toBe('https://api.sarvam.ai/speech-to-text');
    expect(sarvamApiCall.init?.method).toBe('POST');
    expect(sarvamApiCall.init?.headers).toEqual(
      expect.objectContaining({
        'api-subscription-key': expect.any(String)
      })
    );

    const body = sarvamApiCall.init?.body;
    expect(body).toBeInstanceOf(FormData);

    const formData = body as FormData;
    expect(formData.get('model')).toBe('saaras:v3');
    expect(formData.get('mode')).toBe('codemix');
    expect(formData.get('language_code')).toBe('hi-IN');
    expect(formData.get('file')).toBeInstanceOf(File);
  });

  it('retries on retryable Sarvam API errors with exponential backoff', async () => {
    const sleepFn = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
    const nowFn = jest
      .fn<number, []>()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2120)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3200);

    const fetchMock = jest
      .fn<Promise<Response>, [string | URL | Request, RequestInit?]>()
      .mockImplementationOnce(async () => {
        return new Response(new Uint8Array([9, 9, 9]), {
          status: 200,
          headers: { 'content-type': 'audio/wav' }
        });
      })
      .mockImplementationOnce(async () => {
        return createJsonResponse(
          {
            error: {
              message: 'Service temporarily overloaded',
              code: 'rate_limit_exceeded_error',
              request_id: 'req-fail-1'
            }
          },
          { status: 503 }
        );
      })
      .mockImplementationOnce(async () => {
        return createJsonResponse(
          {
            error: {
              message: 'Service temporarily overloaded',
              code: 'rate_limit_exceeded_error',
              request_id: 'req-fail-2'
            }
          },
          { status: 503 }
        );
      })
      .mockImplementationOnce(async () => {
        return createJsonResponse({
          request_id: 'req-ok',
          transcript: 'Namaskar, tumcha call receive zala aahe',
          language_code: 'mr-IN'
        });
      });

    const sarvamService = new SarvamService({
      fetchFn: fetchMock as unknown as typeof fetch,
      sleepFn,
      nowFn
    });

    const transcript = await sarvamService.transcribeAudio(
      'https://cdn.example.com/audio/test-call-mr.wav',
      'mr-hi'
    );

    expect(transcript).toBe('Namaskar, tumcha call receive zala aahe');
    expect(sleepFn).toHaveBeenNthCalledWith(1, 300);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 600);
  });

  it('synthesizes Hinglish speech with Bulbul v3 and returns audio buffer', async () => {
    const ttsAudioBuffer = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]);
    const ttsAudioBase64 = ttsAudioBuffer.toString('base64');
    const fetchCalls: IMockFetchCall[] = [];
    const nowFn = jest
      .fn<number, []>()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1140);

    const fetchMock = jest
      .fn<Promise<Response>, [string | URL | Request, RequestInit?]>()
      .mockImplementationOnce(async (url, init) => {
        fetchCalls.push({ url, init });
        return createJsonResponse({
          request_id: 'tts-req-1',
          audios: [ttsAudioBase64]
        });
      });

    const sarvamService = new SarvamService({
      fetchFn: fetchMock as unknown as typeof fetch,
      nowFn
    });

    const result = await sarvamService.synthesizeSpeech('Namaste ji, aapka call receive hua.', 'meera');

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(ttsAudioBuffer)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const apiCall = fetchCalls[0];
    expect(apiCall.url).toBe('https://api.sarvam.ai/text-to-speech');
    expect(apiCall.init?.method).toBe('POST');
    expect(apiCall.init?.headers).toEqual(
      expect.objectContaining({
        'api-subscription-key': expect.any(String),
        'content-type': 'application/json'
      })
    );

    const body = JSON.parse((apiCall.init?.body as string) ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('bulbul:v3');
    expect(body.target_language_code).toBe('hi-IN');
    expect(body.speaker).toBe('Ritu');
    expect(body.output_audio_codec).toBe('wav');
  });
});
