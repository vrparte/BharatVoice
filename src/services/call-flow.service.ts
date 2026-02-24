import { randomUUID } from 'crypto';

import { ExotelService } from './exotel.service';
import { SarvamService } from './sarvam.service';
import { VoiceService } from './voice.service';
import type { ICallPlaybackAudio } from '../types/call.types';
import { logger } from '../utils/logger';

interface ICallFlowServiceDependencies {
  readonly exotelService?: ExotelService;
  readonly sarvamService?: SarvamService;
  readonly voiceService?: VoiceService;
  readonly nowFn?: () => number;
  readonly idGenerator?: () => string;
}

interface IStartCallFlowInput {
  readonly payload: unknown;
  readonly recordingActionUrl: string;
}

interface IHandleRecordingFlowInput {
  readonly payload: unknown;
  readonly playbackBaseUrl: string;
}

interface ICallFlowResult {
  readonly exotelResponse: {
    readonly contentType: 'application/xml';
    readonly body: string;
  };
  readonly callSid: string;
}

interface IStoredPlaybackAudioResult {
  readonly audioId: string;
  readonly playbackUrl: string;
}

interface IPlaybackStoreEntry extends ICallPlaybackAudio {}

const PLAYBACK_CACHE_TTL_MS = 10 * 60 * 1000;
const PLAYBACK_CACHE_MAX_ENTRIES = 200;
const FALLBACK_HINDI_MESSAGE = 'Maaf kijiye, main aapki baat samajh nahi paaya. Kripya dobara kahiye.';
const RECORDING_PROMPT_MESSAGE = 'Namaste. Kripya apni baat kahiye. Hum aapki awaz record kar rahe hain.';

export class CallFlowService {
  private readonly exotelService: ExotelService;
  private readonly sarvamService: SarvamService;
  private readonly voiceService: VoiceService;
  private readonly nowFn: () => number;
  private readonly idGenerator: () => string;
  private readonly playbackStore = new Map<string, IPlaybackStoreEntry>();

  public constructor(dependencies?: ICallFlowServiceDependencies) {
    this.exotelService = dependencies?.exotelService ?? new ExotelService();
    this.sarvamService = dependencies?.sarvamService ?? new SarvamService();
    this.voiceService = dependencies?.voiceService ?? new VoiceService();
    this.nowFn = dependencies?.nowFn ?? Date.now;
    this.idGenerator = dependencies?.idGenerator ?? randomUUID;
  }

  public startEchoBotCall(input: IStartCallFlowInput): ICallFlowResult {
    const incomingCall = this.exotelService.parseIncomingCallWebhook(input.payload);
    const exotelResponse = this.exotelService.buildRecordResponse({
      prompt: RECORDING_PROMPT_MESSAGE,
      actionUrl: input.recordingActionUrl,
      maxLengthSeconds: 8
    });

    logger.info('Echo bot call started', {
      eventType: 'call_flow.start',
      provider: 'exotel',
      callSid: incomingCall.callSid,
      from: incomingCall.from,
      to: incomingCall.to,
      direction: incomingCall.direction
    });

    return {
      exotelResponse,
      callSid: incomingCall.callSid
    };
  }

  public async handleRecordingAndGeneratePlayback(
    input: IHandleRecordingFlowInput
  ): Promise<ICallFlowResult & { readonly transcription?: string; readonly responseText: string }> {
    const flowStartedAtMs = this.nowFn();
    const recordingEvent = this.exotelService.parseRecordingWebhook(input.payload);
    const downloadAndAsrStartedAtMs = this.nowFn();

    try {
      const transcription = await this.sarvamService.transcribeAudio(recordingEvent.recordingUrl, 'hi-en');
      const asrCompletedAtMs = this.nowFn();
      const responseText = `Aapne kaha: ${transcription}`;

      const ttsStartedAtMs = this.nowFn();
      const audioBuffer = await this.voiceService.synthesizeSpeech(responseText, 'meera');
      const ttsCompletedAtMs = this.nowFn();

      const playback = this.storePlaybackAudioWithBaseUrl({
        callSid: recordingEvent.callSid,
        audio: audioBuffer,
        responseText,
        playbackBaseUrl: input.playbackBaseUrl
      });

      const exotelResponse = this.exotelService.buildPlayAndHangupResponse(playback.playbackUrl);

      logger.info('Echo bot call flow completed', {
        eventType: 'call_flow.completed',
        provider: 'exotel',
        callSid: recordingEvent.callSid,
        transcription,
        responseText,
        recordingUrl: recordingEvent.recordingUrl,
        playbackUrl: playback.playbackUrl,
        timingMs: {
          asrTotal: asrCompletedAtMs - downloadAndAsrStartedAtMs,
          tts: ttsCompletedAtMs - ttsStartedAtMs,
          total: this.nowFn() - flowStartedAtMs
        }
      });

      return {
        exotelResponse,
        callSid: recordingEvent.callSid,
        transcription,
        responseText
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown call flow processing error';

      logger.error('Echo bot call flow failed, using fallback message', {
        eventType: 'call_flow.error',
        provider: 'exotel',
        callSid: recordingEvent.callSid,
        recordingUrl: recordingEvent.recordingUrl,
        error: errorMessage,
        timingMs: {
          total: this.nowFn() - flowStartedAtMs
        }
      });

      return {
        exotelResponse: this.exotelService.buildSayResponse(FALLBACK_HINDI_MESSAGE),
        callSid: recordingEvent.callSid,
        responseText: FALLBACK_HINDI_MESSAGE
      };
    }
  }

  public getPlaybackAudio(audioId: string): ICallPlaybackAudio | undefined {
    const entry = this.playbackStore.get(audioId);

    if (!entry) {
      return undefined;
    }

    if (this.nowFn() - entry.createdAtMs >= PLAYBACK_CACHE_TTL_MS) {
      this.playbackStore.delete(audioId);
      return undefined;
    }

    return {
      ...entry,
      audio: Buffer.from(entry.audio)
    };
  }

  public storePlaybackAudioWithBaseUrl(input: {
    readonly callSid: string;
    readonly audio: Buffer;
    readonly responseText: string;
    readonly playbackBaseUrl: string;
  }): IStoredPlaybackAudioResult {
    this.evictExpiredPlayback();

    const audioId = this.idGenerator();
    const createdAtMs = this.nowFn();
    const normalizedBaseUrl = input.playbackBaseUrl.endsWith('/')
      ? input.playbackBaseUrl
      : `${input.playbackBaseUrl}/`;

    this.playbackStore.set(audioId, {
      audioId,
      callSid: input.callSid,
      contentType: this.voiceService.getAudioContentType(),
      audio: Buffer.from(input.audio),
      createdAtMs,
      responseText: input.responseText
    });

    this.evictIfNeeded();

    return {
      audioId,
      playbackUrl: `${normalizedBaseUrl}${audioId}`
    };
  }

  private evictExpiredPlayback(): void {
    for (const [audioId, entry] of this.playbackStore.entries()) {
      if (this.nowFn() - entry.createdAtMs >= PLAYBACK_CACHE_TTL_MS) {
        this.playbackStore.delete(audioId);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.playbackStore.size > PLAYBACK_CACHE_MAX_ENTRIES) {
      const oldestKey = this.playbackStore.keys().next().value as string | undefined;

      if (!oldestKey) {
        return;
      }

      this.playbackStore.delete(oldestKey);
    }
  }
}
