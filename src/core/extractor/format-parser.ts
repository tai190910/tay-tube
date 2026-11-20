import { isHdrFormat } from './hdr-formats.js';

export interface StreamRange {
  start: string;
  end: string;
}

export interface VideoStreamFormat {
  itag: number;
  url: string;
  mimeType: string;
  container: 'mp4' | 'webm' | 'unknown';
  codec: string;
  width: number;
  height: number;
  fps: number;
  quality: string;
  qualityLabel: string;
  bitrate: number;
  averageBitrate?: number;
  contentLength?: number;
  approxDurationMs?: number;
  initRange?: StreamRange;
  indexRange?: StreamRange;
  isHdr: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isMuxed: boolean;
}

export interface AudioStreamFormat {
  itag: number;
  url: string;
  mimeType: string;
  container: 'm4a' | 'webm' | 'mp4' | 'unknown';
  codec: string;
  bitrate: number;
  averageBitrate?: number;
  audioSampleRate?: string;
  audioChannels?: number;
  contentLength?: number;
  approxDurationMs?: number;
  initRange?: StreamRange;
  indexRange?: StreamRange;
  isOriginal?: boolean;
  language?: string;
}

export function parseStreamFormats(streamingData: any): {
  muxed: VideoStreamFormat[];
  videoOnly: VideoStreamFormat[];
  audioOnly: AudioStreamFormat[];
  allQualities: number[];
  hdrQualities: number[];
  hlsManifestUrl?: string;
} {
  if (!streamingData) {
    return {
      muxed: [],
      videoOnly: [],
      audioOnly: [],
      allQualities: [],
      hdrQualities: [],
    };
  }

  const hlsManifestUrl = streamingData.hlsManifestUrl || undefined;

  const rawMuxed = streamingData.formats || [];
  const rawAdaptive = streamingData.adaptiveFormats || [];

  const muxed: VideoStreamFormat[] = [];
  const videoOnly: VideoStreamFormat[] = [];
  const audioOnly: AudioStreamFormat[] = [];

  for (const raw of rawMuxed) {
    const stream = parseVideoFormat(raw, true);
    if (stream && stream.url) muxed.push(stream);
  }

  for (const raw of rawAdaptive) {
    const mime = (raw.mimeType || '').toLowerCase();
    if (mime.startsWith('video/')) {
      const stream = parseVideoFormat(raw, false);
      if (stream && stream.url) videoOnly.push(stream);
    } else if (mime.startsWith('audio/')) {
      const stream = parseAudioFormat(raw);
      if (stream && stream.url) audioOnly.push(stream);
    }
  }

  // Calculate unique sorted qualities
  const qualitySet = new Set<number>();
  const hdrQualitySet = new Set<number>();

  for (const v of [...videoOnly, ...muxed]) {
    if (v.height > 0) {
      qualitySet.add(v.height);
      if (v.isHdr) {
        hdrQualitySet.add(v.height);
      }
    }
  }

  const allQualities = Array.from(qualitySet).sort((a, b) => b - a);
  const hdrQualities = Array.from(hdrQualitySet).sort((a, b) => b - a);

  return {
    muxed,
    videoOnly,
    audioOnly,
    allQualities,
    hdrQualities,
    hlsManifestUrl,
  };
}

function parseVideoFormat(raw: any, isMuxed: boolean): VideoStreamFormat | null {
  const url = extractFormatUrl(raw);
  if (!url) return null;

  const mime = raw.mimeType || '';
  const codecMatch = mime.match(/codecs="([^"]+)"/);
  const codec = codecMatch ? codecMatch[1] : '';

  let container: 'mp4' | 'webm' | 'unknown' = 'unknown';
  if (mime.includes('mp4')) container = 'mp4';
  else if (mime.includes('webm')) container = 'webm';

  const height = Number(raw.height || 0);
  const width = Number(raw.width || 0);
  const fps = Number(raw.fps || 30);
  const isHdr = isHdrFormat(raw);

  return {
    itag: Number(raw.itag),
    url,
    mimeType: mime,
    container,
    codec,
    width,
    height,
    fps,
    quality: raw.quality || '',
    qualityLabel: raw.qualityLabel || `${height}p${fps > 30 ? fps : ''}${isHdr ? ' HDR' : ''}`,
    bitrate: Number(raw.bitrate || 0),
    averageBitrate: raw.averageBitrate ? Number(raw.averageBitrate) : undefined,
    contentLength: raw.contentLength ? Number(raw.contentLength) : undefined,
    approxDurationMs: raw.approxDurationMs ? Number(raw.approxDurationMs) : undefined,
    initRange: raw.initRange ? { start: String(raw.initRange.start), end: String(raw.initRange.end) } : undefined,
    indexRange: raw.indexRange ? { start: String(raw.indexRange.start), end: String(raw.indexRange.end) } : undefined,
    isHdr,
    isVideo: true,
    isAudio: isMuxed,
    isMuxed,
  };
}

function parseAudioFormat(raw: any): AudioStreamFormat | null {
  const url = extractFormatUrl(raw);
  if (!url) return null;

  const mime = raw.mimeType || '';
  const codecMatch = mime.match(/codecs="([^"]+)"/);
  const codec = codecMatch ? codecMatch[1] : '';

  let container: 'm4a' | 'webm' | 'mp4' | 'unknown' = 'unknown';
  if (mime.includes('mp4') || mime.includes('m4a')) container = 'm4a';
  else if (mime.includes('webm')) container = 'webm';

  return {
    itag: Number(raw.itag),
    url,
    mimeType: mime,
    container,
    codec,
    bitrate: Number(raw.bitrate || 0),
    averageBitrate: raw.averageBitrate ? Number(raw.averageBitrate) : undefined,
    audioSampleRate: raw.audioSampleRate,
    audioChannels: raw.audioChannels ? Number(raw.audioChannels) : undefined,
    contentLength: raw.contentLength ? Number(raw.contentLength) : undefined,
    approxDurationMs: raw.approxDurationMs ? Number(raw.approxDurationMs) : undefined,
    initRange: raw.initRange ? { start: String(raw.initRange.start), end: String(raw.initRange.end) } : undefined,
    indexRange: raw.indexRange ? { start: String(raw.indexRange.start), end: String(raw.indexRange.end) } : undefined,
    isOriginal: raw.audioTrack?.audioIsDefault !== false,
    language: raw.audioTrack?.id?.slice(0, 2),
  };
}

function extractFormatUrl(raw: any): string | null {
  if (raw.url) return raw.url;
  // If cipher or signatureCipher exists
  const cipher = raw.signatureCipher || raw.cipher;
  if (cipher) {
    const params = new URLSearchParams(cipher);
    const url = params.get('url');
    const sig = params.get('s') || params.get('sig');
    const sp = params.get('sp') || 'sig';
    if (url) {
      if (sig) {
        return `${url}&${sp}=${encodeURIComponent(sig)}`;
      }
      return url;
    }
  }
  return null;
}
