import { Intent, IntentClassifier } from '../src/core/nlu/intent-classifier';

describe('IntentClassifier', () => {
  it('classifies Hindi appointment request with pain as emergency intent', () => {
    const classifier = new IntentClassifier();

    const result = classifier.classify('मेरे दाँतों में दर्द है मुझे appointment चाहिए');

    expect(result.intent).toBe(Intent.EMERGENCY);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('extracts Hindi name and returns provide info for "मेरा नाम राहुल है"', () => {
    const classifier = new IntentClassifier();

    const result = classifier.classify('मेरा नाम राहुल है');

    expect(result.intent).toBe(Intent.PROVIDE_INFO);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.entities.name).toBe('राहुल');
  });

  it('extracts Hindi name for ASR variant "मेरे नाम राहुल है"', () => {
    const classifier = new IntentClassifier();

    const result = classifier.classify('मेरे नाम राहुल है');

    expect(result.intent).toBe(Intent.PROVIDE_INFO);
    expect(result.entities.name).toBe('राहुल');
  });
});
