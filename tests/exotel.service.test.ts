import { ExotelService } from '../src/services/exotel.service';

describe('ExotelService', () => {
  const exotelService = new ExotelService();

  it('parses incoming call payload with required fields', () => {
    const result = exotelService.parseIncomingCallWebhook({
      CallSid: 'e8f4c8f7d4f6451f9d4',
      From: '+919876543210',
      To: '+918888777766',
      Direction: 'incoming'
    });

    expect(result).toEqual({
      callSid: 'e8f4c8f7d4f6451f9d4',
      from: '+919876543210',
      to: '+918888777766',
      direction: 'incoming',
      rawDirection: 'incoming'
    });
  });

  it('throws a descriptive error for missing incoming call fields', () => {
    expect(() =>
      exotelService.parseIncomingCallWebhook({
        From: '+919876543210',
        To: '+918888777766'
      })
    ).toThrow('missing required field(s): CallSid, Direction');
  });

  it('builds ExoML XML response for a say message', () => {
    const response = exotelService.buildSayResponse('Hello & welcome');

    expect(response.contentType).toBe('application/xml');
    expect(response.body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(response.body).toContain('<Response><Say>Hello &amp; welcome</Say></Response>');
  });

  it('normalizes call status callbacks', () => {
    const statusEvent = exotelService.parseCallStatusWebhook({
      CallSid: 'call-123',
      CallStatus: 'COMPLETED',
      From: '+919876543210',
      To: '+918888777766',
      Direction: 'incoming',
      StatusCallbackEvent: 'terminal'
    });

    expect(statusEvent).toEqual({
      callSid: 'call-123',
      status: 'completed',
      rawStatus: 'COMPLETED',
      from: '+919876543210',
      to: '+918888777766',
      direction: 'incoming',
      statusCallbackEvent: 'terminal'
    });
  });

  it('parses recording callback payload and extracts recording URL', () => {
    const recordingEvent = exotelService.parseRecordingWebhook({
      CallSid: 'call-rec-1',
      RecordingUrl: 'https://api.exotel.com/recordings/call-rec-1.wav',
      From: '+919876543210',
      To: '+918888777766',
      Direction: 'incoming'
    });

    expect(recordingEvent).toEqual({
      callSid: 'call-rec-1',
      recordingUrl: 'https://api.exotel.com/recordings/call-rec-1.wav',
      from: '+919876543210',
      to: '+918888777766',
      direction: 'incoming'
    });
  });

  it('builds ExoML record and play responses', () => {
    const recordResponse = exotelService.buildRecordResponse({
      prompt: 'Kripya boliye',
      actionUrl: 'https://example.com/webhook/call-recording'
    });
    const playResponse = exotelService.buildPlayAndHangupResponse('https://example.com/media/call-audio/123');

    expect(recordResponse.contentType).toBe('application/xml');
    expect(recordResponse.body).toContain('<Record action="https://example.com/webhook/call-recording"');
    expect(recordResponse.body).toContain('<Say>Kripya boliye</Say>');
    expect(playResponse.body).toContain('<Play>https://example.com/media/call-audio/123</Play>');
    expect(playResponse.body).toContain('<Hangup />');
  });
});
