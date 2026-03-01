export type IVerticalType = 'dental' | 'auto' | 'legal';

export interface IIntent {
  readonly name: string;
  readonly keywords: string[];
  readonly response: string;
}

export interface IVerticalEntities {
  name?: string;
  phone?: string;
  date?: string;
  time?: string;
  serviceType?: string;
}

export abstract class BaseVertical {
  public abstract readonly vertical: IVerticalType;

  public abstract getGreeting(): string;

  public abstract getIntents(): IIntent[];

  public abstract validateEntity(entity: string, value: string): boolean;

  public abstract getRequiredEntities(): string[];

  public detectIntent(text: string): IIntent | null {
    const normalized = text.toLowerCase();
    for (const intent of this.getIntents()) {
      const matched = intent.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
      if (matched) {
        return intent;
      }
    }
    return null;
  }

  public extractEntities(text: string): IVerticalEntities {
    const entities: IVerticalEntities = {};
    const normalized = text.trim();

    const phoneMatch = /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/.exec(normalized);
    if (phoneMatch) {
      const phone = phoneMatch[0].replace(/[^\d]/g, '').slice(-10);
      if (phone.length === 10 && this.validateEntity('phone', phone)) {
        entities.phone = phone;
      }
    }

    const dateMatch = /\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/.exec(normalized);
    if (dateMatch && this.validateEntity('date', dateMatch[1])) {
      entities.date = dateMatch[1];
    }

    const timeMatch = /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i.exec(normalized);
    if (timeMatch && this.validateEntity('time', timeMatch[1])) {
      entities.time = timeMatch[1];
    }

    const nameMatch = /\b(?:i am|my name is|mera naam|main)\s+([a-zA-Z]+)\b/i.exec(normalized);
    if (nameMatch && this.validateEntity('name', nameMatch[1])) {
      entities.name = nameMatch[1];
    }

    return entities;
  }

  public composeResponse(
    transcript: string,
    entities: IVerticalEntities
  ): { readonly text: string; readonly intentName: string | null } {
    const detectedIntent = this.detectIntent(transcript);
    const missingEntity = this.getRequiredEntities().find((entityKey) => {
      const key = entityKey as keyof IVerticalEntities;
      return !entities[key];
    });

    if (missingEntity) {
      return {
        text: `${this.getGreeting()} Kripya apna ${missingEntity} share kariye.`,
        intentName: detectedIntent?.name ?? null
      };
    }

    if (detectedIntent) {
      const serviceType = entities.serviceType ?? 'service';
      return {
        text: detectedIntent.response.replaceAll('{serviceType}', serviceType),
        intentName: detectedIntent.name
      };
    }

    return {
      text: `Aapne kaha: ${transcript}. ${this.getGreeting()}`,
      intentName: null
    };
  }
}
