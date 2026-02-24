import { createLogger, format, transports } from 'winston';

import { appConfig } from '../config/env';

export const logger = createLogger({
  level: appConfig.logLevel,
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  defaultMeta: { service: 'bharatvoice-api' },
  transports: [new transports.Console()]
});
