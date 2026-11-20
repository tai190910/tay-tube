import { VideoStreamFormat, AudioStreamFormat } from '../extractor/format-parser.js';

export interface DashMpdParams {
  videoId: string;
  durationSec: number;
  videoStreams: VideoStreamFormat[];
  audioStream: AudioStreamFormat;
  proxyBaseUrl: string; // e.g. "http://127.0.0.1:8989"
  targetQuality?: number; // e.g. 1080
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractMimeAndCodecs(rawMime: string): { mime: string; codecs: string } {
  const parts = rawMime.split(';');
  const mime = parts[0].trim();
  const codecMatch = rawMime.match(/codecs="([^"]+)"/);
  const codecs = codecMatch ? codecMatch[1] : '';
  return { mime, codecs };
}

export function generateDashMpd(params: DashMpdParams): string {
  const { videoId, durationSec, videoStreams, audioStream, proxyBaseUrl, targetQuality } = params;

  // Lọc các video stream có đầy đủ initRange và indexRange chuẩn từ YouTube
  const validVideos = videoStreams.filter((v) => v.initRange && v.indexRange);

  // Lọc theo targetQuality nếu có yêu cầu (mặc định 1080p)
  let selectedVideos = validVideos;
  if (targetQuality) {
    const exact = validVideos.find((v) => v.height === targetQuality);
    if (exact) {
      selectedVideos = [exact];
    } else {
      const lower = validVideos.filter((v) => v.height <= targetQuality);
      if (lower.length > 0) {
        selectedVideos = [lower[0]];
      }
    }
  }

  if (selectedVideos.length === 0 && validVideos.length > 0) {
    selectedVideos = [validVideos[0]];
  }

  // Video Representations
  const videoRepresentations = selectedVideos
    .map((v) => {
      const { codecs } = extractMimeAndCodecs(v.mimeType);
      const encodedUrl = encodeURIComponent(v.url);
      const streamUrl = `${proxyBaseUrl}/stream?url=${encodedUrl}&type=video&id=${encodeURIComponent(videoId)}&itag=${v.itag}`;

      // SegmentBase indexRangeExact="true" chuẩn MPEG-DASH ISO BMFF on-demand
      return `      <Representation id="${v.itag}" bandwidth="${v.bitrate || 2000000}" width="${v.width}" height="${v.height}" frameRate="${v.fps || 30}" codecs="${codecs}" mimeType="video/mp4">
        <BaseURL>${xmlEscape(streamUrl)}</BaseURL>
        <SegmentBase indexRange="${v.indexRange!.start}-${v.indexRange!.end}" indexRangeExact="true">
          <Initialization range="${v.initRange!.start}-${v.initRange!.end}"/>
        </SegmentBase>
      </Representation>`;
    })
    .join('\n');

  const primaryVideo = selectedVideos[0] || validVideos[0];
  const videoMime = primaryVideo ? extractMimeAndCodecs(primaryVideo.mimeType).mime : 'video/mp4';

  // Audio Representation (ưu tiên itag 140 AAC/MP4 có đầy đủ initRange và indexRange)
  let audioRepXml = '';
  let audioMime = 'audio/mp4';
  if (audioStream && audioStream.initRange && audioStream.indexRange) {
    const { mime, codecs } = extractMimeAndCodecs(audioStream.mimeType);
    audioMime = mime;
    const encodedAudioUrl = encodeURIComponent(audioStream.url);
    const audioStreamUrl = `${proxyBaseUrl}/stream?url=${encodedAudioUrl}&type=audio&id=${encodeURIComponent(videoId)}&itag=${audioStream.itag}`;

    audioRepXml = `      <Representation id="${audioStream.itag}" bandwidth="${audioStream.bitrate || 130000}" audioSamplingRate="${audioStream.audioSampleRate || '44100'}" codecs="${codecs}" mimeType="${audioMime}">
        <BaseURL>${xmlEscape(audioStreamUrl)}</BaseURL>
        <SegmentBase indexRange="${audioStream.indexRange.start}-${audioStream.indexRange.end}" indexRangeExact="true">
          <Initialization range="${audioStream.initRange.start}-${audioStream.initRange.end}"/>
        </SegmentBase>
      </Representation>`;
  }

  // Tính duration chính xác cao (chuẩn ISO 8601, hỗ trợ video siêu dài 10 - 20 tiếng)
  const exactDurationSec = primaryVideo?.approxDurationMs
    ? primaryVideo.approxDurationMs / 1000
    : (durationSec || 1);
  const durationStr = `PT${Math.max(1, exactDurationSec).toFixed(3)}S`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="${durationStr}"
     minBufferTime="PT2.0S">
  <Period id="0">
    <AdaptationSet id="0" contentType="video" mimeType="${videoMime}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
${videoRepresentations}
    </AdaptationSet>
    <AdaptationSet id="1" contentType="audio" mimeType="${audioMime}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
${audioRepXml}
    </AdaptationSet>
  </Period>
</MPD>
`;
}
