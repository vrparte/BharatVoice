import type { ConversationCollectedData } from '../conversation/state-machine';
import { formatTimePhrase, localizeDate } from '../conversation/slot-display';
import { BaseVertical, type IIntent } from './base-vertical';

const AUTO_INTENTS: IIntent[] = [
  {
    name: 'service_booking',
    keywords: ['service', 'car', 'gaadi', 'vehicle', 'engine', 'repair', 'mechanic', 'fix', 'problem'],
    response: 'Service request capture हो गई। Workshop team आपको booking confirmation के साथ contact करेगी।'
  },
  {
    name: 'pickup_drop',
    keywords: ['pickup', 'drop', 'towing', 'tow'],
    response: 'Pickup/drop request note हो गई। हम location details लेकर आपसे जल्द contact करेंगे।'
  }
];

export class AutoVertical extends BaseVertical {
  public readonly vertical = 'auto' as const;

  public getGreeting(): string {
    return 'नमस्ते, Bharat Auto Care में आपका स्वागत है। मैं आपकी गाड़ी के बारे में कैसे मदद कर सकता हूँ?';
  }

  public getIntents(): IIntent[] {
    return AUTO_INTENTS;
  }

  public validateEntity(entity: string, value: string): boolean {
    if (entity === 'phone') {
      return /^[6-9]\d{9}$/.test(value);
    }
    return value.trim().length > 0;
  }

  public getRequiredEntities(): string[] {
    return ['name', 'date', 'time', 'carModel', 'carProblem'];
  }

  public getNextQuestion(field: string, data: ConversationCollectedData): string {
    const ack = data.name ? `ठीक है ${data.name} जी` : 'समझ गया';
    switch (field) {
      case 'name':
        return 'आपका नाम क्या है?';
      case 'date':
        return `${ack}, गाड़ी कब लाना चाहेंगे? कल या कोई और दिन?`;
      case 'time': {
        const prefix = data.date ? `${localizeDate(data.date)} note कर लिया।` : ack + ',';
        return `${prefix} कितने बजे लाना चाहेंगे? सुबह 8 से 12, या दोपहर को?`;
      }
      case 'carModel':
        return `${ack}, आपकी गाड़ी का model क्या है? जैसे Swift, Innova, Creta आदि।`;
      case 'carProblem': {
        const prefix = data.carModel ? `${data.carModel} के लिए note कर रहा हूँ।` : ack + ',';
        return `${prefix} गाड़ी में क्या problem है? जैसे engine, brake, tyre, AC?`;
      }
      default:
        return `कृपया अपना ${field} बताइए।`;
    }
  }

  public getConfirmationText(data: ConversationCollectedData): string {
    const name = data.name ?? 'जी';
    const carModel = data.carModel ?? 'आपकी गाड़ी';
    const carProblem = data.carProblem ?? 'problem';
    const timePhrase = formatTimePhrase(data.date, data.time) || 'निर्धारित समय पर';
    return `ठीक है ${name} जी, ${carModel} की ${carProblem} के लिए ${timePhrase} service booking हो गई। सही है?`;
  }
}
