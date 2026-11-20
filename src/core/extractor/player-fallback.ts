import { CLIENT_CONFIGS, InnerTubeClientConfig } from '../clients/client-configs.js';
import { InnerTubeService, defaultInnerTube } from '../clients/innertube.js';
import { defaultPoTokenProvider } from '../potoken/po-token-provider.js';

export interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
    messages?: string[];
  };
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    channelId: string;
    isOwnerViewing?: boolean;
    shortDescription?: string;
    isCrawlable?: boolean;
    thumbnail?: {
      thumbnails: Array<{ url: string; width: number; height: number }>;
    };
    author: string;
    viewCount?: string;
    isLiveContent?: boolean;
  };
  streamingData?: {
    expiresInSeconds?: string;
    formats?: any[];
    adaptiveFormats?: any[];
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: any[];
      audioTracks?: any[];
    };
  };
  [key: string]: any;
}

export class PlayerFallbackEngine {
  private innertube: InnerTubeService;
  private cache = new Map<string, { at: number; data: PlayerResponse }>();
  private CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

  // Fallback clients in order of priority (no-PO-Token mobile/VR clients first)
  private fallbackClients: InnerTubeClientConfig[] = [
    CLIENT_CONFIGS.ANDROID_VR,
    CLIENT_CONFIGS.ANDROID,
    CLIENT_CONFIGS.IOS,
    CLIENT_CONFIGS.TVHTML5_SIMPLY_EMBEDDED_PLAYER,
    CLIENT_CONFIGS.TVHTML5,
    CLIENT_CONFIGS.WEB_EMBEDDED_PLAYER,
    CLIENT_CONFIGS.WEB,
  ];

  constructor(innertube: InnerTubeService = defaultInnerTube) {
    this.innertube = innertube;
  }

  isPlayable(player: PlayerResponse | null | undefined): boolean {
    if (!player) return false;
    const status = player.playabilityStatus?.status?.toUpperCase();
    if (status !== 'OK') return false;

    const streaming = player.streamingData;
    if (!streaming) return false;
    if (streaming.hlsManifestUrl) return true;
    if (Array.isArray(streaming.formats) && streaming.formats.length > 0) return true;
    if (Array.isArray(streaming.adaptiveFormats) && streaming.adaptiveFormats.length > 0) return true;

    return false;
  }

  isBlocked(player: PlayerResponse | null | undefined): boolean {
    if (!player) return true;
    const status = player.playabilityStatus?.status?.toUpperCase() || '';
    const reason = (player.playabilityStatus?.reason || '').toLowerCase();

    if (status === 'OK' && player.streamingData) {
      return false;
    }

    if (
      status === 'LOGIN_REQUIRED' ||
      status === 'UNPLAYABLE' ||
      status === 'ERROR' ||
      status === 'AGE_VERIFICATION_REQUIRED'
    ) {
      return true;
    }

    if (
      reason.includes('a bot') ||
      reason.includes('not a bot') ||
      reason.includes('confirm you') ||
      reason.includes('sign in')
    ) {
      return true;
    }

    return !player.streamingData;
  }

  /**
   * Main player resolution method: attempts primary request with PO Token if available,
   * and automatically engages the multi-client fallback pipeline if blocked.
   */
  async resolvePlayer(videoId: string): Promise<PlayerResponse> {
    const cached = this.cache.get(videoId);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return cached.data;
    }

    // Try first client: ANDROID_VR (has highest success rate against bot checks)
    for (const clientCfg of this.fallbackClients) {
      try {
        const body: Record<string, any> = {
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        };

        // Attach PoToken if available for WEB or WEB_EMBEDDED
        if (clientCfg.name.startsWith('WEB')) {
          const pot = await defaultPoTokenProvider.getPoToken(videoId);
          if (pot) {
            body.serviceIntegrityDimensions = {
              poToken: pot.playerRequestPoToken,
            };
          }
        }

        const resp = (await this.innertube.request(
          'player',
          body,
          clientCfg
        )) as PlayerResponse;

        if (this.isPlayable(resp)) {
          this.cache.set(videoId, { at: Date.now(), data: resp });
          return resp;
        }
      } catch (err: any) {
        // Try next fallback client
        continue;
      }
    }

    throw new Error(
      `Could not retrieve playable streams for video ${videoId} across all fallback clients (Android VR, TV, iOS, Web Embed).`
    );
  }

  private iosCache = new Map<
    string,
    { at: number; data: { hlsManifestUrl?: string; adaptiveFormats?: any[]; formats?: any[] } }
  >();

  /**
   * Specifically fetch iOS player response to obtain official hlsManifestUrl and HDR/iOS streams.
   * Falls back to IOS_HDR client if primary IOS client does not return hlsManifestUrl.
   */
  async fetchIosStreamingData(
    videoId: string
  ): Promise<{ hlsManifestUrl?: string; adaptiveFormats?: any[]; formats?: any[] }> {
    const cached = this.iosCache.get(videoId);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const iosClients = [CLIENT_CONFIGS.IOS, CLIENT_CONFIGS.IOS_HDR];
    let bestResult: { hlsManifestUrl?: string; adaptiveFormats?: any[]; formats?: any[] } = {};

    for (const clientCfg of iosClients) {
      try {
        const resp = (await this.innertube.request(
          'player',
          {
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          },
          clientCfg
        )) as PlayerResponse;

        const hlsManifestUrl = resp.streamingData?.hlsManifestUrl;
        const adaptiveFormats = resp.streamingData?.adaptiveFormats;
        const formats = resp.streamingData?.formats;

        if (hlsManifestUrl) {
          bestResult = { hlsManifestUrl, adaptiveFormats, formats };
          this.iosCache.set(videoId, { at: Date.now(), data: bestResult });
          return bestResult;
        }

        if (!bestResult.adaptiveFormats && adaptiveFormats) {
          bestResult = { adaptiveFormats, formats };
        }
      } catch {
        continue;
      }
    }

    if (bestResult.adaptiveFormats || bestResult.formats) {
      this.iosCache.set(videoId, { at: Date.now(), data: bestResult });
    }
    return bestResult;
  }

  /**
   * When a stream URL returns HTTP 403 on googlevideo.com, attempts alternative InnerTube clients
   * (ANDROID, IOS, ANDROID_VR, TVHTML5_SIMPLY_EMBEDDED_PLAYER) to obtain a fresh working URL + User-Agent.
   */
  async resolveFallbackStreamUrl(
    videoId: string,
    itag?: number,
    excludeClient?: string
  ): Promise<{ url: string; clientName: string; userAgent: string } | null> {
    const candidates = [
      CLIENT_CONFIGS.ANDROID,
      CLIENT_CONFIGS.ANDROID_VR,
      CLIENT_CONFIGS.IOS,
      CLIENT_CONFIGS.TVHTML5_SIMPLY_EMBEDDED_PLAYER,
    ].filter((c) => !excludeClient || c.name.toUpperCase() !== excludeClient.toUpperCase());

    for (const clientCfg of candidates) {
      try {
        const resp = (await this.innertube.request(
          'player',
          {
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          },
          clientCfg
        )) as PlayerResponse;

        if (!this.isPlayable(resp)) continue;

        const allFormats = [
          ...(resp.streamingData?.formats || []),
          ...(resp.streamingData?.adaptiveFormats || []),
        ];

        const matched = itag
          ? allFormats.find((f: any) => Number(f.itag) === Number(itag) && f.url) ||
            allFormats.find((f: any) => f.url)
          : allFormats.find((f: any) => f.url);

        if (matched?.url) {
          return {
            url: matched.url,
            clientName: clientCfg.name,
            userAgent: clientCfg.userAgent,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Specifically fetch iOS player response to obtain HDR VP9.2 and AV1 10-bit streams
   * as ported from HdrFormats.kt.
   */
  async fetchHdrExtraFormats(videoId: string): Promise<any[]> {
    try {
      const resp = (await this.innertube.request(
        'player',
        {
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        },
        CLIENT_CONFIGS.IOS_HDR
      )) as PlayerResponse;

      if (resp.streamingData?.adaptiveFormats) {
        return resp.streamingData.adaptiveFormats;
      }
    } catch {
      // Ignore HDR extra request error
    }
    return [];
  }
}

export const defaultPlayerFallback = new PlayerFallbackEngine();
