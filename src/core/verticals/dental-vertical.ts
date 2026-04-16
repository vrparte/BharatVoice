import type { ConversationCollectedData } from '../conversation/state-machine';
import { formatTimePhrase, localizeDate, localizeTime } from '../conversation/slot-display';
import { BaseVertical, type IIntent } from './base-vertical';

const DOCTORS = ['Dr. Sharma', 'Dr. Mehta'] as const;

const DENTAL_INTENTS: IIntent[] = [
  {
    name: 'book_appointment',
    keywords: ['appointment', 'book', 'checkup', 'cleaning', 'root canal', 'daant', 'tooth', 'dental', 'milna'],
    response: 'Appointment request note हो गई। हम आपको confirmation के साथ callback करेंगे।'
  },
  {
    name: 'clinic_timing',
    keywords: ['timing', 'open', 'close', 'hours', 'kab'],
    response: 'Clinic timing: Monday to Saturday, 9 AM से 7 PM तक। Sunday बंद रहता है।'
  }
];

export class DentalVertical extends BaseVertical {
  public readonly vertical = 'dental' as const;

  public getGreeting(): string {
    return 'नमस्ते, Smile Dental में आपका स्वागत है। मैं आपकी कैसे मदद कर सकता हूँ?';
  }

  public getIntents(): IIntent[] {
    return DENTAL_INTENTS;
  }

  public validateEntity(entity: string, value: string): boolean {
    if (entity === 'phone') {
      return /^[6-9]\d{9}$/.test(value);
    }
    if (entity === 'doctor') {
      return DOCTORS.some((d) => value.toLowerCase().includes(d.toLowerCase().split(' ')[1]));
    }
    return value.trim().length > 0;
  }

  public getRequiredEntities(): string[] {
    return ['name', 'date', 'time', 'doctor'];
  }

  public getNextQuestion(field: string, data: ConversationCollectedData): string {
    const ack = data.name ? `ठीक है ${data.name} जी` : 'समझ गया';
    switch (field) {
      case 'name':
        return 'आपका नाम क्या है?';
      case 'date':
        return `${ack}, आप कब आना चाहेंगे? कल या कोई और दिन बताइए।`;
      case 'time': {
        const prefix = data.date ? `${localizeDate(data.date)} note कर लिया।` : ack + ',';
        return `${prefix} कितने बजे आना चाहेंगे? सुबह 9 से 12, दोपहर 12 से 4, या शाम 4 से 7?`;
      }
      case 'doctor': {
        const prefix = data.time ? `${localizeTime(data.time)} के लिए note कर रहा हूँ।` : ack + ' —';
        return `${prefix} हमारे पास ${DOCTORS[0]} और ${DOCTORS[1]} हैं। किससे मिलना चाहेंगे?`;
      }
      default:
        return `कृपया अपना ${field} बताइए।`;
    }
  }

  public getConfirmationText(data: ConversationCollectedData): string {
    const name = data.name ?? 'जी';
    const doctor = data.doctor ?? 'doctor';
    const timePhrase = formatTimePhrase(data.date, data.time) || 'निर्धारित समय पर';
    return `ठीक है ${name} जी, आपकी appointment ${doctor} के साथ ${timePhrase} है। सही है?`;
  }
}
