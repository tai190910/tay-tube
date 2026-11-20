import { InnerTubeService, defaultInnerTube } from '../clients/innertube.js';
import { CLIENT_CONFIGS } from '../clients/client-configs.js';
import { SearchVideoItem } from './search.js';

export class TrendingExtractor {
  private innertube: InnerTubeService;

  constructor(innertube: InnerTubeService = defaultInnerTube) {
    this.innertube = innertube;
  }

  /**
   * Fetches trending / recommended videos from YouTube
   */
  async getTrending(): Promise<SearchVideoItem[]> {
    try {
      const resp = await this.innertube.request(
        'browse',
        {
          browseId: 'FEtrending',
        },
        CLIENT_CONFIGS.WEB
      );

      return this.parseTrending(resp);
    } catch {
      // Fallback: search for trending music & news
      try {
        const fallbackSearch = await this.innertube.request(
          'search',
          {
            query: 'trending',
          },
          CLIENT_CONFIGS.WEB
        );
        return this.parseTrending(fallbackSearch);
      } catch {
        return [];
      }
    }
  }

  private parseTrending(json: any): SearchVideoItem[] {
    const list: SearchVideoItem[] = [];

    const walk = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      if (obj.videoRenderer) {
        const v = obj.videoRenderer;
        const id = v.videoId;
        if (id) {
          const title =
            v.title?.runs?.map((r: any) => r.text).join('') ||
            v.title?.simpleText ||
            '';

          const channel =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            v.shortBylineText?.runs?.[0]?.text ||
            '';

          const channelId =
            v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
            v.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

          const thumbnails = v.thumbnail?.thumbnails || [];
          const thumbnail =
            thumbnails[thumbnails.length - 1]?.url ||
            `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

          const durationText = v.lengthText?.simpleText || '';
          const viewCountText = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
          const publishedText = v.publishedTimeText?.simpleText;

          list.push({
            id,
            title,
            channel,
            channelId,
            thumbnail,
            durationText,
            durationSec: 0,
            viewCountText,
            publishedText,
          });
        }
      }

      for (const k of Object.keys(obj)) {
        walk(obj[k]);
      }
    };

    walk(json);
    return list.filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i);
  }
}

export const defaultTrendingExtractor = new TrendingExtractor();
