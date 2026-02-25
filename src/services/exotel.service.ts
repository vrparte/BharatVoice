import type {
  ICallRecordingEvent,
  ICallDirection,
  ICallStatus,
  ICallStatusEvent,
  IExotelCallWebhookPayload,
  IExotelVoiceResponse,
  IIncomingCallEvent
} from '../types/call.types';

const REQUIRED_INCOMING_FIELDS = ['CallSid', 'From', 'To', 'Direction'] as const;
const REQUIRED_RECORDING_FIELDS = ['CallSid'] as const;

const escapeXml = (value: string): string => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const readString = (payload: Record<string, unknown>, fieldName: string): string | undefined => {
  const rawValue = payload[fieldName];

  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmedValue = rawValue.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const normalizeDirection = (rawDirection: string): ICallDirection => {
  const normalized = rawDirection.trim().toLowerCase();

  if (normalized === 'incoming') {
    return 'incoming';
  }

  if (normalized === 'outgoing-api') {
    return 'outgoing-api';
  }

  return 'outgoing-dial';
};

const normalizeStatus = (rawStatus: string | undefined): ICallStatus => {
  if (!rawStatus) {
    return 'unknown';
  }

  const normalized = rawStatus.trim().toLowerCase();

  switch (normalized) {
    case 'queued':
    case 'ringing':
    case 'in-progress':
    case 'completed':
    case 'failed':
    case 'busy':
    case 'no-answer':
    case 'canceled':
      return normalized;
    default:
      return 'unknown';
  }
};

export class ExotelService {
  public parseIncomingCallWebhook(payload: unknown): IIncomingCallEvent {
    if (!isRecord(payload)) {
      throw new Error('Invalid Exotel incoming call payload: expected an object payload.');
    }

    const missingFields = REQUIRED_INCOMING_FIELDS.filter((fieldName) => !readString(payload, fieldName));

    if (missingFields.length > 0) {
      throw new Error(
        `Invalid Exotel incoming call payload: missing required field(s): ${missingFields.join(', ')}.`
      );
    }

    const rawDirection = readString(payload, 'Direction');

    if (!rawDirection) {
      throw new Error('Invalid Exotel incoming call payload: Direction is required.');
    }

    return {
      callSid: readString(payload, 'CallSid')!,
      from: readString(payload, 'From')!,
      to: readString(payload, 'To')!,
      direction: normalizeDirection(rawDirection),
      rawDirection
    };
  }

  public parseCallStatusWebhook(payload: unknown): ICallStatusEvent {
    if (!isRecord(payload)) {
      throw new Error('Invalid Exotel call status payload: expected an object payload.');
    }

    const callSid = readString(payload, 'CallSid');

    if (!callSid) {
      throw new Error('Invalid Exotel call status payload: CallSid is required.');
    }

    const rawDirection = readString(payload, 'Direction');
    const rawStatus = readString(payload, 'CallStatus') ?? readString(payload, 'Status') ?? 'unknown';

    return {
      callSid,
      status: normalizeStatus(rawStatus),
      rawStatus,
      from: readString(payload, 'From'),
      to: readString(payload, 'To'),
      direction: rawDirection ? normalizeDirection(rawDirection) : undefined,
      statusCallbackEvent: readString(payload, 'StatusCallbackEvent')
    };
  }

  public parseRecordingWebhook(payload: unknown): ICallRecordingEvent {
    if (!isRecord(payload)) {
      throw new Error('Invalid Exotel recording payload: expected an object payload.');
    }

    const missingFields = REQUIRED_RECORDING_FIELDS.filter((fieldName) => !readString(payload, fieldName));

    if (missingFields.length > 0) {
      throw new Error(
        `Invalid Exotel recording payload: missing required field(s): ${missingFields.join(', ')}.`
      );
    }

    const recordingUrl = readString(payload, 'RecordingUrl') ?? readString(payload, 'RecordingUrlMp3');

    if (!recordingUrl) {
      throw new Error(
        'Invalid Exotel recording payload: RecordingUrl or RecordingUrlMp3 is required for transcription.'
      );
    }

    const rawDirection = readString(payload, 'Direction');

    return {
      callSid: readString(payload, 'CallSid')!,
      recordingUrl,
      from: readString(payload, 'From'),
      to: readString(payload, 'To'),
      direction: rawDirection ? normalizeDirection(rawDirection) : undefined
    };
  }

  public buildSayResponse(message: string): IExotelVoiceResponse {
    const safeMessage = escapeXml(message.trim());

    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${safeMessage}</Say></Response>`
    };
  }

  public buildRecordResponse(input: {
    readonly prompt: string;
    readonly actionUrl: string;
    readonly maxLengthSeconds?: number;
  }): IExotelVoiceResponse {
    const safePrompt = escapeXml(input.prompt.trim());
    const safeActionUrl = escapeXml(input.actionUrl);
    const maxLengthSeconds = input.maxLengthSeconds ?? 8;

    return {
      contentType: 'application/xml',
      body:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<Response><Say>${safePrompt}</Say><Record action="${safeActionUrl}" method="POST" maxLength="${maxLengthSeconds}" timeout="3" /></Response>`
    };
  }

  public buildPlayResponse(playUrl: string): IExotelVoiceResponse {
    const safePlayUrl = escapeXml(playUrl);

    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${safePlayUrl}</Play></Response>`
    };
  }

  public buildPlayAndHangupResponse(playUrl: string): IExotelVoiceResponse {
    const safePlayUrl = escapeXml(playUrl);

    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${safePlayUrl}</Play><Hangup /></Response>`
    };
  }

  public asExotelPayload(payload: unknown): IExotelCallWebhookPayload {
    if (!isRecord(payload)) {
      return {};
    }

    return payload;
  }
}
