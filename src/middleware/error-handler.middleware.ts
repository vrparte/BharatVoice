import type { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/logger';

export const errorHandlerMiddleware = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  void _next;
  logger.error('Unhandled application error', { error });
  res.status(500).json({ error: 'Internal Server Error' });
};
