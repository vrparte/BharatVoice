import { createLogger, format, transports } from 'winston';

import { config } from '../config';

export const logger = createLogger({
  level: config.logging.level,
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  defaultMeta: { service: 'bharatvoice-api' },
  transports: [new transports.Console()]
});
