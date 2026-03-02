export enum Intent {
  GREETING = 'GREETING',
  BOOK_APPOINTMENT = 'BOOK_APPOINTMENT',
  CHECK_PRICE = 'CHECK_PRICE',
  CHECK_HOURS = 'CHECK_HOURS',
  EMERGENCY = 'EMERGENCY',
  PROVIDE_INFO = 'PROVIDE_INFO',
  CONFIRM = 'CONFIRM',
  REJECT = 'REJECT',
  FALLBACK = 'FALLBACK'
}

export interface ExtractedEntities {
  readonly name?: string;
  readonly date?: string;
  readonly time?: string;
  readonly phone?: string;
  readonly service?: string;
}

export interface IntentClassificationResult {
  readonly intent: Intent;
  readonly confidence: number;
  readonly entities: ExtractedEntities;
}

interface IntentRule {
  readonly intent: Intent;
  readonly keywords: readonly string[];
  readonly baseConfidence: number;
}

const SERVICE_KEYWORDS = ['cleaning', 'filling', 'service', 'consultation'] as const;

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: Intent.EMERGENCY,
    keywords: ['emergency', 'dard', 'pain', 'blood', 'accident'],
    baseConfidence: 0.95
  },
  {
    intent: Intent.GREETING,
    keywords: ['namaste', 'hello', 'hi', 'good morning'],
    baseConfidence: 0.95
  },
  {
    intent: Intent.BOOK_APPOINTMENT,
    keywords: ['appointment', 'booking', 'slot', 'time', 'jana hai'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_PRICE,
    keywords: ['kitna', 'price', 'cost', 'charge', 'paise'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_HOURS,
    keywords: ['time', 'hours', 'kab khulta', 'kitne baje'],
    baseConfidence: 0.85
  },
  {
    intent: Intent.PROVIDE_INFO,
    keywords: ['my name is', 'mera naam', 'number hai'],
    baseConfidence: 0.8
  },
  {
    intent: Intent.CONFIRM,
    keywords: ['yes', 'haan', 'theek hai', 'ok'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.REJECT,
    keywords: ['no', 'nahi', 'cancel'],
    baseConfidence: 0.9
  }
];

const clampConfidence = (value: number): number => {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
};

const normalize = (input: string): string => input.trim().toLowerCase();

const extractName = (input: string): string | undefined => {
  const match = /\b(?:my name is|mera naam)\s+([a-zA-Z]{2,})(?:\s+hai)?\b/i.exec(input);
  return match?.[1];
};

const extractPhone = (input: string): string | undefined => {
  const match = /\b(?:\+91[-\s]?)?([6-9]\d{9})\b/.exec(input);
  return match?.[1];
};

const extractDate = (input: string): string | undefined => {
  if (/\bkal\b/.test(input)) {
    return 'tomorrow';
  }
  if (/\bparso\b/.test(input)) {
    return 'day_after_tomorrow';
  }
  if (/\bnext week\b/.test(input)) {
    return 'next_week';
  }
  if (/\bmonday\b/.test(input)) {
    return 'monday';
  }
  return undefined;
};

const extractTime = (input: string): string | undefined => {
  const clockMatch = /\b(1[0-2]|0?[1-9])\s*baje\b/.exec(input);
  if (clockMatch) {
    return `${clockMatch[1]} AM`;
  }
  if (/\bsubah\b/.test(input)) {
    return 'morning';
  }
  if (/\bdopahar\b/.test(input)) {
    return 'afternoon';
  }
  if (/\bsham\b/.test(input)) {
    return 'evening';
  }
  return undefined;
};

const extractService = (input: string): string | undefined => {
  return SERVICE_KEYWORDS.find((keyword) => input.includes(keyword));
};

const extractEntities = (input: string): ExtractedEntities => ({
  name: extractName(input),
  date: extractDate(input),
  time: extractTime(input),
  phone: extractPhone(input),
  service: extractService(input)
});

const countEntities = (entities: ExtractedEntities): number => {
  return Object.values(entities).filter((value) => typeof value === 'string' && value.length > 0).length;
};

export class IntentClassifier {
  public classify(input: string): IntentClassificationResult {
    const normalizedInput = normalize(input);
    const entities = extractEntities(normalizedInput);
    const entityCount = countEntities(entities);

    if (normalizedInput.length === 0) {
      return {
        intent: Intent.FALLBACK,
        confidence: 0.1,
        entities
      };
    }

    const scored = INTENT_RULES.map((rule) => {
      const matches = rule.keywords.filter((keyword) => normalizedInput.includes(keyword)).length;
      if (matches === 0) {
        return { intent: rule.intent, score: 0 };
      }
      const densityBoost = Math.min(0.1, (matches - 1) * 0.05);
      return {
        intent: rule.intent,
        score: clampConfidence(rule.baseConfidence + densityBoost)
      };
    });

    const bestMatch = scored.sort((left, right) => right.score - left.score)[0];
    if (bestMatch && bestMatch.score > 0) {
      return {
        intent: bestMatch.intent,
        confidence: bestMatch.score,
        entities
      };
    }

    if (entityCount > 0) {
      return {
        intent: Intent.PROVIDE_INFO,
        confidence: clampConfidence(0.75 + Math.min(entityCount * 0.05, 0.2)),
        entities
      };
    }

    return {
      intent: Intent.FALLBACK,
      confidence: 0.35,
      entities
    };
  }
}

// "Hello" -> GREETING, 1.0
// "Mujhe appointment chahiye" -> BOOK_APPOINTMENT, 0.9, {}
// "Kal subah 10 baje" -> PROVIDE_INFO, 0.8, {date: "tomorrow", time: "10 AM"}
