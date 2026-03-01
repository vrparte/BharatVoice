import { VoiceService } from '../services/voice.service';
import type { ISarvamTtsVoice } from '../types/sarvam.types';

export interface ICoreConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly timestamp: string;
}

export interface ICoreHandleTranscriptInput {
  readonly transcript: string;
  readonly vertical: string;
  readonly sessionId: string;
  readonly history: readonly ICoreConversationMessage[];
}

export interface ICoreHandleTranscriptResult {
  readonly text: string;
  readonly audio: Buffer;
  readonly voice: ISarvamTtsVoice;
  readonly voiceId: string;
}

export interface ICoreSynthesizeFromContextInput {
  readonly responseText: string;
  readonly vertical: string;
  readonly sessionId: string;
  readonly history: readonly ICoreConversationMessage[];
}

interface IVoiceAgentCoreServiceDependencies {
  readonly voiceService?: VoiceService;
}

const normalizeVertical = (vertical: string): string => {
  return vertical.trim().toLowerCase();
};

export class VoiceAgentCoreService {
  private readonly voiceService: VoiceService;

  public constructor(dependencies?: IVoiceAgentCoreServiceDependencies) {
    this.voiceService = dependencies?.voiceService ?? new VoiceService();
  }

  public async handleTranscript(input: ICoreHandleTranscriptInput): Promise<ICoreHandleTranscriptResult> {
    const cleanTranscript = input.transcript.trim();

    if (cleanTranscript.length === 0) {
      throw new Error('Transcript cannot be empty.');
    }

    const responseText = this.generateEchoResponse(cleanTranscript, normalizeVertical(input.vertical));
    return this.synthesizeResponseText(responseText, 'meera');
  }

  public async synthesizeResponseText(
    text: string,
    voice: ISarvamTtsVoice = 'meera'
  ): Promise<ICoreHandleTranscriptResult> {
    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      throw new Error('Response text cannot be empty.');
    }

    const audio = await this.voiceService.synthesizeSpeech(normalizedText, voice);

    return {
      text: normalizedText,
      audio,
      voice,
      voiceId: this.voiceService.getVoiceId(voice)
    };
  }

  public async synthesizeFromContext(
    input: ICoreSynthesizeFromContextInput
  ): Promise<ICoreHandleTranscriptResult> {
    void input.vertical;
    void input.sessionId;
    void input.history;
    return this.synthesizeResponseText(input.responseText, 'meera');
  }

  private generateEchoResponse(transcript: string, vertical: string): string {
    if (vertical === 'dental') {
      return `Aapne kaha: ${transcript}`;
    }

    return `Aapne kaha: ${transcript}`;
  }
}
