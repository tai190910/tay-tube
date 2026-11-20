import crypto from 'node:crypto';

export type SponsorCategory =
  | 'sponsor'
  | 'selfpromo'
  | 'interaction'
  | 'intro'
  | 'outro'
  | 'preview'
  | 'music_offtopic'
  | 'filler';

export interface SponsorBlockSegment {
  uuid: string;
  category: SponsorCategory;
  categoryLabel: string;
  startSec: number;
  endSec: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  action: 'skip' | 'mute' | 'mark';
}

export const CATEGORY_LABELS: Record<SponsorCategory, string> = {
  sponsor: 'Sponsor / Tài trợ',
  selfpromo: 'Self-promotion / Tự quảng cáo',
  interaction: 'Interaction / Kêu gọi Like & Sub',
  intro: 'Intro / Đoạn mở đầu',
  outro: 'Outro / Đoạn kết thúc',
  preview: 'Preview & Recap / Xem trước',
  music_offtopic: 'Non-music / Đoạn ngoài âm nhạc',
  filler: 'Filler / Đoạn lan man',
};

export class SponsorBlockService {
  private cache = new Map<string, SponsorBlockSegment[]>();
  private CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Fetch skip segments for a given video ID using SponsorBlock's privacy-preserving prefix lookup.
   */
  async getSkipSegments(
    videoId: string,
    categories: SponsorCategory[] = [
      'sponsor',
      'selfpromo',
      'interaction',
      'intro',
      'outro',
      'preview',
      'music_offtopic',
      'filler',
    ]
  ): Promise<SponsorBlockSegment[]> {
    if (this.cache.has(videoId)) {
      return this.cache.get(videoId)!;
    }

    try {
      // Calculate SHA-256 hash prefix (first 4 characters)
      const hash = crypto.createHash('sha256').update(videoId).digest('hex');
      const prefix = hash.slice(0, 4);

      const encodedCats = encodeURIComponent(JSON.stringify(categories));
      const url = `https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${encodedCats}&actionType=skip`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'TayTube-PC/1.0',
        },
      });

      if (res.status === 404) {
        this.cache.set(videoId, []);
        return [];
      }

      if (!res.ok) {
        return [];
      }

      const list = (await res.json()) as any[];
      const matchedVideo = list.find((item) => item.videoID === videoId);

      if (!matchedVideo || !Array.isArray(matchedVideo.segments)) {
        this.cache.set(videoId, []);
        return [];
      }

      const segments: SponsorBlockSegment[] = [];
      for (const seg of matchedVideo.segments) {
        const cat = seg.category as SponsorCategory;
        const range = seg.segment;
        if (!range || range.length < 2) continue;

        const startSec = Number(range[0]);
        const endSec = Number(range[1]);
        const startMs = Math.round(startSec * 1000);
        const endMs = Math.round(endSec * 1000);
        const durationMs = endMs - startMs;

        // Skip negligible segments (< 1 second)
        if (durationMs < 1000) continue;

        segments.push({
          uuid: seg.UUID || '',
          category: cat,
          categoryLabel: CATEGORY_LABELS[cat] || cat,
          startSec,
          endSec,
          startMs,
          endMs,
          durationMs,
          action: 'skip',
        });
      }

      segments.sort((a, b) => a.startMs - b.startMs);
      this.cache.set(videoId, segments);
      return segments;
    } catch {
      return [];
    }
  }
}

export const defaultSponsorBlock = new SponsorBlockService();
