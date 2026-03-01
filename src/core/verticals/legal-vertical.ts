import { BaseVertical, type IIntent } from './base-vertical';

const LEGAL_INTENTS: IIntent[] = [
  {
    name: 'consultation',
    keywords: ['consultation', 'lawyer', 'advocate', 'legal advice', 'case', 'court'],
    response: 'Legal consultation request noted. Hamari legal team aapko confidential callback karegi.'
  },
  {
    name: 'document_help',
    keywords: ['document', 'notice', 'agreement', 'draft'],
    response: 'Document assistance request captured. Team aapse requirements confirm karegi.'
  }
];

export class LegalVertical extends BaseVertical {
  public readonly vertical = 'legal' as const;

  public getGreeting(): string {
    return 'Namaste, Nyaya Legal Associates mein aapka swagat hai.';
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
    return ['name', 'phone'];
  }
}
