export type ISarvamAsrLanguage = 'hi-en' | 'mr-hi';
export type ISarvamBcp47LanguageCode = 'hi-IN' | 'mr-IN';
export type ISarvamSpeechToTextMode = 'codemix';
export type ISarvamSpeechToTextModel = 'saaras:v3';
export type ISarvamTtsVoice = 'meera' | 'pavitra' | 'ratan';
export type ISarvamBulbulSpeaker = 'ritu' | 'priya' | 'ratan';
export type ISarvamTtsModel = 'bulbul:v3';
export type ISarvamOutputAudioCodec = 'wav';

export interface ISarvamSpeechToTextRequest {
  readonly file: Blob;
  readonly fileName: string;
  readonly model: ISarvamSpeechToTextModel;
  readonly mode: ISarvamSpeechToTextMode;
  readonly languageCode: ISarvamBcp47LanguageCode;
}

export interface ISarvamSpeechToTextResponse {
  readonly request_id: string | null;
  readonly transcript: string;
  readonly language_code: string | null;
  readonly language_probability?: number | null;
}

export interface ISarvamErrorBody {
  readonly error?: {
    readonly message?: string;
    readonly code?: string;
    readonly request_id?: string;
  };
}

export interface ISarvamTranscriptionResult {
  readonly transcript: string;
  readonly requestId: string | null;
  readonly languageCode: string | null;
}

export interface ISarvamTextToSpeechRequest {
  readonly text: string;
  readonly target_language_code: ISarvamBcp47LanguageCode;
  readonly speaker?: ISarvamBulbulSpeaker;
  readonly model: ISarvamTtsModel;
  readonly pace?: number;
  readonly speech_sample_rate?: number;
  readonly output_audio_codec?: ISarvamOutputAudioCodec;
  readonly temperature?: number;
}

export interface ISarvamTextToSpeechResponse {
  readonly request_id: string | null;
  readonly audios: string[];
}

export interface ISarvamVoiceProfile {
  readonly appVoice: ISarvamTtsVoice;
  readonly sarvamSpeaker: ISarvamBulbulSpeaker;
  readonly voiceId: string;
  readonly targetLanguageCode: ISarvamBcp47LanguageCode;
}
