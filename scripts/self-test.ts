/* eslint-disable no-console */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { constants } from 'fs';
import { access, readFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';

import WebSocket from 'ws';

import { createVerticalService } from '../src/core/verticals';
import { AutoVertical } from '../src/core/verticals/auto-vertical';
import { DentalVertical } from '../src/core/verticals/dental-vertical';
import { LegalVertical } from '../src/core/verticals/legal-vertical';
import { WebDemoErrorManager } from '../src/modes/web-demo/error-handler';
import { WebDemoSessionStore } from '../src/modes/web-demo/session-store';
import { createVoiceWebSocketHandler } from '../src/modes/web-demo/websocket-handler';
import { VoiceService } from '../src/services/voice.service';

type IStatus = 'pass' | 'fail' | 'skip';
type ICategory = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface IResult {
  readonly status: IStatus;
  readonly category: ICategory;
  readonly testName: string;
  readonly details: string;
}

interface IJsonMessage {
  readonly type?: string;
  readonly [key: string]: unknown;
}

interface IServerHandle {
  readonly process: ChildProcessWithoutNullStreams;
  readonly port: number;
  stop: () => Promise<void>;
}

class MockSocket {
  private readonly handlers = new Map<string, ((payload: Buffer) => void)[]>();
  public readonly sentFrames: (string | Buffer)[] = [];

  public on(event: string, callback: (payload: Buffer) => void): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...existing, callback]);
  }

  public send(data: string | Buffer): void {
    this.sentFrames.push(data);
  }

  public emitJson(payload: unknown): void {
    const listeners = this.handlers.get('message') ?? [];
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    listeners.forEach((listener) => listener(body));
  }

  public emitRaw(raw: string): void {
    const listeners = this.handlers.get('message') ?? [];
    const body = Buffer.from(raw, 'utf8');
    listeners.forEach((listener) => listener(body));
  }
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const localRequire = createRequire(__filename);
const REQUIRED_FILES: readonly string[] = [
  'src/modes/web-demo/server.ts',
  'src/modes/web-demo/websocket-handler.ts',
  'src/modes/web-demo/session-store.ts',
  'src/modes/web-demo/error-handler.ts',
  'src/modes/web-demo/public/index.html',
  'src/modes/web-demo/public/demo.js',
  'src/core/verticals/base-vertical.ts',
  'src/core/verticals/dental-vertical.ts',
  'src/core/verticals/auto-vertical.ts',
  'src/core/verticals/legal-vertical.ts',
  'src/core/verticals/index.ts'
];

const results: IResult[] = [];

const report = (status: IStatus, category: ICategory, testName: string, details: string): void => {
  results.push({ status, category, testName, details });
  const icon = status === 'pass' ? '✅ PASS' : status === 'fail' ? '❌ FAIL' : '⚠️  SKIP';
  console.log(`${icon}: ${testName} - ${details}`);
};

const resolvePath = (relativePath: string): string => {
  return path.join(PROJECT_ROOT, relativePath);
};

const setRequiredEnv = (): void => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.BV_SARVAM_API_KEY = process.env.BV_SARVAM_API_KEY ?? 'test-sarvam-key';
  process.env.BV_EXOTEL_SID = process.env.BV_EXOTEL_SID ?? 'test-exotel-sid';
  process.env.BV_EXOTEL_TOKEN = process.env.BV_EXOTEL_TOKEN ?? 'test-exotel-token';
  process.env.BV_DATABASE_URL =
    process.env.BV_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/bharatvoice';
  process.env.BV_LOG_LEVEL = process.env.BV_LOG_LEVEL ?? 'error';
  process.env.BV_DEMO_MODE = process.env.BV_DEMO_MODE ?? 'standalone';
  process.env.BV_CORS_ORIGINS = process.env.BV_CORS_ORIGINS ?? 'http://localhost:3000';
};

const clearModuleFromCache = (moduleRelativePath: string): void => {
  const absolutePath = resolvePath(moduleRelativePath);
  try {
    const resolved = localRequire.resolve(absolutePath);
    delete localRequire.cache[resolved];
  } catch {
    // Ignore cache misses.
  }
};

const parseJsonMessages = (frames: readonly (string | Buffer)[]): IJsonMessage[] => {
  return frames
    .filter((frame): frame is string => typeof frame === 'string')
    .map((frame) => {
      try {
        return JSON.parse(frame) as IJsonMessage;
      } catch {
        return {};
      }
    });
};

const readId = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const testFileStructure = async (): Promise<void> => {
  for (const relativePath of REQUIRED_FILES) {
    try {
      await access(resolvePath(relativePath), constants.F_OK);
      report('pass', 1, `File exists: ${relativePath}`, 'Found');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown file access error';
      report('fail', 1, `File exists: ${relativePath}`, message);
    }
  }
};

const testConfiguration = async (): Promise<void> => {
  try {
    const packageJson = JSON.parse(await readFile(resolvePath('package.json'), 'utf8')) as {
      readonly scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const requiredScripts = ['dev:demo', 'start:demo', 'test:demo'];
    const missing = requiredScripts.filter((scriptName) => !scripts[scriptName]);
    if (missing.length === 0) {
      report('pass', 2, 'package.json demo scripts', 'All required scripts are present');
    } else {
      report('fail', 2, 'package.json demo scripts', `Missing script(s): ${missing.join(', ')}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown package.json read error';
    report('fail', 2, 'package.json demo scripts', message);
  }

  try {
    const envExample = await readFile(resolvePath('.env.example'), 'utf8');
    const hasDemoPort = envExample.includes('BV_DEMO_PORT');
    const hasSarvamKey = envExample.includes('BV_SARVAM_API_KEY');
    if (hasDemoPort && hasSarvamKey) {
      report('pass', 2, '.env.example demo variables', 'BV_DEMO_PORT and BV_SARVAM_API_KEY found');
    } else {
      const missing: string[] = [];
      if (!hasDemoPort) {
        missing.push('BV_DEMO_PORT');
      }
      if (!hasSarvamKey) {
        missing.push('BV_SARVAM_API_KEY');
      }
      report('fail', 2, '.env.example demo variables', `Missing variable(s): ${missing.join(', ')}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown .env.example read error';
    report('fail', 2, '.env.example demo variables', message);
  }

  try {
    const tsConfig = JSON.parse(await readFile(resolvePath('tsconfig.json'), 'utf8')) as {
      readonly include?: readonly string[];
    };
    const include = tsConfig.include ?? [];
    const hasWebDemoInclude = include.some((entry) => {
      return entry.includes('src/modes/web-demo') || entry === 'src/**/*.ts';
    });
    if (hasWebDemoInclude) {
      report('pass', 2, 'tsconfig web-demo include', 'web-demo sources are covered by include patterns');
    } else {
      report('fail', 2, 'tsconfig web-demo include', 'No include pattern covers src/modes/web-demo');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown tsconfig read error';
    report('fail', 2, 'tsconfig web-demo include', message);
  }
};

const testServerStartup = async (): Promise<void> => {
  setRequiredEnv();
  process.env.BV_DEMO_MODE = 'disabled';

  clearModuleFromCache('src/config/index.ts');
  clearModuleFromCache('src/modes/web-demo/config.ts');
  clearModuleFromCache('src/modes/web-demo/server.ts');
  try {
    localRequire(resolvePath('src/modes/web-demo/server.ts'));
    report('pass', 3, 'Server module import', 'Imported without runtime exceptions');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown import error';
    report('fail', 3, 'Server module import', message);
  }

  try {
    const source = await readFile(resolvePath('src/modes/web-demo/server.ts'), 'utf8');
    const hasExpressInit = source.includes('const app = express()');
    if (hasExpressInit) {
      report('pass', 3, 'Express initialization', 'Express app initialization found');
    } else {
      report('fail', 3, 'Express initialization', 'Could not find Express app initialization');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown server source read error';
    report('fail', 3, 'Express initialization', message);
  }

  try {
    const source = await readFile(resolvePath('src/modes/web-demo/server.ts'), 'utf8');
    const hasWsServer = source.includes('new WebSocketServer({ noServer: true })');
    const hasUpgradeHandler = source.includes("httpServer.on('upgrade'");
    if (hasWsServer && hasUpgradeHandler) {
      report('pass', 3, 'WebSocket attachment', 'WebSocket server and upgrade handler configured');
    } else {
      report('fail', 3, 'WebSocket attachment', 'WebSocket attach logic missing or incomplete');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown websocket source read error';
    report('fail', 3, 'WebSocket attachment', message);
  }

  try {
    delete process.env.BV_DEMO_WS_PORT;
    clearModuleFromCache('src/config/index.ts');
    clearModuleFromCache('src/modes/web-demo/config.ts');
    const configModule = localRequire(resolvePath('src/modes/web-demo/config.ts')) as {
      readonly webDemoConfig: { readonly port: number };
    };
    if (configModule.webDemoConfig.port === 3001) {
      report('pass', 3, 'Default demo port', 'Default port resolved to 3001');
    } else {
      report('fail', 3, 'Default demo port', `Expected 3001, got ${configModule.webDemoConfig.port}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown demo config import error';
    report('fail', 3, 'Default demo port', message);
  }
};

const testMockWebSocketFlow = async (): Promise<void> => {
  setRequiredEnv();
  process.env.BV_DEMO_MODE = 'standalone';
  process.env.BV_DEMO_WS_PORT = '3001';

  const sessionStore = new WebDemoSessionStore({ sessionCleanupIntervalMinutes: 60 });
  const errorManager = new WebDemoErrorManager();
  const handler = createVoiceWebSocketHandler({
    coreService: {
      synthesizeFromContext: () =>
        Promise.resolve({
        text: 'Aapne kaha: Hello',
        audio: Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]),
        voice: 'meera',
        voiceId: 'bv-meera-bulbul-v3'
        })
    } as never,
    sessionStore,
    errorManager,
    analytics: {
      trackDemoStarted: () => Promise.resolve(),
      trackMessageSent: () => Promise.resolve(),
      trackMessageReceived: () => Promise.resolve(),
      trackError: () => Promise.resolve(),
      trackDemoCompleted: () => Promise.resolve(),
      trackConversionClicked: () => Promise.resolve()
    } as never
  });

  const socket = new MockSocket();
  const request = {
    url: '/ws/voice?vertical=dental',
    headers: {
      host: 'localhost:3001',
      'user-agent': 'self-test'
    },
    socket: {
      remoteAddress: '127.0.0.1'
    }
  };
  handler(socket as never, request as never);

  await delay(20);
  const firstMessages = parseJsonMessages(socket.sentFrames);
  const sessionMessage = firstMessages.find((message) => message.type === 'session');
  const sessionId = readId(sessionMessage?.sessionId);
  if (sessionId) {
    report('pass', 4, 'WebSocket client connection', `Session created: ${sessionId}`);
  } else {
    report('fail', 4, 'WebSocket client connection', 'No session message returned');
    return;
  }

  socket.emitJson({ type: 'init', vertical: 'dental' });
  await delay(30);
  const initMessage = parseJsonMessages(socket.sentFrames).find((message) => message.type === 'init');
  if (typeof initMessage?.greeting === 'string' && initMessage.greeting.length > 0) {
    report('pass', 4, 'Init greeting response', 'Greeting returned from vertical handler');
  } else {
    report('fail', 4, 'Init greeting response', 'Greeting was not returned for init message');
  }

  socket.emitJson({ type: 'transcript', text: 'Hello', sessionId });
  await delay(60);
  const jsonMessages = parseJsonMessages(socket.sentFrames);
  const responseMessage = jsonMessages.find((message) => message.type === 'response');
  const audioStart = jsonMessages.find((message) => message.type === 'audio_start');
  if (responseMessage && audioStart) {
    report(
      'pass',
      4,
      'Transcript response with audio',
      `Received response and streaming audio metadata (streamId=${String(responseMessage.streamId)})`
    );
  } else {
    report('fail', 4, 'Transcript response with audio', 'Missing response or audio streaming metadata');
  }

  const storedSession = sessionStore.getSession(sessionId);
  if (storedSession) {
    report('pass', 4, 'Session persistence', `Session retrieved for ${storedSession.sessionId}`);
  } else {
    report('fail', 4, 'Session persistence', 'Session not found after websocket flow');
  }

  if (storedSession && storedSession.conversationHistory.length >= 2) {
    report(
      'pass',
      4,
      'Conversation history update',
      `History contains ${storedSession.conversationHistory.length} turn(s)`
    );
  } else {
    report('fail', 4, 'Conversation history update', 'Conversation history not updated as expected');
  }
};

const testVerticalRouting = (): void => {
  const dental = new DentalVertical();
  const auto = new AutoVertical();
  const legal = new LegalVertical();

  const dentalGreeting = dental.getGreeting().toLowerCase();
  if (/dental|daant|swagat/.test(dentalGreeting)) {
    report('pass', 5, 'Dental greeting quality', dental.getGreeting());
  } else {
    report('fail', 5, 'Dental greeting quality', `Unexpected greeting: ${dental.getGreeting()}`);
  }

  const autoGreeting = auto.getGreeting().toLowerCase();
  if (/gaadi|car|service|auto/.test(autoGreeting)) {
    report('pass', 5, 'Auto greeting quality', auto.getGreeting());
  } else {
    report('fail', 5, 'Auto greeting quality', `Unexpected greeting: ${auto.getGreeting()}`);
  }

  const legalGreeting = legal.getGreeting().toLowerCase();
  if (/case|legal|court|nyaya/.test(legalGreeting)) {
    report('pass', 5, 'Legal greeting quality', legal.getGreeting());
  } else {
    report('fail', 5, 'Legal greeting quality', `Unexpected greeting: ${legal.getGreeting()}`);
  }

  const factoryDental = createVerticalService('dental');
  const factoryAuto = createVerticalService('auto');
  const factoryLegal = createVerticalService('legal');

  const correctFactory =
    factoryDental instanceof DentalVertical &&
    factoryAuto instanceof AutoVertical &&
    factoryLegal instanceof LegalVertical;
  if (correctFactory) {
    report('pass', 5, 'Vertical factory mapping', 'Factory returns expected instances');
  } else {
    report('fail', 5, 'Vertical factory mapping', 'Factory did not map all verticals correctly');
  }
};

const testErrorHandling = async (): Promise<void> => {
  setRequiredEnv();
  const sessionStore = new WebDemoSessionStore({ sessionCleanupIntervalMinutes: 60 });
  const errorManager = new WebDemoErrorManager();
  const handler = createVoiceWebSocketHandler({
    coreService: {
      synthesizeFromContext: () =>
        Promise.resolve({
        text: 'Aapne kaha: Hello',
        audio: Buffer.from([82, 73, 70, 70, 1]),
        voice: 'meera',
        voiceId: 'bv-meera-bulbul-v3'
        })
    } as never,
    sessionStore,
    errorManager,
    analytics: {
      trackDemoStarted: () => Promise.resolve(),
      trackMessageSent: () => Promise.resolve(),
      trackMessageReceived: () => Promise.resolve(),
      trackError: () => Promise.resolve(),
      trackDemoCompleted: () => Promise.resolve(),
      trackConversionClicked: () => Promise.resolve()
    } as never
  });
  const socket = new MockSocket();
  const request = {
    url: '/ws/voice?vertical=dental',
    headers: {
      host: 'localhost:3001'
    },
    socket: {
      remoteAddress: '127.0.0.1'
    }
  };
  handler(socket as never, request as never);
  await delay(20);

  socket.emitRaw('{invalid');
  await delay(20);
  const invalidJsonError = parseJsonMessages(socket.sentFrames).find((message) => {
    return message.type === 'error' && String(message.message).includes('Invalid JSON');
  });
  if (invalidJsonError) {
    report('pass', 6, 'Invalid JSON handling', 'Invalid JSON payload returns explicit error');
  } else {
    report('fail', 6, 'Invalid JSON handling', 'Did not receive Invalid JSON error response');
  }

  socket.emitJson({ type: 'init' });
  await delay(20);
  const missingVerticalError = parseJsonMessages(socket.sentFrames).find((message) => {
    return message.type === 'error' && String(message.message).includes('Expected payload');
  });
  if (missingVerticalError) {
    report('pass', 6, 'Missing vertical in init', 'Invalid init payload rejected with schema guidance');
  } else {
    report('fail', 6, 'Missing vertical in init', 'Missing vertical did not trigger payload validation error');
  }

  socket.emitJson({ type: 'transcript', sessionId: 'missing-session-id', text: 'Hello' });
  await delay(30);
  const recovered = parseJsonMessages(socket.sentFrames).find((message) => {
    return message.type === 'session_recovered';
  });
  if (recovered) {
    report('pass', 6, 'Session not found recovery', 'Session recovery response emitted');
  } else {
    report('fail', 6, 'Session not found recovery', 'Session recovery flow not triggered');
  }

  const genericMessage = errorManager.getUserMessage('GENERIC_RETRY');
  if (/Kripya|koshish/i.test(genericMessage)) {
    report('pass', 6, 'User-friendly Hinglish errors', genericMessage);
  } else {
    report('fail', 6, 'User-friendly Hinglish errors', `Unexpected generic error copy: ${genericMessage}`);
  }
};

const testSarvamIntegration = async (): Promise<void> => {
  const apiKey = process.env.BV_SARVAM_API_KEY ?? '';
  if (!apiKey || apiKey === 'test-sarvam-key') {
    report('skip', 7, 'Sarvam live TTS integration', 'No real BV_SARVAM_API_KEY found');
    return;
  }

  try {
    const voiceService = new VoiceService();
    const audio = await voiceService.synthesizeSpeech('Namaste, yeh self test hai', 'meera');
    const riffHeader = audio.subarray(0, 4).toString('ascii');
    if (audio.length > 0 && riffHeader === 'RIFF') {
      report('pass', 7, 'Sarvam live TTS integration', `Audio generated (${audio.length} bytes, header=${riffHeader})`);
    } else {
      report('fail', 7, 'Sarvam live TTS integration', `Unexpected audio output format (header=${riffHeader})`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown Sarvam test error';
    report('fail', 7, 'Sarvam live TTS integration', message);
  }
};

const startDemoServer = async (port: number): Promise<IServerHandle> => {
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['-r', 'ts-node/register', 'src/modes/web-demo/server.ts'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      BV_SARVAM_API_KEY: process.env.BV_SARVAM_API_KEY ?? 'test-sarvam-key',
      BV_EXOTEL_SID: process.env.BV_EXOTEL_SID ?? 'test-exotel-sid',
      BV_EXOTEL_TOKEN: process.env.BV_EXOTEL_TOKEN ?? 'test-exotel-token',
      BV_DATABASE_URL:
        process.env.BV_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/bharatvoice',
      BV_LOG_LEVEL: 'error',
      BV_DEMO_MODE: 'standalone',
      BV_DEMO_WS_PORT: String(port),
      BV_CORS_ORIGINS: 'http://localhost:3000'
    },
    stdio: 'pipe'
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  let ready = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/health/demo`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(100);
  }

  if (!ready) {
    child.kill('SIGTERM');
    throw new Error(
      `Demo server failed to start on port ${port}. stdout=${stdout.slice(-300)} stderr=${stderr.slice(-300)}`
    );
  }

  return {
    process: child,
    port,
    stop: async (): Promise<void> => {
      if (child.killed) {
        return;
      }
      child.kill('SIGTERM');
      await delay(200);
    }
  };
};

const testStaticAssetsAndCors = async (): Promise<void> => {
  const port = 3901;
  let serverHandle: IServerHandle | null = null;
  try {
    serverHandle = await startDemoServer(port);

    const htmlResponse = await fetch(`http://localhost:${port}/demo/`);
    if (htmlResponse.status === 200) {
      report('pass', 8, 'Static index.html availability', 'GET /demo/ returned 200');
    } else {
      report('fail', 8, 'Static index.html availability', `Expected 200, got ${htmlResponse.status}`);
    }

    const jsResponse = await fetch(`http://localhost:${port}/demo/demo.js`);
    if (jsResponse.status === 200) {
      report('pass', 8, 'Static demo.js availability', 'GET /demo/demo.js returned 200');
    } else {
      report('fail', 8, 'Static demo.js availability', `Expected 200, got ${jsResponse.status}`);
    }

    const corsResponse = await fetch(`http://localhost:${port}/demo/`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET'
      }
    });
    const allowOrigin = corsResponse.headers.get('access-control-allow-origin') ?? '';
    if (corsResponse.status === 204 && allowOrigin === 'http://localhost:3000') {
      report('pass', 8, 'CORS headers', 'OPTIONS /demo/ returned expected CORS headers');
    } else {
      report(
        'fail',
        8,
        'CORS headers',
        `Unexpected CORS response (status=${corsResponse.status}, allow-origin=${allowOrigin})`
      );
    }

    const wsMessage = await new Promise<IJsonMessage>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/voice?vertical=dental`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for websocket session message'));
      }, 2000);

      ws.on('message', (data) => {
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : typeof data === 'string'
              ? data
              : Buffer.from(data).toString('utf8');
        try {
          const payload = JSON.parse(text) as IJsonMessage;
          if (payload.type === 'session') {
            clearTimeout(timer);
            ws.close();
            resolve(payload);
          }
        } catch {
          // Ignore non-JSON frames.
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const runtimeSessionId = readId(wsMessage.sessionId);
    if (runtimeSessionId) {
      report('pass', 8, 'WebSocket upgrade runtime check', `Session established: ${runtimeSessionId}`);
    } else {
      report('fail', 8, 'WebSocket upgrade runtime check', 'WebSocket connected but no session payload');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown static asset test error';
    report('fail', 8, 'Static assets and CORS suite', message);
  } finally {
    await serverHandle?.stop();
  }
};

const printSummary = (): void => {
  const total = results.length;
  const passed = results.filter((result) => result.status === 'pass').length;
  const failed = results.filter((result) => result.status === 'fail').length;
  const skipped = results.filter((result) => result.status === 'skip').length;

  console.log('');
  console.log(`Total tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);

  const criticalFailed = results.some((result) => result.status === 'fail' && result.category <= 3);
  if (criticalFailed) {
    console.log('🚨 CRITICAL: Demo mode not functional');
    return;
  }

  if (failed > 0) {
    console.log('⚠️  PARTIAL: Demo works with limitations');
    return;
  }

  console.log('✅ FULLY OPERATIONAL: Demo mode ready');
};

const main = async (): Promise<void> => {
  await testFileStructure();
  await testConfiguration();
  await testServerStartup();
  await testMockWebSocketFlow();
  testVerticalRouting();
  await testErrorHandling();
  await testSarvamIntegration();
  await testStaticAssetsAndCors();
  printSummary();
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown self-test runtime error';
  console.error(`❌ FAIL: self-test runtime - ${message}`);
  process.exitCode = 1;
});
