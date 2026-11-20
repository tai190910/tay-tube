import { CLIENT_CONFIGS, InnerTubeClientConfig, DEFAULT_USER_AGENT } from './client-configs.js';

export interface InnerTubeOptions {
  lang?: string;
  country?: string;
  visitorData?: string;
  cookie?: string;
  authorization?: string;
}

export class InnerTubeService {
  private base = 'https://www.youtube.com/youtubei/v1/';
  private defaultLang: string;
  private defaultCountry: string;
  private visitorData: string | null = null;
  private cookie: string | null = null;

  constructor(options?: InnerTubeOptions) {
    this.defaultLang = options?.lang || 'vi';
    this.defaultCountry = options?.country || 'VN';
    this.visitorData = options?.visitorData || null;
    this.cookie = options?.cookie || null;
  }

  setVisitorData(visitorData: string) {
    this.visitorData = visitorData;
  }

  getVisitorData(): string | null {
    return this.visitorData;
  }

  setCookie(cookie: string) {
    this.cookie = cookie;
  }

  /**
   * Send a request to YouTube InnerTube API with a specific client configuration.
   */
  async request(
    endpoint: string,
    body: Record<string, any>,
    clientCfg: InnerTubeClientConfig = CLIENT_CONFIGS.WEB,
    extraHeaders: Record<string, string> = {}
  ): Promise<any> {
    const lang = this.defaultLang;
    const country = this.defaultCountry;

    // Build context
    const clientContext: Record<string, any> = {
      clientName: clientCfg.name,
      clientVersion: clientCfg.version,
      clientScreen: clientCfg.clientScreen || 'WATCH',
      platform: clientCfg.platform,
      deviceMake: clientCfg.deviceMake,
      deviceModel: clientCfg.deviceModel,
      osName: clientCfg.osName,
      osVersion: clientCfg.osVersion,
      hl: lang,
      gl: country,
    };

    if (this.visitorData) {
      clientContext.visitorData = this.visitorData;
    }

    const payload: Record<string, any> = {
      ...body,
      context: {
        ...(body.context || {}),
        client: {
          ...clientContext,
          ...(body.context?.client || {}),
        },
      },
    };

    const prefCookie = `PREF=hl=${lang}&gl=${country}`;
    const cookieHeader = this.cookie ? `${this.cookie}; ${prefCookie}` : prefCookie;

    const headers: Record<string, string> = {
      'User-Agent': clientCfg.userAgent || DEFAULT_USER_AGENT,
      'Content-Type': 'application/json',
      'Accept-Language': `${lang}-${country},${lang};q=0.9,en-US;q=0.8,en;q=0.7`,
      'X-Goog-Api-Format-Version': '2',
      'X-YouTube-Client-Name': clientCfg.id,
      'X-YouTube-Client-Version': clientCfg.version,
      'Cookie': cookieHeader,
      ...extraHeaders,
    };

    if (this.visitorData) {
      headers['X-Goog-Visitor-Id'] = this.visitorData;
    }

    if (clientCfg.name === 'WEB_EMBEDDED_PLAYER') {
      headers['Origin'] = 'https://www.youtube.com';
      headers['Referer'] = `https://www.youtube.com/embed/${body.videoId || ''}`;
      payload.thirdPartyEmbedUrl = `https://www.youtube.com/embed/${body.videoId || ''}`;
    }

    const url = `${this.base}${endpoint}?prettyPrint=false&hl=${lang}&gl=${country}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`InnerTube HTTP ${res.status} on ${endpoint}: ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as any;

    // Capture visitorData if returned
    if (json.responseContext?.visitorData && !this.visitorData) {
      this.visitorData = json.responseContext.visitorData;
    }

    return json;
  }
}

export const defaultInnerTube = new InnerTubeService();
