import { VideoStreamFormat, AudioStreamFormat } from './format-parser.js';

export interface SelectedStreams {
  video: VideoStreamFormat | null;
  audio: AudioStreamFormat | null;
  muxed: VideoStreamFormat | null;
  qualityLabel: string;
  isSeparate: boolean;
}

export class StreamSelector {
  /**
   * Pick best video and audio stream for target height (e.g. 1080, 720, 2160, 480, 360)
   */
  static selectQuality(
    videoOnly: VideoStreamFormat[],
    audioOnly: AudioStreamFormat[],
    muxed: VideoStreamFormat[],
    targetHeight: number = 1080,
    preferHdr: boolean = false
  ): SelectedStreams {
    // 1. Filter video candidates
    const videoCandidates = videoOnly.filter((v) => {
      if (preferHdr) return true;
      return !v.isHdr;
    });

    // Find exact or closest height <= targetHeight, or closest available
    let bestVideo = this.findBestVideo(videoCandidates, targetHeight, preferHdr);
    if (!bestVideo && videoOnly.length > 0) {
      bestVideo = this.findBestVideo(videoOnly, targetHeight, preferHdr);
    }

    // 2. Pick best audio
    const bestAudio = this.selectBestAudio(audioOnly);

    // 3. Fallback to muxed if separate pair not complete
    let bestMuxed: VideoStreamFormat | null = null;
    if (!bestVideo || !bestAudio) {
      bestMuxed = this.findBestVideo(muxed, targetHeight, preferHdr);
    }

    const isSeparate = Boolean(bestVideo && bestAudio);
    const finalQuality = bestVideo?.qualityLabel || bestMuxed?.qualityLabel || `${targetHeight}p`;

    return {
      video: bestVideo,
      audio: bestAudio,
      muxed: bestMuxed,
      qualityLabel: finalQuality,
      isSeparate,
    };
  }

  private static findBestVideo(
    candidates: VideoStreamFormat[],
    targetHeight: number,
    preferHdr: boolean
  ): VideoStreamFormat | null {
    if (candidates.length === 0) return null;

    // Filter by target height or closest lower
    const exactOrLower = candidates.filter((v) => v.height <= targetHeight);
    const pool = exactOrLower.length > 0 ? exactOrLower : candidates;

    // Sort: highest height -> HDR preference -> highest fps -> highest bitrate
    const sorted = [...pool].sort((a, b) => {
      if (a.height !== b.height) return b.height - a.height;
      if (preferHdr && a.isHdr !== b.isHdr) return a.isHdr ? -1 : 1;
      if (a.fps !== b.fps) return b.fps - a.fps;
      return (b.bitrate || 0) - (a.bitrate || 0);
    });

    return sorted[0] || null;
  }

  static selectBestAudio(candidates: AudioStreamFormat[]): AudioStreamFormat | null {
    if (candidates.length === 0) return null;

    // Helper to score audio formats for 100% hardware decoding compatibility on Windows Electron:
    // Priority:
    // 1. itag 140 (audio/mp4, m4a, AAC) -> Highest priority
    // 2. other audio/mp4 or m4a
    // 3. audio/webm (itag 251 Opus, etc.)
    const getFormatScore = (fmt: AudioStreamFormat): number => {
      if (fmt.itag === 140) return 1000;
      const mime = (fmt.mimeType || '').toLowerCase();
      const codec = (fmt.codec || '').toLowerCase();
      if (fmt.container === 'm4a' || mime.includes('audio/mp4') || codec.includes('mp4a')) {
        return 500;
      }
      return 100;
    };

    const sorted = [...candidates].sort((a, b) => {
      // 1. Prefer original audio track if specified
      if (a.isOriginal !== b.isOriginal) return a.isOriginal ? -1 : 1;

      // 2. Prioritize audio/mp4 (itag 140 AAC) over audio/webm (itag 251 Opus)
      const scoreA = getFormatScore(a);
      const scoreB = getFormatScore(b);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      // 3. Within same format tier, prefer highest bitrate
      const bitA = a.averageBitrate || a.bitrate || 0;
      const bitB = b.averageBitrate || b.bitrate || 0;
      return bitB - bitA;
    });

    return sorted[0] || null;
  }
}

export const YTPlayerUtils = StreamSelector;
