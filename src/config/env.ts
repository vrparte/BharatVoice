import dotenv from 'dotenv';

import type { IAppConfig } from '../types/app.types';

dotenv.config();

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 3000;
  }

  const parsedPort = Number.parseInt(value, 10);

  if (Number.isNaN(parsedPort) || parsedPort <= 0) {
    throw new Error('BV_PORT must be a valid positive integer.');
  }

  return parsedPort;
};

export const appConfig: IAppConfig = {
  port: parsePort(process.env.BV_PORT),
  nodeEnv: process.env.BV_NODE_ENV ?? 'development',
  logLevel: process.env.BV_LOG_LEVEL ?? 'info'
};
