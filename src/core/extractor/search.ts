import { InnerTubeService, defaultInnerTube } from '../clients/innertube.js';
import { CLIENT_CONFIGS } from '../clients/client-configs.js';

export interface SearchVideoItem {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  thumbnail: string;
  durationText: string;
  durationSec: number;
  viewCountText: string;
  publishedText?: string;
}

export class YouTubeSearch {
  private innertube: InnerTubeService;

  constructor(innertube: InnerTubeService = defaultInnerTube) {
    this.innertube = innertube;
  }

  /**
   * Search YouTube for videos matching query.
   */
  async search(query: string): Promise<SearchVideoItem[]> {
    const json = await this.innertube.request(
      'search',
      {
        query,
      },
      CLIENT_CONFIGS.WEB
    );

    return this.parseSearchResults(json);
  }

  private parseSearchResults(json: any): SearchVideoItem[] {
    const results: SearchVideoItem[] = [];

    const sectionContents =
      json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];

    for (const section of sectionContents) {
      const items = section.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.videoRenderer) {
          const v = item.videoRenderer;
          const id = v.videoId;
          if (!id) continue;

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
          const durationSec = this.parseDurationToSec(durationText);
          const viewCountText = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
          const publishedText = v.publishedTimeText?.simpleText;

          results.push({
            id,
            title,
            channel,
            channelId,
            thumbnail,
            durationText,
            durationSec,
            viewCountText,
            publishedText,
          });
        }
      }
    }

    return results;
  }

  private parseDurationToSec(durationStr: string): number {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      return parts[0];
    }
    return 0;
  }
}

export const defaultYouTubeSearch = new YouTubeSearch();
