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
  readonly doctor?: string;
  readonly carModel?: string;
  readonly carProblem?: string;
  readonly caseType?: string;
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

const HINDI = {
  dard: '\u0926\u0930\u094d\u0926',
  khoon: '\u0916\u0942\u0928',
  accident: '\u090f\u0915\u094d\u0938\u0940\u0921\u0947\u0902\u091f',
  namaste: '\u0928\u092e\u0938\u094d\u0924\u0947',
  namaskar: '\u0928\u092e\u0938\u094d\u0915\u093e\u0930',
  appointment: '\u0905\u092a\u0949\u0907\u0902\u091f\u092e\u0947\u0902\u091f',
  booking: '\u092c\u0941\u0915\u093f\u0902\u0917',
  janaHai: '\u091c\u093e\u0928\u093e \u0939\u0948',
  chahiye: '\u091a\u093e\u0939\u093f\u090f',
  kitna: '\u0915\u093f\u0924\u0928\u093e',
  charge: '\u091a\u093e\u0930\u094d\u091c',
  paise: '\u092a\u0948\u0938\u0947',
  fees: '\u092b\u0940\u0938',
  kabKhulta: '\u0915\u092c \u0916\u0941\u0932\u0924\u093e',
  kitneBaje: '\u0915\u093f\u0924\u0928\u0947 \u092c\u091c\u0947',
  time: '\u091f\u093e\u0907\u092e',
  meraNaam: '\u092e\u0947\u0930\u093e \u0928\u093e\u092e',
  mereNaam: '\u092e\u0947\u0930\u0947 \u0928\u093e\u092e',
  naam: '\u0928\u093e\u092e',
  number: '\u0928\u0902\u092c\u0930',
  phoneNumber: '\u092b\u094b\u0928 \u0928\u0902\u092c\u0930',
  haan: '\u0939\u093e\u0901',
  haanAlt: '\u0939\u093e\u0902',
  theekHai: '\u0920\u0940\u0915 \u0939\u0948',
  ji: '\u091c\u0940',
  nahi: '\u0928\u0939\u0940\u0902',
  nahiAlt: '\u0928\u0939\u093f',
  cancel: '\u0915\u0948\u0902\u0938\u093f\u0932',
  mat: '\u092e\u0924',
  kal: '\u0915\u0932',
  parso: '\u092a\u0930\u0938\u094b',
  parson: '\u092a\u0930\u0938\u094b\u0902',
  agleHafte: '\u0905\u0917\u0932\u0947 \u0939\u092b\u094d\u0924\u0947',
  agleSaptah: '\u0905\u0917\u0932\u0947 \u0938\u092a\u094d\u0924\u093e\u0939',
  somvaar: '\u0938\u094b\u092e\u0935\u093e\u0930',
  mangalvaar: '\u092e\u0902\u0917\u0932\u0935\u093e\u0930',
  baje: '\u092c\u091c\u0947',
  sham: '\u0936\u093e\u092e',
  raat: '\u0930\u093e\u0924',
  subah: '\u0938\u0941\u092c\u0939',
  dopahar: '\u0926\u094b\u092a\u0939\u0930',
  danda: '\u0964',
  mai: '\u092e\u0948\u0902',
  hai: '\u0939\u0948',
  hoon: '\u0939\u0942\u0902',
  hoonAlt: '\u0939\u0942\u0901'
} as const;

const SERVICE_KEYWORDS = ['cleaning', 'filling', 'service', 'consultation'] as const;
const DEVANAGARI_DIGITS = '\u0966\u0967\u0968\u0969\u096a\u096b\u096c\u096d\u096e\u096f';

const CAR_MODELS = [
  'swift', 'baleno', 'brezza', 'alto', 'wagon r', 'ertiga', 'vitara',
  'innova', 'fortuner', 'corolla', 'camry', 'yaris',
  'city', 'amaze', 'jazz', 'crv', 'civic',
  'creta', 'i20', 'venue', 'verna', 'exter', 'alcazar',
  'duster', 'kiger', 'triber',
  'tiago', 'altroz', 'nexon', 'harrier', 'safari', 'punch',
  'scorpio', 'bolero', 'thar', 'xuv', 'xuv700', 'xuv300',
  'dzire', 'ciaz', 'eeco',
] as const;

const CAR_PROBLEM_KEYWORDS = [
  'engine', 'brake', 'brakes', 'tyre', 'tires', 'tyres', 'tire',
  'oil', 'ac', 'air conditioning', 'coolant', 'battery', 'dent',
  'scratch', 'accident', 'gear', 'transmission', 'clutch', 'radiator',
  'noise', 'sound', 'vibration', 'smoke', 'leak', 'overheating',
  'headlight', 'indicator', 'wiper', 'suspension',
] as const;

const CASE_TYPE_KEYWORDS: readonly { keywords: readonly string[]; label: string }[] = [
  { keywords: ['property', 'land', 'zameen', 'plot', 'flat', 'house'], label: 'property' },
  { keywords: ['divorce', 'talaq', 'separation', 'marriage', 'matrimonial'], label: 'divorce' },
  { keywords: ['criminal', 'crime', 'theft', 'fraud', 'cheating', 'fir'], label: 'criminal' },
  { keywords: ['civil', 'civil case', 'dispute', 'contract', 'agreement'], label: 'civil' },
  { keywords: ['labour', 'employment', 'job', 'salary', 'termination', 'office'], label: 'labour' },
  { keywords: ['consumer', 'product', 'defective', 'complaint', 'refund'], label: 'consumer' },
  { keywords: ['family', 'inheritance', 'will', 'succession'], label: 'family' },
];

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: Intent.EMERGENCY,
    keywords: ['emergency', 'dard', 'pain', 'blood', 'accident', HINDI.dard, HINDI.khoon, HINDI.accident],
    baseConfidence: 0.95
  },
  {
    intent: Intent.GREETING,
    keywords: ['namaste', 'hello', 'hi', 'good morning', HINDI.namaste, HINDI.namaskar],
    baseConfidence: 0.95
  },
  {
    intent: Intent.BOOK_APPOINTMENT,
    keywords: ['appointment', 'booking', 'slot', 'time', 'jana hai', HINDI.appointment, HINDI.booking, HINDI.janaHai, HINDI.chahiye],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_PRICE,
    keywords: ['kitna', 'price', 'cost', 'charge', 'paise', HINDI.kitna, HINDI.charge, HINDI.paise, HINDI.fees],
    baseConfidence: 0.9
  },
  {
    intent: Intent.CHECK_HOURS,
    keywords: ['time', 'hours', 'kab khulta', 'kitne baje', HINDI.kabKhulta, HINDI.kitneBaje, HINDI.time],
    baseConfidence: 0.85
  },
  {
    intent: Intent.PROVIDE_INFO,
    keywords: ['my name is', 'mera naam', 'number hai', HINDI.meraNaam, HINDI.naam, HINDI.number, HINDI.phoneNumber],
    baseConfidence: 0.8
  },
  {
    intent: Intent.CONFIRM,
    keywords: ['yes', 'haan', 'theek hai', 'ok', HINDI.haan, HINDI.haanAlt, HINDI.theekHai, HINDI.ji],
    baseConfidence: 0.9
  },
  {
    intent: Intent.REJECT,
    keywords: ['no', 'nahi', 'cancel', HINDI.nahi, HINDI.nahiAlt, HINDI.cancel, HINDI.mat],
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
    .replace(new RegExp(HINDI.danda, 'g'), ' ')
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
      .replace(new RegExp(`\\s+(?:hai|hu|hun|${HINDI.hai}|${HINDI.hoon}|${HINDI.hoonAlt})$`, 'iu'), '')
      .trim();
  const patterns = [
    new RegExp(`(?:my name is|mera naam|mere naam)\\s+${nameCapture}(?:\\s+(?:hai|hu|hun))?`, 'iu'),
    new RegExp(`(?:${HINDI.meraNaam}|${HINDI.mereNaam}|${HINDI.naam})\\s+${nameCapture}(?:\\s+(?:${HINDI.hai}|${HINDI.hoon}|${HINDI.hoonAlt}))?`, 'u'),
    new RegExp(`(?:main|mai)\\s+${nameCapture}\\s+(?:hu|hun)`, 'iu'),
    new RegExp(`(?:${HINDI.mai})\\s+${nameCapture}\\s+(?:${HINDI.hoon}|${HINDI.hoonAlt})`, 'u')
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
  if (/\bkal\b/.test(normalized) || normalized.includes(HINDI.kal)) {
    return 'tomorrow';
  }
  if (/\bparso\b/.test(normalized) || normalized.includes(HINDI.parso) || normalized.includes(HINDI.parson)) {
    return 'day_after_tomorrow';
  }
  if (
    /\bnext week\b/.test(normalized) ||
    normalized.includes(HINDI.agleHafte) ||
    normalized.includes(HINDI.agleSaptah)
  ) {
    return 'next_week';
  }
  if (/\bmonday\b/.test(normalized) || normalized.includes(HINDI.somvaar)) {
    return 'monday';
  }
  if (/\btuesday\b/.test(normalized) || normalized.includes(HINDI.mangalvaar)) {
    return 'tuesday';
  }
  return undefined;
};

const extractTime = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  const clockMatch = new RegExp(`\\b(1[0-2]|0?[1-9])\\s*(?:baje|${HINDI.baje})\\b`, 'i').exec(normalized);
  if (clockMatch) {
    const hour = Number(clockMatch[1]);
    if (new RegExp(`\\bsham\\b|${HINDI.sham}|${HINDI.raat}`).test(normalized)) {
      return `${hour} PM`;
    }
    return `${hour} AM`;
  }
  if (new RegExp(`\\bsubah\\b|${HINDI.subah}`).test(normalized)) {
    return 'morning';
  }
  if (new RegExp(`\\bdopahar\\b|${HINDI.dopahar}`).test(normalized)) {
    return 'afternoon';
  }
  if (new RegExp(`\\bsham\\b|${HINDI.sham}`).test(normalized)) {
    return 'evening';
  }
  return undefined;
};

const extractService = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input);
  return SERVICE_KEYWORDS.find((keyword) => normalized.includes(keyword));
};

const extractDoctor = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input).toLowerCase();
  if (normalized.includes('sharma') || normalized.includes('pehle') || normalized.includes('first') || normalized.includes('1')) {
    return 'Dr. Sharma';
  }
  if (normalized.includes('mehta') || normalized.includes('dusre') || normalized.includes('second') || normalized.includes('2')) {
    return 'Dr. Mehta';
  }
  return undefined;
};

const extractCarModel = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input).toLowerCase();
  return CAR_MODELS.find((model) => normalized.includes(model));
};

const extractCarProblem = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input).toLowerCase();
  return CAR_PROBLEM_KEYWORDS.find((keyword) => normalized.includes(keyword));
};

const extractCaseType = (input: string): string | undefined => {
  const normalized = normalizeForEntityExtraction(input).toLowerCase();
  for (const { keywords, label } of CASE_TYPE_KEYWORDS) {
    if (keywords.some((kw) => normalized.includes(kw))) {
      return label;
    }
  }
  return undefined;
};

const extractEntities = (input: string): ExtractedEntities => ({
  name: extractName(input),
  date: extractDate(input),
  time: extractTime(input),
  phone: extractPhone(input),
  service: extractService(input),
  doctor: extractDoctor(input),
  carModel: extractCarModel(input),
  carProblem: extractCarProblem(input),
  caseType: extractCaseType(input)
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
