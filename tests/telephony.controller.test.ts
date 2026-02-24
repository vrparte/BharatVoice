import type { Request, Response } from 'express';

import {
  handleCallStatusCallback,
  handleIncomingCallWebhookLegacy
} from '../src/controllers/telephony.controller';
import { logger } from '../src/utils/logger';

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

interface IMockResponse {
  readonly res: Response;
  readonly statusMock: jest.Mock;
  readonly jsonMock: jest.Mock;
  readonly sendMock: jest.Mock;
  readonly typeMock: jest.Mock;
}

const createMockResponse = (): IMockResponse => {
  const statusMock = jest.fn();
  const jsonMock = jest.fn();
  const sendMock = jest.fn();
  const typeMock = jest.fn();

  const response = {
    status: statusMock,
    json: jsonMock,
    send: sendMock,
    type: typeMock
  } as unknown as Response;

  statusMock.mockReturnValue(response);
  jsonMock.mockReturnValue(response);
  sendMock.mockReturnValue(response);
  typeMock.mockReturnValue(response);

  return {
    res: response,
    statusMock,
    jsonMock,
    sendMock,
    typeMock
  };
};

const createMockRequest = (
  body: Record<string, unknown>,
  extras?: Partial<Pick<Request, 'headers' | 'query'>>
): Request => {
  return {
    body,
    headers: extras?.headers ?? {},
    query: extras?.query ?? {}
  } as unknown as Request;
};

describe('telephony.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ExoML XML for incoming Exotel webhook and logs call start', () => {
    const req = createMockRequest({
      CallSid: 'call-001',
      From: '+919999000001',
      To: '+918888777766',
      Direction: 'incoming'
    });
    const { res, statusMock, typeMock, sendMock, jsonMock } = createMockResponse();

    handleIncomingCallWebhookLegacy(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(typeMock).toHaveBeenCalledWith('application/xml');
    expect(sendMock).toHaveBeenCalledWith(
      expect.stringContaining('<Response><Say>Hello, your call is received</Say></Response>')
    );
    expect(jsonMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Exotel incoming call received',
      expect.objectContaining({
        eventType: 'telephony.call.started',
        callSid: 'call-001',
        from: '+919999000001',
        to: '+918888777766',
        direction: 'incoming'
      })
    );
  });

  it('returns JSON when explicitly requested for incoming webhook', () => {
    const req = createMockRequest(
      {
        CallSid: 'call-002',
        From: '+919999000002',
        To: '+918888777766',
        Direction: 'incoming'
      },
      {
        headers: { accept: 'application/json' }
      }
    );
    const { res, statusMock, jsonMock, sendMock } = createMockResponse();

    handleIncomingCallWebhookLegacy(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'exotel',
        message: 'Hello, your call is received',
        callSid: 'call-002'
      })
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid incoming webhook payload', () => {
    const req = createMockRequest({
      CallSid: 'call-003',
      From: '+919999000003'
    });
    const { res, statusMock, jsonMock } = createMockResponse();

    handleIncomingCallWebhookLegacy(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Invalid Exotel incoming call payload'
      })
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('handles status callback payloads and logs terminal status', () => {
    const req = createMockRequest({
      CallSid: 'call-004',
      CallStatus: 'failed',
      From: '+919999000004',
      To: '+918888777766',
      Direction: 'incoming',
      StatusCallbackEvent: 'terminal'
    });
    const { res, statusMock, jsonMock } = createMockResponse();

    handleCallStatusCallback(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      ok: true,
      provider: 'exotel',
      callSid: 'call-004',
      status: 'failed'
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Exotel call status callback received',
      expect.objectContaining({
        eventType: 'telephony.call.status',
        callSid: 'call-004',
        status: 'failed',
        statusCallbackEvent: 'terminal'
      })
    );
  });
});
