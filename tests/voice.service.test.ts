import { VoiceService } from '../src/services/voice.service';
import type { ISarvamTtsVoice } from '../src/types/sarvam.types';

interface ISarvamServiceLike {
  synthesizeSpeech(text: string, voice: ISarvamTtsVoice): Promise<Buffer>;
}

describe('VoiceService', () => {
  it('caches frequent TTS responses to reduce API calls', async () => {
    const sarvamServiceMock: ISarvamServiceLike = {
      synthesizeSpeech: jest
        .fn<Promise<Buffer>, [string, ISarvamTtsVoice]>()
        .mockResolvedValue(Buffer.from([1, 2, 3, 4]))
    };
    const nowFn = jest
      .fn<number, []>()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1005)
      .mockReturnValueOnce(1010);

    const voiceService = new VoiceService({
      sarvamService: sarvamServiceMock as unknown as never,
      nowFn
    });

    const firstResult = await voiceService.synthesizeSpeech('Hello ji', 'meera');
    const secondResult = await voiceService.synthesizeSpeech('Hello ji', 'meera');

    expect(firstResult.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(secondResult.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(secondResult).not.toBe(firstResult);
    expect(sarvamServiceMock.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(sarvamServiceMock.synthesizeSpeech).toHaveBeenCalledWith('Hello ji', 'meera');
    expect(voiceService.getVoiceId('meera')).toBe('bv-meera-bulbul-v3');
    expect(voiceService.getAudioContentType()).toBe('audio/wav');
  });
});
