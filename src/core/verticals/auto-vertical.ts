import { BaseVertical, type IIntent } from './base-vertical';

const AUTO_INTENTS: IIntent[] = [
  {
    name: 'service_booking',
    keywords: ['service', 'car', 'gaadi', 'vehicle', 'engine', 'repair', 'mechanic'],
    response: 'Auto service request captured. Workshop team aapko booking confirmation ke saath callback karegi.'
  },
  {
    name: 'pickup_drop',
    keywords: ['pickup', 'drop', 'towing'],
    response: 'Pickup/drop request noted. Hum location details lekar aapse turant contact karenge.'
  }
];

export class AutoVertical extends BaseVertical {
  public readonly vertical = 'auto' as const;

  public getGreeting(): string {
    return 'Namaste, Bharat Auto Care mein aapka swagat hai.';
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
    return ['name', 'phone', 'serviceType'];
  }
}
