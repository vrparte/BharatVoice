import type { ConversationCollectedData } from '../conversation/state-machine';
import { BaseVertical, type IIntent } from './base-vertical';

const LEGAL_INTENTS: IIntent[] = [
  {
    name: 'consultation',
    keywords: ['consultation', 'lawyer', 'advocate', 'legal advice', 'case', 'court', 'vakeel', 'help'],
    response: 'Legal consultation request note हो गई। हमारी legal team आपको confidential callback करेगी।'
  },
  {
    name: 'document_help',
    keywords: ['document', 'notice', 'agreement', 'draft', 'contract', 'deed'],
    response: 'Document assistance request capture हो गई। Team आपसे requirements confirm करेगी।'
  }
];

export class LegalVertical extends BaseVertical {
  public readonly vertical = 'legal' as const;

  public getGreeting(): string {
    return 'नमस्ते, Nyaya Legal Associates में आपका स्वागत है। मैं आपकी कैसे मदद कर सकता हूँ?';
  }

  public getIntents(): IIntent[] {
    return LEGAL_INTENTS;
  }

  public validateEntity(entity: string, value: string): boolean {
    if (entity === 'phone') {
      return /^[6-9]\d{9}$/.test(value);
    }
    return value.trim().length > 0;
  }

  public getRequiredEntities(): string[] {
    return ['name', 'caseType'];
  }

  public getNextQuestion(field: string, data: ConversationCollectedData): string {
    const ack = data.name ? `ठीक है ${data.name} जी` : 'समझ गया';
    switch (field) {
      case 'name':
        return 'आपका नाम क्या है?';
      case 'caseType':
        return `${ack}, आपको किस प्रकार की legal सहायता चाहिए? जैसे property, divorce, criminal matter, या consumer complaint?`;
      default:
        return `कृपया अपना ${field} बताइए।`;
    }
  }

  public getConfirmationText(data: ConversationCollectedData): string {
    const name = data.name ?? 'जी';
    const caseType = data.caseType ?? 'आपका matter';
    return `ठीक है ${name} जी, ${caseType} के बारे में हमारी legal team आपको callback करेगी। सही है?`;
  }
}
