import { AutoVertical } from './auto-vertical';
import type { BaseVertical, IVerticalType } from './base-vertical';
import { DentalVertical } from './dental-vertical';
import { LegalVertical } from './legal-vertical';

export const createVerticalService = (vertical: IVerticalType): BaseVertical => {
  if (vertical === 'auto') {
    return new AutoVertical();
  }

  if (vertical === 'legal') {
    return new LegalVertical();
  }

  return new DentalVertical();
};

export const detectVerticalFromLanguage = (text: string): IVerticalType | null => {
  const normalized = text.toLowerCase();
  if (normalized.includes('car') || normalized.includes('gaadi')) {
    return 'auto';
  }
  if (normalized.includes('tooth') || normalized.includes('daant')) {
    return 'dental';
  }
  if (normalized.includes('court') || normalized.includes('case')) {
    return 'legal';
  }
  return null;
};
