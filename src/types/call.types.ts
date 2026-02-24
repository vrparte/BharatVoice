export type ICallDirection = 'incoming' | 'outgoing-api' | 'outgoing-dial';

export type ICallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled'
  | 'unknown';

export interface IExotelCallWebhookPayload {
  readonly CallSid?: string;
  readonly From?: string;
  readonly To?: string;
  readonly Direction?: string;
  readonly CallStatus?: string;
  readonly Status?: string;
  readonly StatusCallbackEvent?: string;
  readonly EventType?: string;
  readonly RecordingUrl?: string;
  readonly [key: string]: unknown;
}

export interface IExotelRecordingWebhookPayload extends IExotelCallWebhookPayload {
  readonly RecordingUrl?: string;
  readonly RecordingUrlMp3?: string;
  readonly RecordingSid?: string;
}

export interface IIncomingCallEvent {
  readonly callSid: string;
  readonly from: string;
  readonly to: string;
  readonly direction: ICallDirection;
  readonly rawDirection: string;
}

export interface ICallStatusEvent {
  readonly callSid: string;
  readonly status: ICallStatus;
  readonly rawStatus: string;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: ICallDirection;
  readonly statusCallbackEvent?: string;
}

export interface IExotelVoiceResponse {
  readonly contentType: 'application/xml';
  readonly body: string;
}

export interface ICallRecordingEvent {
  readonly callSid: string;
  readonly recordingUrl: string;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: ICallDirection;
}

export interface ICallPlaybackAudio {
  readonly audioId: string;
  readonly callSid: string;
  readonly contentType: string;
  readonly audio: Buffer;
  readonly createdAtMs: number;
  readonly responseText: string;
}
