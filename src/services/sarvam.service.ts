import { config } from '../config';
import type {
  ISarvamAsrLanguage,
  ISarvamBcp47LanguageCode,
  ISarvamErrorBody,
  ISarvamSpeechToTextResponse,
  ISarvamTextToSpeechRequest,
  ISarvamTextToSpeechResponse,
  ISarvamTtsVoice,
  ISarvamVoiceProfile
} from '../types/sarvam.types';
import { downloadAudioFromUrl, isHttpAudioUrl } from '../utils/audio';
import { logger } from '../utils/logger';

const SARVAM_STT_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
const SARVAM_TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
const SARVAM_STT_MODEL = 'saaras:v3';
const SARVAM_STT_MODE = 'codemix';
const SARVAM_TTS_MODEL = 'bulbul:v3';
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 300;

const SARVAM_VOICE_PROFILES: Readonly<Record<ISarvamTtsVoice, ISarvamVoiceProfile>> = {
  meera: {
    appVoice: 'meera',
    sarvamSpeaker: 'ritu',
    voiceId: 'bv-meera-bulbul-v3',
    targetLanguageCode: 'hi-IN'
  },
  pavitra: {
    appVoice: 'pavitra',
    sarvamSpeaker: 'priya',
    voiceId: 'bv-pavitra-bulbul-v3',
    targetLanguageCode: 'hi-IN'
  }
};

interface ISarvamServiceDependencies {
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly nowFn?: () => number;
}

export class SarvamApiError extends Error {
  public readonly statusCode?: number;
  public readonly errorCode?: string;
  public readonly requestId?: string;
  public readonly retryable: boolean;

  public constructor(
    message: string,
    options?: {
      statusCode?: number;
      errorCode?: string;
      requestId?: string;
      retryable?: boolean;
      cause?: unknown;
    }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'SarvamApiError';
    this.statusCode = options?.statusCode;
    this.errorCode = options?.errorCode;
    this.requestId = options?.requestId;
    this.retryable = options?.retryable ?? false;
  }
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const mapLanguageCode = (language: ISarvamAsrLanguage): ISarvamBcp47LanguageCode => {
  if (language === 'hi-en') {
    return 'hi-IN';
  }

  return 'mr-IN';
};

const isRetryableStatusCode = (statusCode: number): boolean => {
  return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
};

const parseSarvamErrorBody = async (response: Response): Promise<ISarvamErrorBody | undefined> => {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  try {
    return (await response.json()) as ISarvamErrorBody;
  } catch {
    return undefined;
  }
};

const parseSarvamSuccessBody = async (response: Response): Promise<ISarvamSpeechToTextResponse> => {
  let parsedJson: unknown;

  try {
    parsedJson = await response.json();
  } catch (error: unknown) {
    throw new SarvamApiError('Sarvam STT response was not valid JSON.', {
      statusCode: response.status,
      retryable: false,
      cause: error
    });
  }

  if (typeof parsedJson !== 'object' || parsedJson === null) {
    throw new SarvamApiError('Sarvam STT response JSON was not an object.', {
      statusCode: response.status,
      retryable: false
    });
  }

  const transcript = 'transcript' in parsedJson ? parsedJson.transcript : undefined;

  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new SarvamApiError('Sarvam STT response did not contain a valid transcript.', {
      statusCode: response.status,
      retryable: false
    });
  }

  const requestId =
    'request_id' in parsedJson && (typeof parsedJson.request_id === 'string' || parsedJson.request_id === null)
      ? parsedJson.request_id
      : null;

  const languageCode =
    'language_code' in parsedJson &&
    (typeof parsedJson.language_code === 'string' || parsedJson.language_code === null)
      ? parsedJson.language_code
      : null;

  return {
    request_id: requestId,
    transcript,
    language_code: languageCode
  };
};

const parseSarvamTtsSuccessBody = async (response: Response): Promise<ISarvamTextToSpeechResponse> => {
  let parsedJson: unknown;

  try {
    parsedJson = await response.json();
  } catch (error: unknown) {
    throw new SarvamApiError('Sarvam TTS response was not valid JSON.', {
      statusCode: response.status,
      retryable: false,
      cause: error
    });
  }

  if (typeof parsedJson !== 'object' || parsedJson === null) {
    throw new SarvamApiError('Sarvam TTS response JSON was not an object.', {
      statusCode: response.status,
      retryable: false
    });
  }

  const rawAudios = 'audios' in parsedJson ? parsedJson.audios : undefined;

  if (!Array.isArray(rawAudios) || rawAudios.length === 0) {
    throw new SarvamApiError('Sarvam TTS response did not contain a valid audios array.', {
      statusCode: response.status,
      retryable: false
    });
  }

  const audios = rawAudios.filter((item): item is string => typeof item === 'string');

  if (audios.length !== rawAudios.length) {
    throw new SarvamApiError('Sarvam TTS response did not contain a valid audios array.', {
      statusCode: response.status,
      retryable: false
    });
  }

  const requestId =
    'request_id' in parsedJson && (typeof parsedJson.request_id === 'string' || parsedJson.request_id === null)
      ? parsedJson.request_id
      : null;

  return {
    request_id: requestId,
    audios
  };
};

const decodeBase64Audio = (audioBase64: string): Buffer => {
  try {
    const buffer = Buffer.from(audioBase64, 'base64');

    if (buffer.length === 0) {
      throw new Error('Decoded audio buffer is empty.');
    }

    return buffer;
  } catch (error: unknown) {
    throw new SarvamApiError('Failed to decode Sarvam TTS audio payload.', {
      retryable: false,
      cause: error
    });
  }
};

const normalizeMimeType = (mimeType: string | undefined): string => {
  const normalized = (mimeType ?? '').trim().toLowerCase();
  if (normalized.length === 0) {
    return 'audio/webm';
  }

  const semicolonIndex = normalized.indexOf(';');
  if (semicolonIndex === -1) {
    return normalized;
  }
  return normalized.slice(0, semicolonIndex).trim();
};

export class SarvamService {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;

  public constructor(dependencies?: ISarvamServiceDependencies) {
    this.fetchFn = dependencies?.fetchFn ?? fetch;
    this.sleepFn = dependencies?.sleepFn ?? sleep;
    this.nowFn = dependencies?.nowFn ?? Date.now;
  }

  public async transcribeAudio(audioUrl: string, language: ISarvamAsrLanguage): Promise<string> {
    if (!isHttpAudioUrl(audioUrl)) {
      throw new Error('Sarvam transcription requires a valid http(s) audio URL.');
    }

    const downloadedAudio = await downloadAudioFromUrl(audioUrl, this.fetchFn);
    return this.transcribeAudioBlob(downloadedAudio.blob, downloadedAudio.fileName, language);
  }

  public async transcribeAudioBuffer(
    audioBuffer: Buffer,
    language: ISarvamAsrLanguage,
    options?: {
      readonly fileName?: string;
      readonly mimeType?: string;
    }
  ): Promise<string> {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new Error('Sarvam transcription requires a non-empty audio buffer.');
    }

    const fileName = options?.fileName ?? 'web-demo-audio.webm';
    const mimeType = normalizeMimeType(options?.mimeType);
    const blobBytes = new Uint8Array(audioBuffer);
    const blob = new Blob([blobBytes], { type: mimeType });
    return this.transcribeAudioBlob(blob, fileName, language);
  }

  private async transcribeAudioBlob(
    audioBlob: Blob,
    fileName: string,
    language: ISarvamAsrLanguage
  ): Promise<string> {
    const mappedLanguageCode = mapLanguageCode(language);

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      const startedAtMs = this.nowFn();

      try {
        const transcriptResponse = await this.requestTranscription({
          file: audioBlob,
          fileName,
          languageCode: mappedLanguageCode
        });

        logger.info('Sarvam STT transcription succeeded', {
          eventType: 'sarvam.stt.success',
          endpoint: SARVAM_STT_ENDPOINT,
          model: SARVAM_STT_MODEL,
          mode: SARVAM_STT_MODE,
          language,
          mappedLanguageCode,
          requestId: transcriptResponse.request_id,
          latencyMs: this.nowFn() - startedAtMs,
          attempt
        });

        return transcriptResponse.transcript.trim();
      } catch (error: unknown) {
        const normalizedError =
          error instanceof SarvamApiError
            ? error
            : new SarvamApiError('Sarvam STT request failed due to a network or unexpected error.', {
                retryable: true,
                cause: error
              });

        logger.error('Sarvam STT transcription failed', {
          eventType: 'sarvam.stt.error',
          endpoint: SARVAM_STT_ENDPOINT,
          model: SARVAM_STT_MODEL,
          mode: SARVAM_STT_MODE,
          language,
          mappedLanguageCode,
          latencyMs: this.nowFn() - startedAtMs,
          attempt,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          statusCode: normalizedError.statusCode,
          errorCode: normalizedError.errorCode,
          requestId: normalizedError.requestId,
          retryable: normalizedError.retryable,
          message: normalizedError.message
        });

        const shouldRetry = normalizedError.retryable && attempt < MAX_RETRY_ATTEMPTS;

        if (!shouldRetry) {
          throw normalizedError;
        }

        const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
        await this.sleepFn(delayMs);
      }
    }

    throw new SarvamApiError('Sarvam STT transcription failed after retries.');
  }

  public async synthesizeSpeech(text: string, voice: ISarvamTtsVoice): Promise<Buffer> {
    const normalizedText = text.trim();

    if (normalizedText.length === 0) {
      throw new Error('Sarvam TTS requires non-empty text.');
    }

    const voiceProfile = SARVAM_VOICE_PROFILES[voice];

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      const startedAtMs = this.nowFn();

      try {
        const ttsResponse = await this.requestSpeechSynthesis({
          text: normalizedText,
          target_language_code: voiceProfile.targetLanguageCode,
          speaker: voiceProfile.sarvamSpeaker,
          model: SARVAM_TTS_MODEL,
          output_audio_codec: 'wav'
        });

        const firstAudio = ttsResponse.audios[0];
        const audioBuffer = decodeBase64Audio(firstAudio);

        logger.info('Sarvam TTS synthesis succeeded', {
          eventType: 'sarvam.tts.success',
          endpoint: SARVAM_TTS_ENDPOINT,
          model: SARVAM_TTS_MODEL,
          voice,
          speaker: voiceProfile.sarvamSpeaker,
          voiceId: voiceProfile.voiceId,
          requestId: ttsResponse.request_id,
          latencyMs: this.nowFn() - startedAtMs,
          attempt,
          bytes: audioBuffer.length
        });

        return audioBuffer;
      } catch (error: unknown) {
        const normalizedError =
          error instanceof SarvamApiError
            ? error
            : new SarvamApiError('Sarvam TTS request failed due to a network or unexpected error.', {
                retryable: true,
                cause: error
              });

        logger.error('Sarvam TTS synthesis failed', {
          eventType: 'sarvam.tts.error',
          endpoint: SARVAM_TTS_ENDPOINT,
          model: SARVAM_TTS_MODEL,
          voice,
          speaker: voiceProfile.sarvamSpeaker,
          voiceId: voiceProfile.voiceId,
          latencyMs: this.nowFn() - startedAtMs,
          attempt,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          statusCode: normalizedError.statusCode,
          errorCode: normalizedError.errorCode,
          requestId: normalizedError.requestId,
          retryable: normalizedError.retryable,
          message: normalizedError.message
        });

        const shouldRetry = normalizedError.retryable && attempt < MAX_RETRY_ATTEMPTS;

        if (!shouldRetry) {
          throw normalizedError;
        }

        const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1);
        await this.sleepFn(delayMs);
      }
    }

    throw new SarvamApiError('Sarvam TTS synthesis failed after retries.');
  }

  private async requestTranscription(input: {
    readonly file: Blob;
    readonly fileName: string;
    readonly languageCode: ISarvamBcp47LanguageCode;
  }): Promise<ISarvamSpeechToTextResponse> {
    const formData = new FormData();
    formData.set('file', input.file, input.fileName);
    formData.set('model', SARVAM_STT_MODEL);
    formData.set('mode', SARVAM_STT_MODE);
    formData.set('language_code', input.languageCode);

    let response: Response;

    try {
      response = await this.fetchFn(SARVAM_STT_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-subscription-key': config.integrations.sarvam.apiKey
        },
        body: formData
      });
    } catch (error: unknown) {
      throw new SarvamApiError('Failed to reach Sarvam STT API.', {
        retryable: true,
        cause: error
      });
    }

    if (!response.ok) {
      const errorBody = await parseSarvamErrorBody(response);
      const errorMessage =
        errorBody?.error?.message ??
        `Sarvam STT API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;

      throw new SarvamApiError(errorMessage, {
        statusCode: response.status,
        errorCode: errorBody?.error?.code,
        requestId: errorBody?.error?.request_id,
        retryable: isRetryableStatusCode(response.status)
      });
    }

    return parseSarvamSuccessBody(response);
  }

  private async requestSpeechSynthesis(
    payload: ISarvamTextToSpeechRequest
  ): Promise<ISarvamTextToSpeechResponse> {
    let response: Response;

    try {
      response = await this.fetchFn(SARVAM_TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-subscription-key': config.integrations.sarvam.apiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error: unknown) {
      throw new SarvamApiError('Failed to reach Sarvam TTS API.', {
        retryable: true,
        cause: error
      });
    }

    if (!response.ok) {
      const errorBody = await parseSarvamErrorBody(response);
      const errorMessage =
        errorBody?.error?.message ??
        `Sarvam TTS API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;

      throw new SarvamApiError(errorMessage, {
        statusCode: response.status,
        errorCode: errorBody?.error?.code,
        requestId: errorBody?.error?.request_id,
        retryable: isRetryableStatusCode(response.status)
      });
    }

    return parseSarvamTtsSuccessBody(response);
  }
}
