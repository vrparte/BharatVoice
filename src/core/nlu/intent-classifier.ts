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
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: Intent.EMERGENCY,
    keywords: ['emergency', 'dard', 'pain', 'blood', 'accident', 'दर्द', 'खून', 'एक्सीडेंट', 'accident'],
    baseConfidence: 0.95
  },
  {
    intent: Intent.GREETING,
    keywords: ['namaste', 'hello', 'hi', 'good morning', 'नमस्ते', 'नमस्कार'],
    baseConfidence: 0.95
  },
  {
    intent: Intent.BOOK_APPOINTMENT,
    keywords: ['appointment', 'booking', 'slot', 'time', 'jana hai', 'अपॉइंटमेंट', 'बुकिंग', 'जाना है', 'चाहिए'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_PRICE,
    keywords: ['kitna', 'price', 'cost', 'charge', 'paise', 'कितना', 'चार्ज', 'पैसे', 'फीस'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_HOURS,
    keywords: ['time', 'hours', 'kab khulta', 'kitne baje', 'कब खुलता', 'कितने बजे', 'टाइम'],
    baseConfidence: 0.85
  },
  {
    intent: Intent.PROVIDE_INFO,
    keywords: ['my name is', 'mera naam', 'number hai', 'मेरा नाम', 'नाम', 'नंबर', 'फोन नंबर'],
    baseConfidence: 0.8
  },
  {
    intent: Intent.CONFIRM,
    keywords: ['yes', 'haan', 'theek hai', 'ok', 'हाँ', 'हां', 'ठीक है', 'जी'],
    baseConfidence: 0.9
  },
  {
    intent: Intent.REJECT,
    keywords: ['no', 'nahi', 'cancel', 'नहीं', 'नहि', 'कैंसिल', 'मत'],
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

const normalizeForEntityExtraction = (input: string): string => {
  const withAsciiDigits = normalizeDigits(input);
  return withAsciiDigits
    .replace(/[.,!?;:()"'`|/\\[\]{}]/g, ' ')
    .replace(/।/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeDigits = (input: string): string => {
  let output = '';
  for (const character of input) {
    const index = DEVANAGARI_DIGITS.indexOf(character);
    output += index >= 0 ? String(index) : character;
  }
  return output;
};

const extractName = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  const nameToken = '[\\p{L}\\p{M}]{2,}';
  const nameCapture = `(${nameToken}(?:\\s+${nameToken})?)`;
  const sanitizeName = (value: string): string =>
    value
      .replace(/\s+(?:hai|hu|hun|है|हूं|हूँ)$/iu, '')
      .trim();
  const patterns = [
    new RegExp(`(?:my name is|mera naam|mere naam)\\s+${nameCapture}(?:\\s+(?:hai|hu|hun))?`, 'iu'),
    new RegExp(`(?:मेरा नाम|मेरे नाम|नाम)\\s+${nameCapture}(?:\\s+(?:है|हूं|हूँ))?`, 'u'),
    new RegExp(`(?:main|mai)\\s+${nameCapture}\\s+(?:hu|hun)`, 'iu'),
    new RegExp(`(?:मैं)\\s+${nameCapture}\\s+(?:हूं|हूँ)`, 'u')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      return sanitizeName(match[1]);
    }
  }
  return undefined;
};

const extractPhone = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  const match = /\b(?:\+91[-\s]?)?([6-9]\d{9})\b/.exec(normalized);
  return match?.[1];
};

const extractDate = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  if (/\bkal\b/.test(normalized) || /कल/.test(normalized)) {
    return 'tomorrow';
  }
  if (/\bparso\b/.test(normalized) || /परसो|परसों/.test(normalized)) {
    return 'day_after_tomorrow';
  }
  if (/\bnext week\b/.test(normalized) || /अगले हफ्ते|अगले सप्ताह/.test(normalized)) {
    return 'next_week';
  }
  if (/\bmonday\b/.test(normalized) || /सोमवार/.test(normalized)) {
    return 'monday';
  }
  if (/\btuesday\b/.test(normalized) || /मंगलवार/.test(normalized)) {
    return 'tuesday';
  }
  return undefined;
};

const extractTime = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  const clockMatch = /\b(1[0-2]|0?[1-9])\s*(?:baje|बजे)\b/i.exec(normalized);
  if (clockMatch) {
    const hour = Number(clockMatch[1]);
    if (/\bsham\b|शाम|रात/.test(normalized)) {
      return `${hour} PM`;
    }
    return `${hour} AM`;
  }
  if (/\bsubah\b|सुबह/.test(normalized)) {
    return 'morning';
  }
  if (/\bdopahar\b|दोपहर/.test(normalized)) {
    return 'afternoon';
  }
  if (/\bsham\b|शाम/.test(normalized)) {
    return 'evening';
  }
  return undefined;
};

const extractService = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  return SERVICE_KEYWORDS.find((keyword) => normalized.includes(keyword));
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
