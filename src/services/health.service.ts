export interface IHealthStatus {
  readonly service: string;
  readonly status: 'ok';
  readonly timestamp: string;
}

export class HealthService {
  public getStatus(): IHealthStatus {
    return {
      service: 'bharatvoice',
      status: 'ok',
      timestamp: new Date().toISOString()
    };
  }
}
