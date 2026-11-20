import { InnerTubeService, defaultInnerTube } from './clients/innertube.js';
import { CLIENT_CONFIGS, InnerTubeClientConfig } from './clients/client-configs.js';
import { PlayerFallbackEngine, defaultPlayerFallback, PlayerResponse } from './extractor/player-fallback.js';
import { parseStreamFormats, VideoStreamFormat, AudioStreamFormat } from './extractor/format-parser.js';
import { StreamSelector, SelectedStreams } from './extractor/stream-selection.js';
import { YouTubeSearch, defaultYouTubeSearch, SearchVideoItem } from './extractor/search.js';
import { CaptionTracksExtractor, CaptionTrackInfo } from './subtitles/caption-tracks.js';
import { SubtitleParser, SubtitleCue } from './subtitles/subtitle-parser.js';
import { SponsorBlockService, defaultSponsorBlock, SponsorBlockSegment } from './sponsorblock/sponsorblock.js';
import { ChunkedRangeProxyServer, defaultChunkedProxy } from './proxy/chunked-proxy.js';
import { PoTokenProvider, defaultPoTokenProvider } from './potoken/po-token-provider.js';
import { CommentsExtractor, defaultCommentsExtractor, CommentsResult } from './extractor/comments.js';
import { TrendingExtractor, defaultTrendingExtractor } from './extractor/trending.js';

export * from './clients/client-configs.js';
export * from './clients/innertube.js';
export * from './potoken/js-util.js';
export * from './potoken/po-generator.js';
export * from './potoken/po-token-provider.js';
export * from './extractor/hdr-formats.js';
export * from './extractor/format-parser.js';
export * from './extractor/player-fallback.js';
export * from './extractor/stream-selection.js';
export * from './extractor/search.js';
export * from './extractor/comments.js';
export * from './extractor/trending.js';
export * from './subtitles/caption-tracks.js';
export * from './subtitles/subtitle-parser.js';
export * from './sponsorblock/sponsorblock.js';
export * from './proxy/chunked-proxy.js';
export * from './proxy/manifest-generator.js';

export interface RelatedVideoItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationText?: string;
  viewCountText?: string;
}

export interface TayTubeVideoDetails {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  durationSec: number;
  viewCount: string;
  description: string;
  thumbnails: Array<{ url: string; width: number; height: number }>;
  allQualities: number[];
  hdrQualities: number[];
  selectedStreams: SelectedStreams;
  allVideoStreams: VideoStreamFormat[];
  allAudioStreams: AudioStreamFormat[];
  captionTracks: CaptionTrackInfo[];
  sponsorSegments: SponsorBlockSegment[];
  relatedVideos: RelatedVideoItem[];
  proxyVideoUrl?: string;
  proxyAudioUrl?: string;
  manifestUrl?: string;
  hlsManifestUrl?: string;
  proxyHlsUrl?: string;
}

export class TayTubeCore {
  private fallbackEngine: PlayerFallbackEngine;
  private searchEngine: YouTubeSearch;
  private sponsorBlock: SponsorBlockService;
  private proxyServer: ChunkedRangeProxyServer;
  private commentsExtractor: CommentsExtractor;
  private trendingExtractor: TrendingExtractor;
  private innertube: InnerTubeService;

  constructor(options?: {
    innertube?: InnerTubeService;
    proxyPort?: number;
  }) {
    this.innertube = options?.innertube || defaultInnerTube;
    this.fallbackEngine = new PlayerFallbackEngine(this.innertube);
    this.searchEngine = new YouTubeSearch(this.innertube);
    this.sponsorBlock = defaultSponsorBlock;
    this.commentsExtractor = defaultCommentsExtractor;
    this.trendingExtractor = defaultTrendingExtractor;
    this.proxyServer = options?.proxyPort
      ? new ChunkedRangeProxyServer({ port: options.proxyPort })
      : defaultChunkedProxy;
  }

  /**
   * Search YouTube videos
   */
  async search(query: string): Promise<SearchVideoItem[]> {
    return this.searchEngine.search(query);
  }

  /**
   * Get Trending / Home feed videos
   */
  async getTrending(): Promise<SearchVideoItem[]> {
    return this.trendingExtractor.getTrending();
  }

  /**
   * Get Comments for a video
   */
  async getComments(videoId: string): Promise<CommentsResult> {
    return this.commentsExtractor.getComments(videoId);
  }

  /**
   * Extract video ID from URL or ID string.
   */
  static extractVideoId(input: string): string {
    const trimmed = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];

    const shortMatch = trimmed.match(/(?:youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];

    throw new Error(`Invalid YouTube URL or ID: ${input}`);
  }

  /**
   * Extract comprehensive details, streams, captions, SponsorBlock, and related videos.
   */
  async getVideoDetails(
    urlOrId: string,
    options?: {
      targetQuality?: number;
      preferHdr?: boolean;
      useProxy?: boolean;
    }
  ): Promise<TayTubeVideoDetails> {
    const videoId = TayTubeCore.extractVideoId(urlOrId);

    // 1. Fetch player response using multi-client fallback pipeline
    const playerResponse = await this.fallbackEngine.resolvePlayer(videoId);

    // 2. Concurrently fetch iOS streaming data (hlsManifestUrl + HDR), extra HDR formats, SponsorBlock segments & related videos
    const [iosData, extraHdrFormats, sponsorSegments, relatedVideos] = await Promise.all([
      this.fallbackEngine.fetchIosStreamingData(videoId),
      this.fallbackEngine.fetchHdrExtraFormats(videoId),
      this.sponsorBlock.getSkipSegments(videoId),
      this.fetchRelatedVideos(videoId),
    ]);

    // Merge extra HDR formats if any into streamingData
    if (extraHdrFormats.length > 0 && playerResponse.streamingData?.adaptiveFormats) {
      const existingItags = new Set(
        playerResponse.streamingData.adaptiveFormats.map((f: any) => f.itag)
      );
      for (const hdrFmt of extraHdrFormats) {
        if (!existingItags.has(hdrFmt.itag)) {
          playerResponse.streamingData.adaptiveFormats.push(hdrFmt);
        }
      }
    }

    // Merge iOS adaptiveFormats if available
    if (iosData.adaptiveFormats && iosData.adaptiveFormats.length > 0 && playerResponse.streamingData?.adaptiveFormats) {
      const existingItags = new Set(
        playerResponse.streamingData.adaptiveFormats.map((f: any) => f.itag)
      );
      for (const fmt of iosData.adaptiveFormats) {
        if (!existingItags.has(fmt.itag)) {
          playerResponse.streamingData.adaptiveFormats.push(fmt);
        }
      }
    }

    // Merge iOS muxed formats (e.g., itag 22 720p / itag 18 360p) for reliable direct MP4 fallback
    if (iosData.formats && iosData.formats.length > 0 && playerResponse.streamingData) {
      if (!playerResponse.streamingData.formats) {
        playerResponse.streamingData.formats = [];
      }
      const existingMuxedItags = new Set(
        playerResponse.streamingData.formats.map((f: any) => f.itag)
      );
      for (const fmt of iosData.formats) {
        if (!existingMuxedItags.has(fmt.itag)) {
          playerResponse.streamingData.formats.push(fmt);
        }
      }
    }

    const rawHlsUrl = playerResponse.streamingData?.hlsManifestUrl || iosData.hlsManifestUrl;

    // 3. Parse formats (360p, 720p, 1080p, 4K, HDR, Audio)
    const { videoOnly, audioOnly, muxed, allQualities, hdrQualities } =
      parseStreamFormats(playerResponse.streamingData);

    // 4. Select requested quality (default: 1080p)
    const targetHeight = options?.targetQuality || 1080;
    const preferHdr = options?.preferHdr ?? false;
    const selected = StreamSelector.selectQuality(
      videoOnly,
      audioOnly,
      muxed,
      targetHeight,
      preferHdr
    );

    // 5. Parse caption tracks
    const captionTracks = CaptionTracksExtractor.extractCaptionTracks(playerResponse);

    // 6. Generate proxy URLs if requested or proxy is active
    let proxyVideoUrl: string | undefined;
    let proxyAudioUrl: string | undefined;

    const chosenVideoUrl = selected.video?.url || selected.muxed?.url;
    if (chosenVideoUrl) {
      proxyVideoUrl = this.proxyServer.getProxyUrl(
        chosenVideoUrl,
        undefined,
        videoId,
        selected.video?.itag || selected.muxed?.itag
      );
    }

    if (selected.audio?.url) {
      proxyAudioUrl = this.proxyServer.getProxyUrl(
        selected.audio.url,
        undefined,
        videoId,
        selected.audio.itag
      );
    }

    const proxyHlsUrl = rawHlsUrl ? this.proxyServer.getHlsUrl(videoId, rawHlsUrl) : undefined;

    const details = playerResponse.videoDetails;

    return {
      id: videoId,
      title: details?.title || 'Unknown Title',
      channel: details?.author || 'Unknown Channel',
      channelId: details?.channelId,
      durationSec: parseInt(details?.lengthSeconds || '0', 10),
      viewCount: details?.viewCount || '0',
      description: details?.shortDescription || '',
      thumbnails: details?.thumbnail?.thumbnails || [],
      allQualities,
      hdrQualities,
      selectedStreams: selected,
      allVideoStreams: [...videoOnly, ...muxed],
      allAudioStreams: audioOnly,
      captionTracks,
      sponsorSegments,
      relatedVideos,
      proxyVideoUrl,
      proxyAudioUrl,
      hlsManifestUrl: rawHlsUrl,
      proxyHlsUrl,
    };
  }

  private async fetchRelatedVideos(videoId: string): Promise<RelatedVideoItem[]> {
    try {
      const nextResp = await this.innertube.request(
        'next',
        { videoId },
        CLIENT_CONFIGS.WEB
      );

      const items: RelatedVideoItem[] = [];
      const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (obj.compactVideoRenderer || (obj.lockupViewModel && obj.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')) {
          const v = obj.compactVideoRenderer;
          const vid = v?.videoId || obj.contentId;
          if (vid && vid !== videoId) {
            const title =
              v?.title?.simpleText ||
              v?.title?.runs?.map((r: any) => r.text).join('') ||
              obj.metadata?.lockupMetadataViewModel?.title?.content ||
              '';

            const channel =
              v?.shortBylineText?.runs?.[0]?.text ||
              obj.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ||
              '';

            const thumb =
              v?.thumbnail?.thumbnails?.[0]?.url ||
              obj.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url ||
              `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            const durationText = v?.lengthText?.simpleText;
            const viewCountText = v?.viewCountText?.simpleText;

            if (title) {
              items.push({
                id: vid,
                title,
                channel,
                thumbnail: thumb,
                durationText,
                viewCountText,
              });
            }
          }
        }

        for (const k of Object.keys(obj)) {
          walk(obj[k]);
        }
      };

      walk(nextResp);
      return items.filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx).slice(0, 15);
    } catch {
      return [];
    }
  }

  /**
   * Start local Chunked Range Proxy
   */
  async startProxy(): Promise<number> {
    return this.proxyServer.start();
  }

  /**
   * Stop local Chunked Range Proxy
   */
  async stopProxy(): Promise<void> {
    return this.proxyServer.stop();
  }
}
