import type { Request, Response } from 'express';

import { HealthService } from '../services/health.service';

const healthService = new HealthService();

export const getHealthController = (_req: Request, res: Response): void => {
  res.status(200).json(healthService.getStatus());
};
