import express, { type Request, type Response } from 'express';

import { config } from './config';
import {
  handleCallStartWebhook,
  handlePlaybackAudioRequest,
  handleRecordingCallbackWebhook
} from './controllers/call-flow.controller';
import { getHealthController } from './controllers/health.controller';
import {
  handleCallStatusCallback,
  handleIncomingCallWebhook
} from './controllers/telephony.controller';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware';
import { VoiceService } from './services/voice.service';
import type { ISarvamTtsVoice } from './types/sarvam.types';
import { logger } from './utils/logger';

export const app = express();
const voiceService = new VoiceService();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({
    name: 'BharatVoice Voice AI Agent',
    status: 'ready'
  });
});

app.get('/health', getHealthController);
app.post('/webhook/call-start', handleCallStartWebhook);
app.post('/webhook/call-recording', (req: Request, res: Response): void => {
  void handleRecordingCallbackWebhook(req, res);
});
app.post('/webhook/incoming-call', handleIncomingCallWebhook);
app.post('/webhook/call-status', handleCallStatusCallback);
app.get('/media/call-audio/:audioId', handlePlaybackAudioRequest);
app.get('/test/tts', (req: Request, res: Response): void => {
  const textQuery = typeof req.query.text === 'string' ? req.query.text : 'Hello, your call is received';
  const voiceQuery = typeof req.query.voice === 'string' ? req.query.voice : 'ratan';

  if (voiceQuery !== 'meera' && voiceQuery !== 'pavitra' && voiceQuery !== 'ratan') {
    res.status(400).json({
      error: 'Invalid voice',
      message: 'voice must be one of: meera, pavitra, ratan'
    });
    return;
  }

  void (async (): Promise<void> => {
    try {
      const voice = voiceQuery as ISarvamTtsVoice;
      const audioBuffer = await voiceService.synthesizeSpeech(textQuery, voice);

      res
        .status(200)
        .type(voiceService.getAudioContentType())
        .setHeader('Content-Disposition', `inline; filename="tts-${voice}.wav"`)
        .setHeader('X-BharatVoice-Voice-Id', voiceService.getVoiceId(voice))
        .send(audioBuffer);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown TTS synthesis error';

      logger.error('TTS test endpoint failed', {
        eventType: 'test.tts.error',
        error: errorMessage
      });

      res.status(502).json({
        error: 'TTS synthesis failed',
        message: errorMessage
      });
    }
  })();
});

app.use(errorHandlerMiddleware);

if (require.main === module) {
  app.listen(config.server.port, (): void => {
    logger.info('BharatVoice server started', {
      nodeEnv: config.env,
      port: config.server.port
    });
  });
}
