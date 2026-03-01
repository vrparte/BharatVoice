import { BaseVertical, type IIntent } from './base-vertical';

const DENTAL_INTENTS: IIntent[] = [
  {
    name: 'book_appointment',
    keywords: ['appointment', 'book', 'checkup', 'cleaning', 'root canal', 'daant', 'tooth', 'dental'],
    response: 'Dental appointment request noted. Hum aapko slot confirmation ke saath callback karenge.'
  },
  {
    name: 'clinic_timing',
    keywords: ['timing', 'open', 'close', 'hours'],
    response: 'Clinic timing request noted. Team aapko confirmed schedule bhej degi.'
  }
];

export class DentalVertical extends BaseVertical {
  public readonly vertical = 'dental' as const;

  public getGreeting(): string {
    return 'Namaste, Smile Dental mein aapka swagat hai.';
  }

  public getIntents(): IIntent[] {
    return DENTAL_INTENTS;
  }

  public validateEntity(entity: string, value: string): boolean {
    if (entity === 'phone') {
      return /^[6-9]\d{9}$/.test(value);
    }
    return value.trim().length > 0;
  }

  public getRequiredEntities(): string[] {
    return ['name', 'phone', 'date', 'time'];
  }
}
