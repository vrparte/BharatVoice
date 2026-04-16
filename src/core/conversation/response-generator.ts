import { VoiceService } from '../../services/voice.service';
import type { ISarvamTtsVoice } from '../../types/sarvam.types';
import type { ExtractedEntities } from '../nlu/intent-classifier';
import { Intent, IntentClassifier } from '../nlu/intent-classifier';
import type { BaseVertical } from '../verticals/base-vertical';

import {
  ConversationState,
  type ConversationCollectedData,
  type ConversationContext,
  type ConversationHistoryItem,
  ConversationStateMachine
} from './state-machine';

export interface ResponseObject {
  readonly text: string;
  readonly audioUrl?: string;
  readonly action?: 'book' | 'transfer' | 'hangup';
  readonly data?: Record<string, unknown>;
  readonly state: ConversationState;
  readonly updatedContext: ConversationContext;
  readonly extractedData: Partial<ExtractedEntities>;
  readonly history: readonly ConversationHistoryItem[];
  readonly debug: {
    readonly intent: Intent;
    readonly confidence: number;
  };
}

interface ResponseGeneratorDependencies {
  readonly intentClassifier?: IntentClassifier;
  readonly stateMachine?: ConversationStateMachine;
  readonly voiceService?: {
    synthesizeSpeech: (text: string, voice: ISarvamTtsVoice) => Promise<Buffer>;
    getAudioContentType: () => string;
  };
  readonly bookingExecutor?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly createAudioUrl?: (audio: Buffer, contentType: string) => Promise<string>;
  readonly defaultVoice?: ISarvamTtsVoice;
}

const toStateEntities = (entities: ExtractedEntities): Record<string, string> => {
  const mapped: Record<string, string> = {};
  if (entities.name)       mapped.name = entities.name;
  if (entities.date)       mapped.date = entities.date;
  if (entities.time)       mapped.time = entities.time;
  if (entities.phone)      mapped.phone = entities.phone;
  if (entities.service)    mapped.service = entities.service;
  if (entities.doctor)     mapped.doctor = entities.doctor;
  if (entities.carModel)   mapped.carModel = entities.carModel;
  if (entities.carProblem) mapped.carProblem = entities.carProblem;
  if (entities.caseType)   mapped.caseType = entities.caseType;
  return mapped;
};

const patchCorrectionEntities = (input: string, entities: ExtractedEntities): ExtractedEntities => {
  const normalized = input.toLowerCase();
  if (!normalized.includes('nahi')) {
    return entities;
  }
  if (normalized.includes('sham')) {
    return { ...entities, time: 'evening' };
  }
  if (normalized.includes('subah')) {
    return { ...entities, time: 'morning' };
  }
  if (normalized.includes('dopahar')) {
    return { ...entities, time: 'afternoon' };
  }
  return entities;
};

const renderContextualText = (
  state: ConversationState,
  fallbackText: string,
  context: ConversationContext,
  vertical: BaseVertical
): string => {
  if (state === ConversationState.GREETING) {
    return fallbackText;
  }
  if (state === ConversationState.CONFIRMING) {
    return vertical.getConfirmationText(context.collectedData);
  }
  if (state === ConversationState.CLOSING) {
    return vertical.getConfirmationText(context.collectedData).replace('सही है?', '') +
      ' — booking confirm हो गई। धन्यवाद!';
  }
  return fallbackText;
};

export class ResponseGenerator {
  private readonly vertical: BaseVertical;
  private readonly intentClassifier: IntentClassifier;
  private readonly stateMachine: ConversationStateMachine;
  private readonly voiceService: {
    synthesizeSpeech: (text: string, voice: ISarvamTtsVoice) => Promise<Buffer>;
    getAudioContentType: () => string;
  };
  private readonly bookingExecutor?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  private readonly createAudioUrl?: (audio: Buffer, contentType: string) => Promise<string>;
  private readonly defaultVoice: ISarvamTtsVoice;

  public constructor(vertical: BaseVertical, dependencies?: ResponseGeneratorDependencies) {
    this.vertical = vertical;
    this.intentClassifier = dependencies?.intentClassifier ?? new IntentClassifier();
    this.stateMachine = dependencies?.stateMachine ?? new ConversationStateMachine(
      vertical.getRequiredEntities(),
      (field: string, data: ConversationCollectedData) => vertical.getNextQuestion(field, data)
    );
    this.voiceService = dependencies?.voiceService ?? new VoiceService();
    this.bookingExecutor = dependencies?.bookingExecutor;
    this.createAudioUrl = dependencies?.createAudioUrl;
    this.defaultVoice = dependencies?.defaultVoice ?? 'ratan';
  }

  public getHistory(): readonly ConversationHistoryItem[] {
    return this.stateMachine.getHistory();
  }

  public async generateResponse(
    input: string,
    context: ConversationContext & { readonly state?: ConversationState }
  ): Promise<ResponseObject> {
    if (context.state) {
      this.stateMachine.currentState = context.state;
    }
    this.stateMachine.context = {
      missingFields: [...context.missingFields],
      collectedData: { ...context.collectedData },
      retryCount: context.retryCount
    };

    if (this.stateMachine.currentState === ConversationState.IDLE) {
      const initTransition = this.stateMachine.transition(Intent.GREETING, {});
      this.stateMachine.addHistory({
        role: 'assistant',
        text: initTransition.response,
        intent: Intent.GREETING
      });
    }

    const normalizedInput = input.trim();
    const classification = this.intentClassifier.classify(normalizedInput);
    const recoveredEntities = patchCorrectionEntities(normalizedInput, classification.entities);
    const entityCount = Object.values(recoveredEntities).filter((v) => v !== undefined).length;
    const prevState = this.stateMachine.currentState;

    // Intent arbitration: when the user confirms AND provides new slot data while
    // still in COLLECTING_INFO, prefer PROVIDE_INFO so slot-filling continues
    // rather than jumping to CLOSING prematurely.
    const effectiveIntent = (() => {
      if (classification.confidence < 0.6) return Intent.FALLBACK;
      if (
        classification.intent === Intent.CONFIRM &&
        entityCount > 0 &&
        prevState === ConversationState.COLLECTING_INFO
      ) {
        return Intent.PROVIDE_INFO;
      }
      return classification.intent;
    })();

    const transition = this.stateMachine.transition(effectiveIntent, toStateEntities(recoveredEntities));
    const responseText = renderContextualText(
      transition.newState,
      transition.response,
      this.stateMachine.context,
      this.vertical
    );

    console.info('[dialogue]', JSON.stringify({
      transcript: normalizedInput,
      intent: effectiveIntent,
      confidence: classification.confidence,
      entities: recoveredEntities,
      prevState,
      newState: transition.newState,
      missingFields: this.stateMachine.context.missingFields,
      response: responseText
    }));

    this.stateMachine.addHistory({
      role: 'user',
      text: normalizedInput,
      intent: effectiveIntent
    });
    this.stateMachine.addHistory({
      role: 'assistant',
      text: responseText,
      intent: effectiveIntent
    });

    let action: 'book' | 'transfer' | 'hangup' | undefined;
    let data: Record<string, unknown> | undefined;

    const shouldBook =
      transition.newState === ConversationState.CLOSING &&
      effectiveIntent === Intent.CONFIRM &&
      this.bookingExecutor;

    if (shouldBook) {
      try {
        action = 'book';
        data = await this.bookingExecutor?.({
          ...this.stateMachine.context.collectedData,
          vertical: this.vertical.vertical
        });
      } catch {
        action = 'transfer';
        data = { reason: 'booking_failed' };
        return {
          text: 'Maaf kijiye, booking mein issue aa gaya. Main aapko human support se connect karta hoon.',
          state: this.stateMachine.currentState,
          updatedContext: this.stateMachine.context,
          extractedData: recoveredEntities,
          history: this.stateMachine.getHistory(),
          debug: { intent: effectiveIntent, confidence: classification.confidence },
          action,
          data
        };
      }
    }

    try {
      const audioBuffer = await this.voiceService.synthesizeSpeech(responseText, this.defaultVoice);
      const audioUrl = this.createAudioUrl
        ? await this.createAudioUrl(audioBuffer, this.voiceService.getAudioContentType())
        : undefined;
      return {
        text: responseText,
        state: this.stateMachine.currentState,
        updatedContext: this.stateMachine.context,
        extractedData: recoveredEntities,
        history: this.stateMachine.getHistory(),
        debug: { intent: effectiveIntent, confidence: classification.confidence },
        audioUrl,
        action,
        data
      };
    } catch {
      return {
        text: responseText,
        state: this.stateMachine.currentState,
        updatedContext: this.stateMachine.context,
        extractedData: recoveredEntities,
        history: this.stateMachine.getHistory(),
        debug: { intent: effectiveIntent, confidence: classification.confidence },
        action,
        data
      };
    }
  }
}
