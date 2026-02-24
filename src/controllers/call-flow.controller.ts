import type { Request, Response } from 'express';

import { CallFlowService } from '../services/call-flow.service';
import { logger } from '../utils/logger';

export interface ICallFlowController {
  handleCallStartWebhook: (req: Request, res: Response) => void;
  handleRecordingCallbackWebhook: (req: Request, res: Response) => Promise<void>;
  handlePlaybackAudioRequest: (req: Request, res: Response) => void;
}

interface ICallFlowControllerDependencies {
  readonly callFlowService?: CallFlowService;
}

const buildAbsoluteUrl = (req: Request, path: string): string => {
  const protocolHeader = req.headers['x-forwarded-proto'];
  const protocol = typeof protocolHeader === 'string' ? protocolHeader.split(',')[0] : req.protocol;
  const host = req.get('host');

  if (!host) {
    throw new Error('Unable to determine host for Exotel callback URL generation.');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${host}${normalizedPath}`;
};

export const createCallFlowController = (
  dependencies?: ICallFlowControllerDependencies
): ICallFlowController => {
  const callFlowService = dependencies?.callFlowService ?? new CallFlowService();

  const handleCallStartWebhook = (req: Request, res: Response): void => {
    try {
      const recordingActionUrl = buildAbsoluteUrl(req, '/webhook/call-recording');
      const result = callFlowService.startEchoBotCall({
        payload: req.body,
        recordingActionUrl
      });

      res.status(200).type(result.exotelResponse.contentType).send(result.exotelResponse.body);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown call start error';

      logger.warn('Invalid call start webhook payload', {
        eventType: 'call_flow.start.invalid_payload',
        provider: 'exotel',
        error: errorMessage,
        exotelPayload: req.body
      });

      res.status(400).json({
        error: 'Invalid Exotel call start payload',
        message: errorMessage
      });
    }
  };

  const handleRecordingCallbackWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const playbackBaseUrl = buildAbsoluteUrl(req, '/media/call-audio');
      const result = await callFlowService.handleRecordingAndGeneratePlayback({
        payload: req.body,
        playbackBaseUrl
      });

      res.status(200).type(result.exotelResponse.contentType).send(result.exotelResponse.body);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown recording callback error';
      const isPayloadError = errorMessage.toLowerCase().includes('invalid exotel recording payload');

      logger.error('Call recording callback handling failed', {
        eventType: 'call_flow.recording.error',
        provider: 'exotel',
        error: errorMessage,
        exotelPayload: req.body
      });

      res.status(isPayloadError ? 400 : 500).json({
        error: isPayloadError
          ? 'Invalid Exotel call recording payload'
          : 'Failed to process call recording callback',
        message: errorMessage
      });
    }
  };

  const handlePlaybackAudioRequest = (req: Request, res: Response): void => {
    const audioId = typeof req.params.audioId === 'string' ? req.params.audioId : '';
    const playbackAudio = callFlowService.getPlaybackAudio(audioId);

    if (!playbackAudio) {
      res.status(404).json({
        error: 'Audio not found'
      });
      return;
    }

    res
      .status(200)
      .type(playbackAudio.contentType)
      .setHeader('Cache-Control', 'private, max-age=60')
      .setHeader('X-BharatVoice-CallSid', playbackAudio.callSid)
      .send(playbackAudio.audio);
  };

  return {
    handleCallStartWebhook,
    handleRecordingCallbackWebhook,
    handlePlaybackAudioRequest
  };
};

const defaultCallFlowController = createCallFlowController();

export const handleCallStartWebhook = defaultCallFlowController.handleCallStartWebhook;
export const handleRecordingCallbackWebhook = defaultCallFlowController.handleRecordingCallbackWebhook;
export const handlePlaybackAudioRequest = defaultCallFlowController.handlePlaybackAudioRequest;
