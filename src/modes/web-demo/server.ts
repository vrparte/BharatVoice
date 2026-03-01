import { createServer } from 'http';
import path from 'path';

import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';

import { config } from '../../config';
import { VoiceAgentCoreService } from '../../core/voice-agent-core.service';
import { logger } from '../../utils/logger';

import { WebDemoAnalyticsTracker } from './analytics';
import type { IAnalyticsStore } from './analytics-store';
import { webDemoConfig, validateWebDemoStartup } from './config';
import { WebDemoErrorManager } from './error-handler';
import { WebDemoSessionStore } from './session-store';
import { createVoiceWebSocketHandler } from './websocket-handler';

const ALLOWED_ORIGINS = new Set(webDemoConfig.corsOrigins);

const resolvePublicDirectory = (): string => {
  return path.resolve(__dirname, 'public');
};

const createCorsMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
};

const app = express();
const httpServer = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });
const sessionStore = new WebDemoSessionStore({
  sessionTtlMinutes: webDemoConfig.sessionTtlMinutes
});
const coreService = new VoiceAgentCoreService();
const errorManager = new WebDemoErrorManager();
const analyticsStore: IAnalyticsStore | undefined = webDemoConfig.analytics.enabled
  ? undefined
  : {
      track: (): Promise<void> => Promise.resolve(),
      getDashboard: () =>
        Promise.resolve({
          today: {
            demosStarted: 0,
            avgDurationSeconds: 0,
            conversionRate: 0
          },
          topVerticals: [],
          errorRates: [],
          geographicDistribution: []
        }),
      cleanupExpiredSessions: (): Promise<void> => Promise.resolve()
    };
const analytics = new WebDemoAnalyticsTracker(analyticsStore);
const analyticsCleanupTimer = setInterval(() => {
  void analytics.cleanup().catch((error: unknown) => {
    logger.warn('Analytics cleanup failed', {
      eventType: 'web_demo.analytics.cleanup_failed',
      error: error instanceof Error ? error.message : 'Unknown analytics cleanup error'
    });
  });
}, 10 * 60 * 1000);
analyticsCleanupTimer.unref();

const handleVoiceWebSocket = createVoiceWebSocketHandler({
  coreService,
  sessionStore,
  errorManager,
  analytics
});

app.use(createCorsMiddleware());
app.use(express.json());

const publicDirectory = resolvePublicDirectory();
app.use('/demo', express.static(publicDirectory));
app.get('/demo', (_req: Request, res: Response): void => {
  res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/demo/audio/:audioId', (req: Request, res: Response): void => {
  const audioId = typeof req.params.audioId === 'string' ? req.params.audioId : '';
  const audio = sessionStore.getAudio(audioId);

  if (!audio) {
    res.status(404).json({ error: 'Audio not found' });
    return;
  }

  res.status(200).type(audio.contentType).send(audio.audio);
});

app.get('/health/demo', (_req: Request, res: Response): void => {
  const health = errorManager.getHealthSnapshot();
  res.status(200).json({
    status: 'ok',
    websocket: health.websocket,
    ttsService: health.ttsService,
    recentErrorRate: health.recentErrorRate,
    recentErrors: health.recentErrors,
    recentRequests: health.recentRequests
  });
});

app.get('/analytics/dashboard', (_req: Request, res: Response): void => {
  void analytics
    .getDashboard()
    .then((dashboard) => {
      res.status(200).json(dashboard);
    })
    .catch((error: unknown) => {
      logger.error('Failed to load analytics dashboard', {
        eventType: 'web_demo.analytics.dashboard_route_error',
        error: error instanceof Error ? error.message : 'Unknown analytics dashboard error'
      });
      res.status(500).json({ error: 'Failed to load analytics dashboard' });
    });
});

httpServer.on('upgrade', (request, socket, head) => {
  const requestUrl = request.url ?? '';
  if (!requestUrl.startsWith('/ws/voice')) {
    socket.destroy();
    return;
  }

  if (wsServer.clients.size >= webDemoConfig.maxConcurrent) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    logger.warn('Web demo connection rejected: max concurrent clients reached', {
      eventType: 'web_demo.websocket.max_concurrent_reached',
      maxConcurrent: webDemoConfig.maxConcurrent
    });
    return;
  }

  wsServer.handleUpgrade(request, socket, head, (ws) => {
    handleVoiceWebSocket(ws, request);
  });
});

const startServer = async (): Promise<void> => {
  await validateWebDemoStartup();

  if (webDemoConfig.mode === 'disabled') {
    return;
  }

  httpServer.listen(webDemoConfig.port, () => {
    logger.info('BharatVoice web demo server started', {
      eventType: 'web_demo.server.started',
      nodeEnv: config.env,
      mode: webDemoConfig.mode,
      port: webDemoConfig.port,
      telephonyPort: config.server.port,
      demoUrl: `http://localhost:${webDemoConfig.port}/demo`,
      websocketUrl: `ws://localhost:${webDemoConfig.port}/ws/voice`,
      maxConcurrent: webDemoConfig.maxConcurrent
    });
  });
};

void startServer().catch((error: unknown) => {
  logger.error('Web demo startup failed', {
    eventType: 'web_demo.server.start_failed',
    error: error instanceof Error ? error.message : 'Unknown startup error'
  });
  process.exitCode = 1;
});
