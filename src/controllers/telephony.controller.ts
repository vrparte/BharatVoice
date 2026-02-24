import type { Request, Response } from 'express';

import { handleCallStartWebhook } from './call-flow.controller';
import { ExotelService } from '../services/exotel.service';
import { logger } from '../utils/logger';

const exotelService = new ExotelService();
const INCOMING_CALL_ACK_MESSAGE = 'Hello, your call is received';

const prefersJsonResponse = (req: Request): boolean => {
  const formatQuery = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : undefined;

  if (formatQuery === 'json') {
    return true;
  }

  const acceptHeader = req.headers.accept;
  return typeof acceptHeader === 'string' && acceptHeader.includes('application/json');
};

export const handleIncomingCallWebhook = (req: Request, res: Response): void => {
  // Legacy route alias; new call-start flow lives in call-flow.controller.ts
  handleCallStartWebhook(req, res);
};

export const handleIncomingCallWebhookLegacy = (req: Request, res: Response): void => {
  try {
    const incomingCall = exotelService.parseIncomingCallWebhook(req.body);
    const payload = exotelService.asExotelPayload(req.body);

    logger.info('Exotel incoming call received', {
      eventType: 'telephony.call.started',
      provider: 'exotel',
      callSid: incomingCall.callSid,
      from: incomingCall.from,
      to: incomingCall.to,
      direction: incomingCall.direction,
      rawDirection: incomingCall.rawDirection,
      exotelPayload: payload
    });

    if (prefersJsonResponse(req)) {
      res.status(200).json({
        provider: 'exotel',
        message: INCOMING_CALL_ACK_MESSAGE,
        callSid: incomingCall.callSid
      });
      return;
    }

    const exotelVoiceResponse = exotelService.buildSayResponse(INCOMING_CALL_ACK_MESSAGE);
    res.status(200).type(exotelVoiceResponse.contentType).send(exotelVoiceResponse.body);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Exotel incoming call error';

    logger.warn('Invalid Exotel incoming call webhook payload', {
      eventType: 'telephony.call.invalid_payload',
      provider: 'exotel',
      error: errorMessage,
      exotelPayload: req.body
    });

    res.status(400).json({
      error: 'Invalid Exotel incoming call payload',
      message: errorMessage
    });
  }
};

export const handleCallStatusCallback = (req: Request, res: Response): void => {
  try {
    const callStatusEvent = exotelService.parseCallStatusWebhook(req.body);

    logger.info('Exotel call status callback received', {
      eventType: 'telephony.call.status',
      provider: 'exotel',
      callSid: callStatusEvent.callSid,
      status: callStatusEvent.status,
      rawStatus: callStatusEvent.rawStatus,
      from: callStatusEvent.from,
      to: callStatusEvent.to,
      direction: callStatusEvent.direction,
      statusCallbackEvent: callStatusEvent.statusCallbackEvent,
      exotelPayload: req.body
    });

    res.status(200).json({
      ok: true,
      provider: 'exotel',
      callSid: callStatusEvent.callSid,
      status: callStatusEvent.status
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Exotel status callback error';

    logger.warn('Invalid Exotel call status callback payload', {
      eventType: 'telephony.call.status_invalid_payload',
      provider: 'exotel',
      error: errorMessage,
      exotelPayload: req.body
    });

    res.status(400).json({
      error: 'Invalid Exotel call status callback payload',
      message: errorMessage
    });
  }
};
