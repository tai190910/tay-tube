import { PoTokenGenerator, PoTokenResult } from './po-generator.js';

export class PoTokenProvider {
  private generator = new PoTokenGenerator();
  private cache = new Map<string, PoTokenResult>();
  private CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

  async getPoToken(videoId: string, sessionId?: string): Promise<PoTokenResult | null> {
    const cached = this.cache.get(videoId);
    if (cached && Date.now() - cached.mintedAt < this.CACHE_TTL_MS) {
      return cached;
    }

    try {
      const result = await this.generator.generatePoToken(videoId, sessionId);
      this.cache.set(videoId, result);
      return result;
    } catch (err: any) {
      // In case BotGuard generation fails (e.g. network rate limit), gracefully return null
      // so fallback clients (ANDROID_VR, TVHTML5, IOS) take over seamlessly.
      return null;
    }
  }

  clear() {
    this.cache.clear();
  }
}

export const defaultPoTokenProvider = new PoTokenProvider();
