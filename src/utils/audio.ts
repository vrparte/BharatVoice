export interface IAudioDownloadResult {
  readonly blob: Blob;
  readonly contentType: string;
  readonly fileName: string;
}

const AUDIO_CONTENT_TYPE_TO_EXTENSION: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/amr': 'amr'
};

const sanitizeFileName = (fileName: string): string => {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const extractFileNameFromUrl = (audioUrl: string): string | undefined => {
  try {
    const url = new URL(audioUrl);
    const pathnameSegments = url.pathname.split('/').filter((segment) => segment.length > 0);
    const lastSegment = pathnameSegments.at(-1);

    if (!lastSegment) {
      return undefined;
    }

    const decoded = decodeURIComponent(lastSegment);
    return decoded.trim().length > 0 ? sanitizeFileName(decoded) : undefined;
  } catch {
    return undefined;
  }
};

export const resolveAudioFileName = (audioUrl: string, contentType: string): string => {
  const fileNameFromUrl = extractFileNameFromUrl(audioUrl);

  if (fileNameFromUrl) {
    return fileNameFromUrl;
  }

  const extension = AUDIO_CONTENT_TYPE_TO_EXTENSION[contentType.toLowerCase()] ?? 'wav';
  return `audio-input.${extension}`;
};

export const isHttpAudioUrl = (audioUrl: string): boolean => {
  try {
    const url = new URL(audioUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const downloadAudioFromUrl = async (
  audioUrl: string,
  fetchFn: typeof fetch
): Promise<IAudioDownloadResult> => {
  const response = await fetchFn(audioUrl, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`Failed to download audio from URL: HTTP ${response.status}.`);
  }

  const responseBlob = await response.blob();
  const contentType = response.headers.get('content-type') ?? responseBlob.type ?? 'audio/wav';
  const normalizedBlob = responseBlob.type ? responseBlob : responseBlob.slice(0, responseBlob.size, contentType);

  return {
    blob: normalizedBlob,
    contentType,
    fileName: resolveAudioFileName(audioUrl, contentType)
  };
};
