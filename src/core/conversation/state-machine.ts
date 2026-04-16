import { Intent } from '../nlu/intent-classifier';
import { localizeDate, localizeTime } from './slot-display';

export enum ConversationState {
  IDLE = 'IDLE',
  GREETING = 'GREETING',
  COLLECTING_INFO = 'COLLECTING_INFO',
  CONFIRMING = 'CONFIRMING',
  BOOKING = 'BOOKING',
  CLOSING = 'CLOSING',
  FALLBACK = 'FALLBACK'
}

export interface ConversationCollectedData {
  readonly name?: string;
  readonly phone?: string;
  readonly date?: string;
  readonly time?: string;
  readonly service?: string;
  readonly doctor?: string;
  readonly carModel?: string;
  readonly carProblem?: string;
  readonly caseType?: string;
}

export interface ConversationContext {
  readonly missingFields: string[];
  readonly collectedData: ConversationCollectedData;
  readonly retryCount: number;
}

export interface ConversationHistoryItem {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly intent?: Intent;
}

export interface StateTransitionResult {
  readonly newState: ConversationState;
  readonly response: string;
}

const DEFAULT_REQUIRED_FIELDS = ['name', 'date', 'time'] as const;

const DEFAULT_QUESTION_GENERATOR = (field: string, data: ConversationCollectedData): string => {
  const ack = data.name ? `ठीक है ${data.name} जी` : 'समझ गया';
  switch (field) {
    case 'name':    return 'आपका नाम क्या है?';
    case 'date':    return `${ack}, आप कब आना चाहेंगे? कल या कोई और दिन?`;
    case 'time':    return data.date
      ? `${localizeDate(data.date)} note कर लिया। कितने बजे?`
      : 'कितने बजे आना चाहेंगे? सुबह या शाम?';
    case 'doctor':  return `${ack} — किस doctor को दिखाना है?`;
    case 'carModel':   return `${ack}, आपकी गाड़ी का model क्या है?`;
    case 'carProblem': return `${ack}, गाड़ी में क्या problem है?`;
    case 'caseType':   return `${ack}, आपको किस प्रकार की legal सहायता चाहिए?`;
    default: return `कृपया अपना ${field} बताइए।`;
  }
};

const mergeCollectedData = (
  current: ConversationCollectedData,
  updates: Partial<ConversationCollectedData>
): ConversationCollectedData => ({
  ...current,
  ...updates
});

const calculateMissingFields = (
  data: ConversationCollectedData,
  requiredFields: readonly string[]
): string[] => {
  return requiredFields.filter((field) => {
    return !data[field as keyof ConversationCollectedData];
  });
};

const fallbackMessage = 'माफ कीजिए, समझ नहीं आया। कृपया दोबारा बताइए।';

export class ConversationStateMachine {
  public currentState: ConversationState = ConversationState.IDLE;
  public context: ConversationContext = {
    missingFields: [],
    collectedData: {},
    retryCount: 0
  };

  private previousState: ConversationState = ConversationState.IDLE;
  private readonly history: ConversationHistoryItem[] = [];
  private readonly requiredFields: readonly string[];
  private readonly questionGenerator: (field: string, data: ConversationCollectedData) => string;

  public constructor(
    requiredFields?: readonly string[],
    questionGenerator?: (field: string, data: ConversationCollectedData) => string
  ) {
    this.requiredFields = requiredFields ?? DEFAULT_REQUIRED_FIELDS;
    this.questionGenerator = questionGenerator ?? DEFAULT_QUESTION_GENERATOR;
  }

  public getHistory(): readonly ConversationHistoryItem[] {
    return [...this.history];
  }

  public addHistory(item: ConversationHistoryItem): void {
    this.history.push(item);
  }

  public transition(intent: Intent, entities: Partial<ConversationCollectedData>): StateTransitionResult {
    this.context = {
      ...this.context,
      collectedData: mergeCollectedData(this.context.collectedData, entities)
    };
    this.context = {
      ...this.context,
      missingFields: calculateMissingFields(this.context.collectedData, this.requiredFields)
    };

    if (this.currentState === ConversationState.IDLE) {
      this.previousState = this.currentState;
      this.currentState = ConversationState.GREETING;
      return {
        newState: this.currentState,
        response: 'नमस्ते जी। मैं कैसे मदद कर सकता हूँ?'
      };
    }

    // Only fall back when intent is FALLBACK AND no useful entities were extracted.
    // If the user gave slot values but used ambiguous phrasing, keep the current state.
    if (this.shouldFallback(intent, entities)) {
      this.previousState = this.currentState;
      this.currentState = ConversationState.FALLBACK;
      this.context = { ...this.context, retryCount: this.context.retryCount + 1 };
      return {
        newState: this.currentState,
        response: fallbackMessage
      };
    }

    if (this.currentState === ConversationState.FALLBACK) {
      this.currentState = this.previousState;
      this.context = { ...this.context, retryCount: 0 };
    }

    if (this.currentState === ConversationState.GREETING) {
      // Advance to slot-filling if: explicit booking intent, info-provision intent,
      // or any slot values already merged in (entity-rich first turn).
      const hasEntities = this.context.missingFields.length < this.requiredFields.length;
      if (intent === Intent.BOOK_APPOINTMENT || intent === Intent.PROVIDE_INFO || hasEntities) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.COLLECTING_INFO;
        return {
          newState: this.currentState,
          response: this.getNextQuestion()
        };
      }

      return {
        newState: this.currentState,
        response: 'जी, आप appointment, timing, या charges के बारे में पूछ सकते हैं।'
      };
    }

    if (this.currentState === ConversationState.COLLECTING_INFO) {
      if (this.context.missingFields.length > 0) {
        return {
          newState: this.currentState,
          response: this.getNextQuestion()
        };
      }

      this.previousState = this.currentState;
      this.currentState = ConversationState.CONFIRMING;
      return {
        newState: this.currentState,
        response: this.getConfirmationPrompt()
      };
    }

    if (this.currentState === ConversationState.CONFIRMING) {
      if (intent === Intent.CONFIRM) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.BOOKING;
        this.currentState = ConversationState.CLOSING;
        return {
          newState: this.currentState,
          response: 'Booking request process हो गई। Confirmation जल्दी मिलेगा। धन्यवाद!'
        };
      }

      if (intent === Intent.REJECT) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.COLLECTING_INFO;
        return {
          newState: this.currentState,
          response: 'ठीक है, correction बताइए। मैं details update करता हूँ।'
        };
      }

      return {
        newState: this.currentState,
        response: 'कृपया बताइए, details सही हैं? हाँ या नहीं।'
      };
    }

    if (this.currentState === ConversationState.CLOSING) {
      return {
        newState: this.currentState,
        response: 'अगर और मदद चाहिए हो तो बताइए। धन्यवाद!'
      };
    }

    return {
      newState: this.currentState,
      response: fallbackMessage
    };
  }

  public getNextQuestion(): string {
    const nextField = this.context.missingFields[0];
    if (!nextField) {
      return 'कृपया details confirm कीजिए।';
    }
    return this.questionGenerator(nextField, this.context.collectedData);
  }

  private getConfirmationPrompt(): string {
    const data = this.context.collectedData;
    const parts: string[] = [];
    if (data.name)       parts.push(`नाम: ${data.name}`);
    if (data.date)       parts.push(`तारीख: ${localizeDate(data.date)}`);
    if (data.time)       parts.push(`समय: ${localizeTime(data.time)}`);
    if (data.phone)      parts.push(`number: ${data.phone}`);
    if (data.doctor)     parts.push(`doctor: ${data.doctor}`);
    if (data.carModel)   parts.push(`गाड़ी: ${data.carModel}`);
    if (data.carProblem) parts.push(`problem: ${data.carProblem}`);
    if (data.caseType)   parts.push(`case: ${data.caseType}`);
    const summary = parts.length > 0 ? parts.join(', ') : 'आपकी details';
    return `ठीक है, confirm कर रहा हूँ — ${summary}। सही है?`;
  }

  // Only fall back when intent is genuinely unrecognised AND no slot values were extracted.
  private shouldFallback(intent: Intent, entities: Partial<ConversationCollectedData>): boolean {
    if (intent !== Intent.FALLBACK) return false;
    return !Object.values(entities).some((v) => v !== undefined);
  }
}
