import { EventEmitter } from 'events';

type IWsOutbound = string | Buffer;

interface ISentFrame {
  readonly data: IWsOutbound;
  readonly binary: boolean;
}

export class MockWebSocket extends EventEmitter {
  public readonly sentFrames: ISentFrame[] = [];

  public send(data: IWsOutbound, options?: { readonly binary?: boolean }): void {
    const isBinary = options?.binary === true || Buffer.isBuffer(data);
    this.sentFrames.push({
      data,
      binary: isBinary
    });
  }

  public emitJson(payload: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(payload), 'utf8'));
  }

  public emitRaw(value: string): void {
    this.emit('message', Buffer.from(value, 'utf8'));
  }

  public emitClose(): void {
    this.emit('close');
  }

  public emitError(error: Error): void {
    this.emit('error', error);
  }
}

export const createMockWebSocket = (): MockWebSocket => {
  return new MockWebSocket();
};

export const getJsonMessages = (socket: MockWebSocket): Record<string, unknown>[] => {
  return socket.sentFrames
    .filter((frame) => typeof frame.data === 'string')
    .map((frame) => {
      try {
        return JSON.parse(frame.data as string) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
};

export const waitForMessage = async (
  socket: MockWebSocket,
  type: string,
  timeoutMs = 1000
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const matched = getJsonMessages(socket).find((message) => message.type === type);
    if (matched) {
      return matched;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Timed out waiting for websocket message type "${type}"`);
};

export const generateTestAudio = (length = 2048): Buffer => {
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = index % 251;
  }
  return bytes;
};

export const getBinaryFrames = (socket: MockWebSocket): Buffer[] => {
  return socket.sentFrames
    .filter((frame) => frame.binary)
    .map((frame) => (Buffer.isBuffer(frame.data) ? frame.data : Buffer.from(frame.data, 'utf8')));
};
