process.env.NODE_ENV = 'test';
process.env.BV_SARVAM_API_KEY = process.env.BV_SARVAM_API_KEY ?? 'test-sarvam-key';
process.env.BV_EXOTEL_SID = process.env.BV_EXOTEL_SID ?? 'test-exotel-sid';
process.env.BV_EXOTEL_TOKEN = process.env.BV_EXOTEL_TOKEN ?? 'test-exotel-token';
process.env.BV_DATABASE_URL = process.env.BV_DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/bharatvoice';
process.env.BV_LOG_LEVEL = process.env.BV_LOG_LEVEL ?? 'error';
process.env.BV_N8N_WEBHOOK_URL = process.env.BV_N8N_WEBHOOK_URL ?? 'http://localhost:5678/webhook/test';

class MockSpeechRecognition {
  public lang = 'hi-IN';
  public continuous = false;
  public interimResults = true;
  public maxAlternatives = 1;

  public onstart: (() => void) | null = null;
  public onend: (() => void) | null = null;
  public onerror: ((event: { error: string }) => void) | null = null;
  public onresult: ((event: unknown) => void) | null = null;

  public start(): void {
    this.onstart?.();
  }

  public stop(): void {
    this.onend?.();
  }
}

(globalThis as typeof globalThis & { SpeechRecognition: typeof MockSpeechRecognition }).SpeechRecognition =
  MockSpeechRecognition;
