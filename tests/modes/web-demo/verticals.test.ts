import { createVerticalService, detectVerticalFromLanguage } from '../../../src/core/verticals';
import { AutoVertical } from '../../../src/core/verticals/auto-vertical';
import { DentalVertical } from '../../../src/core/verticals/dental-vertical';
import { LegalVertical } from '../../../src/core/verticals/legal-vertical';

describe('Vertical intent matching', () => {
  it('matches dental intents', () => {
    const vertical = new DentalVertical();
    const intent = vertical.detectIntent('Mujhe dental appointment book karna hai');
    expect(intent?.name).toBe('book_appointment');
  });

  it('matches auto intents', () => {
    const vertical = new AutoVertical();
    const intent = vertical.detectIntent('Gaadi service aur engine repair chahiye');
    expect(intent?.name).toBe('service_booking');
  });

  it('matches legal intents', () => {
    const vertical = new LegalVertical();
    const intent = vertical.detectIntent('Mujhe court case consultation chahiye');
    expect(intent?.name).toBe('consultation');
  });

  it('factory returns expected vertical services', () => {
    expect(createVerticalService('dental')).toBeInstanceOf(DentalVertical);
    expect(createVerticalService('auto')).toBeInstanceOf(AutoVertical);
    expect(createVerticalService('legal')).toBeInstanceOf(LegalVertical);
  });

  it('detects vertical from natural language fallback terms', () => {
    expect(detectVerticalFromLanguage('Meri car servicing kab hogi?')).toBe('auto');
    expect(detectVerticalFromLanguage('Mere daant mein dard hai')).toBe('dental');
    expect(detectVerticalFromLanguage('Court case file karna hai')).toBe('legal');
    expect(detectVerticalFromLanguage('namaste')).toBeNull();
  });
});
