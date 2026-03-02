import { Intent } from '../nlu/intent-classifier';

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

const REQUIRED_BOOKING_FIELDS = ['name', 'date', 'time', 'phone'] as const;

const mergeCollectedData = (
  current: ConversationCollectedData,
  updates: Partial<ConversationCollectedData>
): ConversationCollectedData => ({
  ...current,
  ...updates
});

const calculateMissingFields = (data: ConversationCollectedData): string[] => {
  return REQUIRED_BOOKING_FIELDS.filter((field) => {
    const key = field as keyof ConversationCollectedData;
    return !data[key];
  });
};

const fallbackMessage = 'Maaf kijiye, samajh nahi aaya. Kripya dobara bataiye.';

export class ConversationStateMachine {
  public currentState: ConversationState = ConversationState.IDLE;
  public context: ConversationContext = {
    missingFields: [],
    collectedData: {},
    retryCount: 0
  };

  private previousState: ConversationState = ConversationState.IDLE;
  private readonly history: ConversationHistoryItem[] = [];

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
      missingFields: calculateMissingFields(this.context.collectedData)
    };

    if (this.currentState === ConversationState.IDLE) {
      this.previousState = this.currentState;
      this.currentState = ConversationState.GREETING;
      return {
        newState: this.currentState,
        response: 'Namaste ji, BharatVoice mein aapka swagat hai. Main kaise madad kar sakta hoon?'
      };
    }

    if (this.shouldFallback(intent)) {
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
      if (intent === Intent.BOOK_APPOINTMENT) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.COLLECTING_INFO;
        return {
          newState: this.currentState,
          response: this.getNextQuestion()
        };
      }

      return {
        newState: this.currentState,
        response: 'Ji, aap appointment, timing, ya charges ke baare mein puch sakte hain.'
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
      const { name, date, time } = this.context.collectedData;
      return {
        newState: this.currentState,
        response: `Theek hai, ${name ?? 'ji'}, ${date ?? 'selected date'} ko ${time ?? 'selected time'} baje. Sahi hai?`
      };
    }

    if (this.currentState === ConversationState.CONFIRMING) {
      if (intent === Intent.CONFIRM) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.BOOKING;
        this.currentState = ConversationState.CLOSING;
        return {
          newState: this.currentState,
          response: 'Booking request process kar diya hai. Confirmation jaldi mil jayega. Dhanyavaad.'
        };
      }

      if (intent === Intent.REJECT) {
        this.previousState = this.currentState;
        this.currentState = ConversationState.COLLECTING_INFO;
        return {
          newState: this.currentState,
          response: 'Theek hai, correction bataiye. Main details update karta hoon.'
        };
      }

      return {
        newState: this.currentState,
        response: 'Kripya batayein, details sahi hain? Haan ya nahi.'
      };
    }

    if (this.currentState === ConversationState.CLOSING) {
      return {
        newState: this.currentState,
        response: 'Agar aur madad chahiye ho to batayein.'
      };
    }

    return {
      newState: this.currentState,
      response: fallbackMessage
    };
  }

  public getNextQuestion(): string {
    if (this.context.missingFields.includes('name')) {
      return 'Aapka naam kya hai?';
    }
    if (this.context.missingFields.includes('date')) {
      return 'Kab aana pasand karenge?';
    }
    if (this.context.missingFields.includes('time')) {
      return 'Kitne baje aayenge?';
    }
    if (this.context.missingFields.includes('phone')) {
      return 'Aapka phone number kya hai?';
    }
    return 'Kripya details confirm kariye.';
  }

  private shouldFallback(intent: Intent): boolean {
    return intent === Intent.FALLBACK;
  }
}
