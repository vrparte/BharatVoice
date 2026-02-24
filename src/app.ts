import express, { type Request, type Response } from 'express';

import { getHealthController } from './controllers/health.controller';
import { appConfig } from './config/env';
import { errorHandlerMiddleware } from './middleware/error-handler.middleware';
import { logger } from './utils/logger';

export const app = express();

app.use(express.json());

app.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({
    name: 'BharatVoice Voice AI Agent',
    status: 'ready'
  });
});

app.get('/health', getHealthController);

app.use(errorHandlerMiddleware);

if (require.main === module) {
  app.listen(appConfig.port, (): void => {
    logger.info('BharatVoice server started', {
      nodeEnv: appConfig.nodeEnv,
      port: appConfig.port
    });
  });
}
