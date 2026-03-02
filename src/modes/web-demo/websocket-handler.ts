import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { deflateSync } from 'zlib';

import type { WebSocket } from 'ws';

import { createVerticalService, detectVerticalFromLanguage } from '../../core/verticals';
import type { ConversationContext } from '../../core/conversation/state-machine';
import { ConversationState } from '../../core/conversation/state-machine';
import { ResponseGenerator } from '../../core/conversation/response-generator';
import type { ICoreConversationMessage, VoiceAgentCoreService } from '../../core/voice-agent-core.service';
import { SarvamService } from '../../services/sarvam.service';
import type { ISarvamAsrLanguage } from '../../types/sarvam.types';
import type { ISarvamTtsVoice } from '../../types/sarvam.types';

import type { WebDemoAnalyticsTracker } from './analytics';
import { webDemoConfig } from './config';
import type { WebDemoErrorManager } from './error-handler';
import type {
  IConversationHistoryItem,
  IWebDemoSession,
  IWebDemoVertical,
  WebDemoSessionStore
} from './session-store';

interface IWebSocketHandlerDependencies {
  readonly coreService: VoiceAgentCoreService;
  readonly sessionStore: WebDemoSessionStore;
  readonly errorManager: WebDemoErrorManager;
  readonly analytics: WebDemoAnalyticsTracker;
  readonly sarvamService?: SarvamService;
}

type IAudioFormat = 'wav' | 'mp3' | 'ogg';
type IAudioCompression = 'none' | 'deflate';

interface IAudioPreferences {
  readonly formats?: IAudioFormat[];
  readonly compression?: IAudioCompression;
  readonly supportsDeflate?: boolean;
  readonly connectionSpeed?: 'fast' | 'normal' | 'slow';
}

interface IInitMessage {
  readonly type: 'init';
  readonly vertical: IWebDemoVertical;
  readonly sessionId?: string;
  readonly audio?: IAudioPreferences;
  readonly preloadVoices?: boolean;
}

interface ITranscriptMessage {
  readonly type: 'transcript';
  readonly text: string;
  readonly vertical?: IWebDemoVertical;
  readonly sessionId?: string;
}

interface IAnalyticsClientMessage {
  readonly type: 'analytics';
  readonly sessionId?: string;
  readonly eventName: 'conversion_clicked';
  readonly payload: {
    readonly ctaType: 'pricing' | 'contact';
  };
}

interface IAudioInputMessage {
  readonly type?: 'audio_input' | 'audio' | 'voice_input';
  readonly sessionId?: string;
  readonly vertical?: IWebDemoVertical;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly language?: ISarvamAsrLanguage;
  readonly audioBase64: string;
}

interface IResolvedAudioProfile {
  readonly requestedFormat: IAudioFormat;
  readonly actualFormat: IAudioFormat;
  readonly mimeType: string;
  readonly compression: IAudioCompression;
  readonly slowConnection: boolean;
}

interface IAudioCacheEntry {
  readonly audio: Buffer;
  readonly createdAtMs: number;
  readonly hits: number;
}

const AUDIO_CACHE_TTL_MS = 30 * 60 * 1000;
const AUDIO_CACHE_MAX_ENTRIES = 200;
const AUDIO_CHUNK_SIZE_FAST = 16 * 1024;
const AUDIO_CHUNK_SIZE_SLOW = 8 * 1024;
const MAX_AUDIO_INPUT_BYTES = 2 * 1024 * 1024;

const AUDIO_MIME: Readonly<Record<IAudioFormat, string>> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg'
};

const isInitMessage = (payload: unknown): payload is IInitMessage => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  const validVertical =
    candidate.vertical === 'dental' || candidate.vertical === 'auto' || candidate.vertical === 'legal';
  return candidate.type === 'init' && validVertical;
};

const isTranscriptMessage = (payload: unknown): payload is ITranscriptMessage => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  const validVertical =
    candidate.vertical === undefined ||
    candidate.vertical === 'dental' ||
    candidate.vertical === 'auto' ||
    candidate.vertical === 'legal';
  return candidate.type === 'transcript' && typeof candidate.text === 'string' && validVertical;
};

const isAnalyticsClientMessage = (payload: unknown): payload is IAnalyticsClientMessage => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.type !== 'analytics' || candidate.eventName !== 'conversion_clicked') {
    return false;
  }
  if (candidate.sessionId !== undefined && typeof candidate.sessionId !== 'string') {
    return false;
  }
  if (typeof candidate.payload !== 'object' || candidate.payload === null) {
    return false;
  }
  const payloadCandidate = candidate.payload as Record<string, unknown>;
  return payloadCandidate.ctaType === 'pricing' || payloadCandidate.ctaType === 'contact';
};

const isAudioInputMessage = (payload: unknown): payload is IAudioInputMessage => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  const validType =
    candidate.type === undefined ||
    candidate.type === 'audio_input' ||
    candidate.type === 'audio' ||
    candidate.type === 'voice_input';
  const validVertical =
    candidate.vertical === undefined ||
    candidate.vertical === 'dental' ||
    candidate.vertical === 'auto' ||
    candidate.vertical === 'legal';
  const validLanguage =
    candidate.language === undefined || candidate.language === 'hi-en' || candidate.language === 'mr-hi';
  return (
    validType &&
    typeof candidate.audioBase64 === 'string' &&
    validVertical &&
    validLanguage
  );
};

const parseRequestUrl = (request: IncomingMessage): URL => {
  const host = request.headers.host ?? 'localhost';
  const requestPath = request.url ?? '/ws/voice';
  return new URL(requestPath, `http://${host}`);
};

const readMetadataFromRequest = (request: IncomingMessage): {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly referrer: string;
  readonly country: string;
  readonly city: string;
} => {
  const forwardedFor = request.headers['x-forwarded-for'];
  const ip =
    typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : request.socket.remoteAddress ?? '';
  const userAgent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '';
  const referrer =
    typeof request.headers.referer === 'string'
      ? request.headers.referer
      : typeof request.headers.origin === 'string'
        ? request.headers.origin
        : '';

  return {
    ipAddress: ip || 'unknown',
    userAgent: userAgent || 'unknown',
    referrer: referrer || 'direct',
    country: request.headers['x-vercel-ip-country']?.toString() ?? 'unknown',
    city: request.headers['x-vercel-ip-city']?.toString() ?? 'unknown'
  };
};

const toCoreHistory = (history: readonly IConversationHistoryItem[]): ICoreConversationMessage[] =>
  history.map((item) => ({
    role: item.role,
    text: item.text,
    timestamp: item.timestamp.toISOString()
  }));

const appendConversationItem = (
  session: IWebDemoSession,
  item: IConversationHistoryItem
): IConversationHistoryItem[] => [...session.conversationHistory, item];

const defaultConversationContext = (): ConversationContext & { readonly state: ConversationState } => ({
  state: ConversationState.GREETING,
  missingFields: ['name', 'date', 'time', 'phone'],
  collectedData: {},
  retryCount: 0
});

const resolveAudioProfile = (message?: IInitMessage): IResolvedAudioProfile => {
  const requestedFormat = message?.audio?.formats?.[0] ?? 'wav';
  const actualFormat: IAudioFormat = 'wav';
  const supportsDeflate = message?.audio?.supportsDeflate === true;
  const slowConnection = message?.audio?.connectionSpeed === 'slow';
  const requestedCompression = message?.audio?.compression ?? 'none';
  const compression: IAudioCompression =
    requestedCompression === 'deflate' && supportsDeflate ? 'deflate' : 'none';

  return {
    requestedFormat,
    actualFormat,
    mimeType: AUDIO_MIME[actualFormat],
    compression,
    slowConnection
  };
};

const isVertical = (value: string): value is IWebDemoVertical =>
  value === 'dental' || value === 'auto' || value === 'legal';

const getDefaultEnabledVertical = (): IWebDemoVertical => {
  if (webDemoConfig.featureFlags.verticals.dental) {
    return 'dental';
  }
  if (webDemoConfig.featureFlags.verticals.auto) {
    return 'auto';
  }
  if (webDemoConfig.featureFlags.verticals.legal) {
    return 'legal';
  }
  return 'dental';
};

const isEnabledVertical = (vertical: IWebDemoVertical): boolean => {
  return webDemoConfig.featureFlags.verticals[vertical];
};

const resolveVertical = (value: string | null | undefined): IWebDemoVertical => {
  if (value && isVertical(value) && isEnabledVertical(value)) {
    return value;
  }
  return getDefaultEnabledVertical();
};

const cleanupAudioCache = (cache: Map<string, IAudioCacheEntry>): void => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.createdAtMs > AUDIO_CACHE_TTL_MS) {
      cache.delete(key);
    }
  }

  while (cache.size > AUDIO_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      return;
    }
    cache.delete(oldestKey);
  }
};

export const createVoiceWebSocketHandler = (
  dependencies: IWebSocketHandlerDependencies
): ((socket: WebSocket, request: IncomingMessage) => void) => {
  const { coreService, sessionStore, errorManager, analytics } = dependencies;
  const sarvamService = dependencies.sarvamService ?? new SarvamService();
  const sessionAudioProfiles = new Map<string, IResolvedAudioProfile>();
  const sessionResponseGenerators = new Map<string, ResponseGenerator>();
  const audioCache = new Map<string, IAudioCacheEntry>();

  const getCachedAudio = (cacheKey: string): Buffer | null => {
    cleanupAudioCache(audioCache);
    const entry = audioCache.get(cacheKey);
    if (!entry) {
      return null;
    }
    audioCache.set(cacheKey, { ...entry, hits: entry.hits + 1 });
    return Buffer.from(entry.audio);
  };

  const setCachedAudio = (cacheKey: string, audio: Buffer): void => {
    cleanupAudioCache(audioCache);
    audioCache.set(cacheKey, {
      audio: Buffer.from(audio),
      createdAtMs: Date.now(),
      hits: 1
    });
  };

  return (socket: WebSocket, request: IncomingMessage): void => {
    const url = parseRequestUrl(request);
    const requestedSessionId = url.searchParams.get('sessionId') ?? undefined;
    const requestedVertical = resolveVertical(url.searchParams.get('vertical'));
    const metadata = readMetadataFromRequest(request);

    let activeSession = requestedSessionId ? sessionStore.getSession(requestedSessionId) : null;
    activeSession ??= sessionStore.createSession(requestedVertical, metadata);
    if (!activeSession) {
      errorManager.recordError({
        category: 'server',
        code: 'SESSION_INIT_FAILED',
        message: 'Failed to initialize websocket session'
      });
      void analytics.trackError({
        sessionId: requestedSessionId,
        errorType: 'SESSION_INIT_FAILED',
        category: 'server',
        recoverySuccess: false
      });
      socket.send(JSON.stringify({ type: 'error', message: 'Failed to initialize session.' }));
      return;
    }

    sessionStore.updateSession(activeSession.sessionId, {
      vertical: requestedVertical,
      metadata: {
        ...activeSession.metadata,
        ...metadata
      }
    });
    activeSession = sessionStore.getSession(activeSession.sessionId);
    if (!activeSession) {
      socket.send(JSON.stringify({ type: 'error', message: 'Failed to restore session.' }));
      return;
    }

    sessionAudioProfiles.set(activeSession.sessionId, resolveAudioProfile());
    errorManager.incrementConnectedClients();
    void analytics.trackDemoStarted({
      sessionId: activeSession.sessionId,
      vertical: activeSession.vertical,
      referrer: activeSession.metadata.referrer,
      country: metadata.country,
      city: metadata.city,
      ipAddress: activeSession.metadata.ipAddress
    });

    socket.send(
      JSON.stringify({
        type: 'session',
        sessionId: activeSession.sessionId,
        vertical: activeSession.vertical
      })
    );

    socket.on('message', (rawMessage: Buffer): void => {
      void (async (): Promise<void> => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawMessage.toString());
        } catch {
          errorManager.recordError({
            category: 'client',
            code: 'INVALID_JSON',
            message: 'Client sent invalid JSON',
            sessionId: activeSession?.sessionId
          });
          void analytics.trackError({
            sessionId: activeSession?.sessionId,
            errorType: 'INVALID_JSON',
            category: 'client',
            recoverySuccess: false
          });
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' }));
          return;
        }

        if (isAnalyticsClientMessage(parsed)) {
          await analytics.trackConversionClicked({
            sessionId: parsed.sessionId ?? activeSession?.sessionId,
            ctaType: parsed.payload.ctaType
          });
          return;
        }

        if (isInitMessage(parsed)) {
          const initSessionId = parsed.sessionId ?? activeSession?.sessionId;
          const existing = initSessionId ? sessionStore.getSession(initSessionId) : null;
          const selectedVertical = resolveVertical(parsed.vertical);
          const nextSession = existing ?? sessionStore.createSession(selectedVertical, metadata);
          sessionStore.updateSession(nextSession.sessionId, {
            vertical: selectedVertical,
            metadata: {
              ...nextSession.metadata,
              ...metadata
            }
          });

          activeSession = sessionStore.getSession(nextSession.sessionId);
          if (!activeSession) {
            socket.send(JSON.stringify({ type: 'error', message: 'Failed to initialize selected vertical.' }));
            return;
          }

          const audioProfile = resolveAudioProfile(parsed);
          sessionAudioProfiles.set(activeSession.sessionId, audioProfile);
          const verticalService = createVerticalService(activeSession.vertical);

          socket.send(
            JSON.stringify({
              type: 'init',
              sessionId: activeSession.sessionId,
              vertical: activeSession.vertical,
              greeting: verticalService.getGreeting(),
              requiredEntities: verticalService.getRequiredEntities(),
              audio: {
                requestedFormat: audioProfile.requestedFormat,
                actualFormat: audioProfile.actualFormat,
                compression: audioProfile.compression,
                mimeType: audioProfile.mimeType
              }
            })
          );

          if (parsed.preloadVoices) {
            const greetingCacheKey = `${activeSession.vertical}|${verticalService.getGreeting()}|${audioProfile.actualFormat}`;
            if (!getCachedAudio(greetingCacheKey)) {
              try {
                const result = await coreService.synthesizeFromContext({
                  responseText: verticalService.getGreeting(),
                  vertical: activeSession.vertical,
                  sessionId: activeSession.sessionId,
                  history: []
                });
                setCachedAudio(greetingCacheKey, result.audio);
              } catch {
                errorManager.markTtsFailure(activeSession.sessionId, 'Voice preload failed');
              }
            }
          }
          return;
        }

        let transcriptPayload: ITranscriptMessage | null = null;
        if (isTranscriptMessage(parsed)) {
          transcriptPayload = parsed;
        } else if (isAudioInputMessage(parsed)) {
          const sessionForAudio = parsed.sessionId ?? activeSession?.sessionId;
          if (!sessionForAudio) {
            socket.send(JSON.stringify({ type: 'error', message: 'Session missing for audio transcription.' }));
            return;
          }

          const audioBuffer = Buffer.from(parsed.audioBase64, 'base64');
          if (audioBuffer.length === 0 || audioBuffer.length > MAX_AUDIO_INPUT_BYTES) {
            socket.send(
              JSON.stringify({
                type: 'error',
                sessionId: sessionForAudio,
                message: 'Audio input size invalid. Please record a shorter voice message.'
              })
            );
            return;
          }

          let transcriptText: string;
          try {
            transcriptText = await sarvamService.transcribeAudioBuffer(
              audioBuffer,
              parsed.language ?? 'hi-en',
              {
                fileName: parsed.fileName,
                mimeType: parsed.mimeType
              }
            );
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Audio transcription failed';
            await analytics.trackError({
              sessionId: sessionForAudio,
              errorType: 'AUDIO_TRANSCRIBE_FAILED',
              category: 'server',
              recoverySuccess: false
            });
            socket.send(
              JSON.stringify({
                type: 'error',
                sessionId: sessionForAudio,
                message: `${errorManager.getUserMessage('GENERIC_RETRY')} (${errorMessage})`
              })
            );
            return;
          }

          socket.send(
            JSON.stringify({
              type: 'transcript',
              sessionId: sessionForAudio,
              text: transcriptText
            })
          );

          transcriptPayload = {
            type: 'transcript',
            text: transcriptText,
            vertical: parsed.vertical,
            sessionId: sessionForAudio
          };
        }

        if (!transcriptPayload) {
          errorManager.recordError({
            category: 'user',
            code: 'INVALID_MESSAGE_TYPE',
            message: 'Invalid websocket payload type',
            sessionId: activeSession?.sessionId
          });
          socket.send(
            JSON.stringify({
              type: 'error',
              message:
                "Expected payload: { type: 'init', vertical: 'dental' } or { type: 'transcript', text: '...' } or { type: 'audio_input', audioBase64: '...' }",
              receivedType:
                typeof parsed === 'object' && parsed !== null && 'type' in parsed
                  ? String((parsed as Record<string, unknown>).type)
                  : 'unknown'
            })
          );
          return;
        }

        const sessionId = transcriptPayload.sessionId ?? activeSession?.sessionId;
        const currentSession = sessionId ? sessionStore.getSession(sessionId) : null;
        if (!currentSession) {
          const recovered = sessionStore.createSession(transcriptPayload.vertical ?? requestedVertical, metadata);
          activeSession = recovered;
          errorManager.recordError({
            category: 'server',
            code: 'SESSION_LOST',
            message: 'Session was missing; new session created',
            sessionId
          });
          await analytics.trackError({
            sessionId,
            errorType: 'SESSION_LOST',
            category: 'server',
            recoverySuccess: true
          });
          socket.send(
            JSON.stringify({
              type: 'session_recovered',
              sessionId: recovered.sessionId,
              message: `${errorManager.getUserMessage('SESSION_LOST')} Naya session shuru kiya gaya.`,
              contextSummary: null
            })
          );
          return;
        }

        if (transcriptPayload.text.trim().length === 0) {
          errorManager.recordError({
            category: 'user',
            code: 'EMPTY_INPUT',
            message: 'Transcript is empty',
            sessionId: currentSession.sessionId
          });
          await analytics.trackError({
            sessionId: currentSession.sessionId,
            errorType: 'EMPTY_INPUT',
            category: 'user',
            recoverySuccess: false
          });
          socket.send(
            JSON.stringify({
              type: 'error',
              sessionId: currentSession.sessionId,
              message: errorManager.getUserMessage('GENERIC_RETRY')
            })
          );
          return;
        }

        const turnStartedAtMs = Date.now();
        errorManager.markRequest();

        const detectedVertical = detectVerticalFromLanguage(transcriptPayload.text);
        const resolvedVertical = resolveVertical(
          detectedVertical ?? transcriptPayload.vertical ?? currentSession.vertical
        );
        const verticalService = createVerticalService(resolvedVertical);
        const userTurn: IConversationHistoryItem = {
          role: 'user',
          text: transcriptPayload.text,
          timestamp: new Date()
        };
        const extractedFromTurn = verticalService.extractEntities(transcriptPayload.text);
        sessionStore.updateSession(currentSession.sessionId, {
          vertical: resolvedVertical,
          extractedEntities: {
            ...currentSession.extractedEntities,
            ...extractedFromTurn
          },
          conversationHistory: appendConversationItem(currentSession, userTurn)
        });

        const updatedBeforeCore = sessionStore.getSession(currentSession.sessionId);
        if (!updatedBeforeCore) {
          socket.send(JSON.stringify({ type: 'error', message: 'Session expired during processing.' }));
          return;
        }

        const history = toCoreHistory(updatedBeforeCore.conversationHistory);
        const existingContext = updatedBeforeCore.conversationContext ?? defaultConversationContext();
        let responseGenerator = sessionResponseGenerators.get(updatedBeforeCore.sessionId);
        if (!responseGenerator) {
          responseGenerator = new ResponseGenerator(verticalService, {
            voiceService: {
              synthesizeSpeech: async (_text: string, _voice: ISarvamTtsVoice): Promise<Buffer> =>
                Buffer.from([0]),
              getAudioContentType: (): string => 'audio/wav'
            }
          });
          sessionResponseGenerators.set(updatedBeforeCore.sessionId, responseGenerator);
        }
        const generatedResponse = await responseGenerator.generateResponse(
          transcriptPayload.text,
          existingContext
        );
        const responseText = generatedResponse.text;
        const audioProfile = sessionAudioProfiles.get(updatedBeforeCore.sessionId) ?? resolveAudioProfile();
        sessionAudioProfiles.set(updatedBeforeCore.sessionId, audioProfile);

        const cacheKey = `${updatedBeforeCore.vertical}|${responseText}|${audioProfile.actualFormat}`;
        let audioBuffer = getCachedAudio(cacheKey);
        let cacheHit = true;
        let ttsLatencyMs = 0;

        if (!audioBuffer && !errorManager.isTextOnlyMode()) {
          cacheHit = false;
          const ttsStart = Date.now();
          try {
            const coreResult = await coreService.synthesizeFromContext({
              responseText,
              vertical: updatedBeforeCore.vertical,
              sessionId: updatedBeforeCore.sessionId,
              history
            });
            ttsLatencyMs = Date.now() - ttsStart;
            audioBuffer = coreResult.audio;
            setCachedAudio(cacheKey, audioBuffer);
            errorManager.markTtsSuccess();
          } catch (error: unknown) {
            const ttsErrorMessage = error instanceof Error ? error.message : 'Unknown TTS failure';
            errorManager.markTtsFailure(updatedBeforeCore.sessionId, ttsErrorMessage);
            await analytics.trackError({
              sessionId: updatedBeforeCore.sessionId,
              errorType: 'TTS_FAILURE',
              category: 'server',
              recoverySuccess: true
            });
          }
        }

        const assistantTurn: IConversationHistoryItem = {
          role: 'assistant',
          text: responseText,
          timestamp: new Date()
        };
        sessionStore.updateSession(updatedBeforeCore.sessionId, {
          extractedEntities: {
            ...updatedBeforeCore.extractedEntities,
            name: generatedResponse.extractedData.name ?? updatedBeforeCore.extractedEntities.name,
            phone: generatedResponse.extractedData.phone ?? updatedBeforeCore.extractedEntities.phone,
            date: generatedResponse.extractedData.date ?? updatedBeforeCore.extractedEntities.date,
            time: generatedResponse.extractedData.time ?? updatedBeforeCore.extractedEntities.time,
            serviceType:
              generatedResponse.extractedData.service ?? updatedBeforeCore.extractedEntities.serviceType
          },
          conversationContext: {
            state: generatedResponse.state,
            missingFields: [...generatedResponse.updatedContext.missingFields],
            collectedData: { ...generatedResponse.updatedContext.collectedData },
            retryCount: generatedResponse.updatedContext.retryCount
          },
          conversationHistory: appendConversationItem(updatedBeforeCore, assistantTurn)
        });

        if (!audioBuffer) {
          await analytics.trackMessageSent({
            sessionId: updatedBeforeCore.sessionId,
            messageLength: transcriptPayload.text.length,
            latencyMs: Date.now() - turnStartedAtMs
          });
          await analytics.trackMessageReceived({
            sessionId: updatedBeforeCore.sessionId,
            responseLength: responseText.length,
            ttsLatencyMs: 0
          });
          socket.send(
            JSON.stringify({
              type: 'response',
              sessionId: updatedBeforeCore.sessionId,
              vertical: updatedBeforeCore.vertical,
              text: `${responseText} (${errorManager.getUserMessage('AUDIO_UNAVAILABLE')})`,
              audioUnavailable: true,
              state: generatedResponse.state,
              action: generatedResponse.action,
              data: generatedResponse.data
            })
          );
          return;
        }

        const compression = audioProfile.compression;
        const payloadBuffer =
          compression === 'deflate' ? deflateSync(audioBuffer, { level: audioProfile.slowConnection ? 6 : 3 }) : audioBuffer;
        const chunkSize = audioProfile.slowConnection ? AUDIO_CHUNK_SIZE_SLOW : AUDIO_CHUNK_SIZE_FAST;
        const streamId = randomUUID();
        const firstByteLatencyMs = Date.now() - turnStartedAtMs;

        socket.send(
          JSON.stringify({
            type: 'response',
            sessionId: updatedBeforeCore.sessionId,
            vertical: updatedBeforeCore.vertical,
            text: responseText,
            streamId,
            state: generatedResponse.state,
            action: generatedResponse.action,
            data: generatedResponse.data
          })
        );
        socket.send(
          JSON.stringify({
            type: 'audio_start',
            sessionId: updatedBeforeCore.sessionId,
            streamId,
            format: audioProfile.actualFormat,
            requestedFormat: audioProfile.requestedFormat,
            mimeType: audioProfile.mimeType,
            compression,
            totalBytes: payloadBuffer.length,
            originalBytes: audioBuffer.length,
            chunkSize
          })
        );

        for (let offset = 0; offset < payloadBuffer.length; offset += chunkSize) {
          const chunk = payloadBuffer.subarray(offset, Math.min(offset + chunkSize, payloadBuffer.length));
          socket.send(chunk, { binary: true });
        }

        socket.send(
          JSON.stringify({
            type: 'audio_end',
            sessionId: updatedBeforeCore.sessionId,
            streamId,
            metrics: {
              ttsLatencyMs,
              firstByteLatencyMs,
              totalTurnLatencyMs: Date.now() - turnStartedAtMs,
              cacheHit
            }
          })
        );

        await analytics.trackMessageReceived({
          sessionId: updatedBeforeCore.sessionId,
          responseLength: responseText.length,
          ttsLatencyMs
        });
        await analytics.trackMessageSent({
          sessionId: updatedBeforeCore.sessionId,
          messageLength: transcriptPayload.text.length,
          latencyMs: Date.now() - turnStartedAtMs
        });
      })().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown processing error';
        const sid = activeSession?.sessionId ?? 'unknown';

        errorManager.recordError({
          category: 'server',
          code: 'UNHANDLED_HANDLER_ERROR',
          message,
          sessionId: sid,
          stack: error instanceof Error ? error.stack : undefined
        });
        void analytics.trackError({
          sessionId: sid,
          errorType: 'UNHANDLED_HANDLER_ERROR',
          category: 'server',
          recoverySuccess: false
        });

        socket.send(
          JSON.stringify({
            type: 'error',
            sessionId: sid,
            message
          })
        );
      });
    });

    socket.on('close', () => {
      if (!activeSession) {
        errorManager.decrementConnectedClients();
        return;
      }
      sessionResponseGenerators.delete(activeSession.sessionId);
      sessionStore.updateSession(activeSession.sessionId, { lastActivity: new Date() });
      errorManager.decrementConnectedClients();
      errorManager.recordError({
        category: 'network',
        code: 'WS_DISCONNECT',
        message: 'WebSocket connection closed',
        sessionId: activeSession.sessionId
      });
      void analytics.trackDemoCompleted({
        sessionId: activeSession.sessionId,
        outcome: 'dropped'
      });
    });

    socket.on('error', (error) => {
      errorManager.recordError({
        category: 'network',
        code: 'WS_SOCKET_ERROR',
        message: error.message,
        sessionId: activeSession?.sessionId,
        stack: error.stack
      });
      void analytics.trackError({
        sessionId: activeSession?.sessionId,
        errorType: 'WS_SOCKET_ERROR',
        category: 'network',
        recoverySuccess: false
      });
    });
  };
};
