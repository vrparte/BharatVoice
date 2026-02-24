process.env.NODE_ENV = 'test';
process.env.BV_SARVAM_API_KEY = process.env.BV_SARVAM_API_KEY ?? 'test-sarvam-key';
process.env.BV_EXOTEL_SID = process.env.BV_EXOTEL_SID ?? 'test-exotel-sid';
process.env.BV_EXOTEL_TOKEN = process.env.BV_EXOTEL_TOKEN ?? 'test-exotel-token';
process.env.BV_DATABASE_URL = process.env.BV_DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/bharatvoice';
process.env.BV_LOG_LEVEL = process.env.BV_LOG_LEVEL ?? 'error';
