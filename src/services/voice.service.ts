import { createHash } from 'crypto';

import type { ISarvamTtsVoice } from '../types/sarvam.types';
import { logger } from '../utils/logger';

import { SarvamService } from './sarvam.service';

interface IVoiceCacheEntry {
  readonly audio: Buffer;
  readonly createdAtMs: number;
  readonly contentType: 'audio/wav';
  readonly voiceId: string;
}

interface IVoiceServiceDependencies {
  readonly sarvamService?: SarvamService;
  readonly nowFn?: () => number;
}

interface IVoiceProfileConfig {
  readonly voiceId: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

const VOICE_PROFILES: Readonly<Record<ISarvamTtsVoice, IVoiceProfileConfig>> = {
  meera: {
    voiceId: 'bv-meera-bulbul-v3'
  },
  pavitra: {
    voiceId: 'bv-pavitra-bulbul-v3'
  },
  ratan: {
    voiceId: 'bv-ratan-bulbul-v3'
  }
};

const buildCacheKey = (text: string, voice: ISarvamTtsVoice): string => {
  return createHash('sha256').update(`${voice}:${text}`).digest('hex');
};

export class VoiceService {
  private readonly sarvamService: SarvamService;
  private readonly nowFn: () => number;
  private readonly cache = new Map<string, IVoiceCacheEntry>();

  public constructor(dependencies?: IVoiceServiceDependencies) {
    this.sarvamService = dependencies?.sarvamService ?? new SarvamService();
    this.nowFn = dependencies?.nowFn ?? Date.now;
  }

  public async synthesizeSpeech(text: string, voice: ISarvamTtsVoice): Promise<Buffer> {
    const normalizedText = text.trim();

    if (normalizedText.length === 0) {
      throw new Error('Text is required for speech synthesis.');
    }

    const cacheKey = buildCacheKey(normalizedText, voice);
    const now = this.nowFn();
    const cachedEntry = this.cache.get(cacheKey);

    if (cachedEntry && now - cachedEntry.createdAtMs < CACHE_TTL_MS) {
      logger.info('Voice cache hit', {
        eventType: 'voice.tts.cache_hit',
        voice,
        voiceId: cachedEntry.voiceId,
        bytes: cachedEntry.audio.length
      });
      return Buffer.from(cachedEntry.audio);
    }

    if (cachedEntry) {
      this.cache.delete(cacheKey);
    }

    const audioBuffer = await this.sarvamService.synthesizeSpeech(normalizedText, voice);
    const voiceProfile = VOICE_PROFILES[voice];
    const entry: IVoiceCacheEntry = {
      audio: Buffer.from(audioBuffer),
      createdAtMs: now,
      contentType: 'audio/wav',
      voiceId: voiceProfile.voiceId
    };

    this.cache.set(cacheKey, entry);
    this.evictIfNeeded();

    logger.info('Voice cache store', {
      eventType: 'voice.tts.cache_store',
      voice,
      voiceId: voiceProfile.voiceId,
      bytes: audioBuffer.length,
      cacheSize: this.cache.size
    });

    return Buffer.from(audioBuffer);
  }

  public getVoiceId(voice: ISarvamTtsVoice): string {
    return VOICE_PROFILES[voice].voiceId;
  }

  public getAudioContentType(): 'audio/wav' {
    return 'audio/wav';
  }

  private evictIfNeeded(): void {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        return;
      }

      this.cache.delete(oldestKey);
    }
  }
}
