export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleFetchResult {
  cues: SubtitleCue[];
  skippedLarge: boolean;
  sizeBytes: number;
}

export interface SubtitleFetchOptions {
  /** If false (default for auto-load), skip files larger than maxAutoSizeBytes without parsing */
  allowLarge?: boolean;
  /** Size threshold in bytes above which auto-enabling is skipped (default: 500KB) */
  maxAutoSizeBytes?: number;
  /** Optional AbortSignal to cancel fetching/parsing when user navigates away */
  signal?: AbortSignal;
}

const DEFAULT_MAX_AUTO_BYTES = 500 * 1024; // 500KB
const ASYNC_LINES_PER_TICK = 1500;

export class SubtitleParser {
  /**
   * Fetches and parses subtitles asynchronously without blocking the UI thread.
   * When allowLarge is false (default on initial video open), files > 500KB are NOT parsed
   * so ultra-long videos (19-37h) never freeze the Main Thread.
   * When allowLarge is true (user explicitly clicks CC), parses in non-blocking chunks.
   */
  static async fetchAndParseAsync(
    url: string,
    options?: SubtitleFetchOptions
  ): Promise<SubtitleFetchResult> {
    const allowLarge = options?.allowLarge ?? false;
    const maxAutoSizeBytes = options?.maxAutoSizeBytes ?? DEFAULT_MAX_AUTO_BYTES;
    const signal = options?.signal;

    try {
      const isLocalProxy = url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
      const res = await fetch(url, isLocalProxy
        ? { signal }
        : {
            signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Origin': 'https://www.youtube.com',
              'Referer': 'https://www.youtube.com/',
            },
          });

      if (!res.ok || signal?.aborted) {
        return { cues: [], skippedLarge: false, sizeBytes: 0 };
      }

      const clHeader = res.headers.get('content-length');
      const headerSize = clHeader ? parseInt(clHeader, 10) : 0;
      if (!allowLarge && headerSize > maxAutoSizeBytes) {
        return { cues: [], skippedLarge: true, sizeBytes: headerSize };
      }

      const text = await res.text();
      if (signal?.aborted) {
        return { cues: [], skippedLarge: false, sizeBytes: text.length };
      }

      const sizeBytes = headerSize || text.length;
      if (!allowLarge && text.length > maxAutoSizeBytes) {
        return { cues: [], skippedLarge: true, sizeBytes };
      }

      const cues = await this.parseAsync(text, signal);
      return { cues, skippedLarge: false, sizeBytes };
    } catch {
      return { cues: [], skippedLarge: false, sizeBytes: 0 };
    }
  }

  /**
   * Backwards-compatible wrapper.
   */
  static async fetchAndParse(url: string, maxSizeBytes = DEFAULT_MAX_AUTO_BYTES): Promise<SubtitleCue[]> {
    const result = await this.fetchAndParseAsync(url, {
      allowLarge: false,
      maxAutoSizeBytes: maxSizeBytes,
    });
    return result.cues;
  }

  /**
   * Non-blocking async parser for VTT, TTML, or XML subtitles.
   */
  static async parseAsync(raw: string, signal?: AbortSignal): Promise<SubtitleCue[]> {
    if (!raw || !raw.trim()) return [];
    const trimmed = raw.trim();

    if (trimmed.startsWith('WEBVTT') || trimmed.includes('-->')) {
      return this.parseVttAsync(trimmed, signal);
    }
    if (trimmed.includes('<p ') || trimmed.includes('<p>')) {
      return this.parseTtml(trimmed);
    }
    if (trimmed.includes('<text ')) {
      return this.parseXml(trimmed);
    }
    return [];
  }

  /**
   * Synchronous parser for small inputs.
   */
  static parse(raw: string): SubtitleCue[] {
    if (!raw || !raw.trim()) return [];
    const trimmed = raw.trim();

    if (trimmed.startsWith('WEBVTT') || trimmed.includes('-->')) {
      return this.parseVttSync(trimmed);
    }
    if (trimmed.includes('<p ') || trimmed.includes('<p>')) {
      return this.parseTtml(trimmed);
    }
    if (trimmed.includes('<text ')) {
      return this.parseXml(trimmed);
    }
    return [];
  }

  /**
   * Regex-free HTML tag stripper and entity decoder.
   */
  private static cleanText(text: string): string {
    let stripped = text;
    if (text.includes('<')) {
      let out = '';
      let inTag = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 60) { // '<'
          inTag = true;
        } else if (ch === 62) { // '>'
          inTag = false;
        } else if (!inTag) {
          out += text[i];
        }
      }
      stripped = out;
    }

    if (!stripped.includes('&')) {
      return stripped.trim();
    }

    return stripped
      .split('&amp;').join('&')
      .split('&#39;').join("'")
      .split('&apos;').join("'")
      .split('&quot;').join('"')
      .split('&lt;').join('<')
      .split('&gt;').join('>')
      .split('&#10;').join('\n')
      .trim();
  }

  /**
   * Finds first whitespace character index without RegExp.
   */
  private static findFirstSpace(str: string): number {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c === 32 || c === 9 || c === 13) return i;
    }
    return -1;
  }

  /**
   * Non-blocking chunked WebVTT parser using simple split('\n') + indexOf('-->').
   * Yields back to the event loop every 1500 lines so Main Thread stays responsive.
   */
  private static async parseVttAsync(vtt: string, signal?: AbortSignal): Promise<SubtitleCue[]> {
    const cues: SubtitleCue[] = [];
    const lines = vtt.split('\n');
    const totalLines = lines.length;

    let currentStartMs: number | null = null;
    let currentEndMs: number | null = null;
    let textBuffer: string[] = [];

    for (let i = 0; i < totalLines; i++) {
      if (i > 0 && i % ASYNC_LINES_PER_TICK === 0) {
        if (signal?.aborted) return [];
        await new Promise<void>((r) => setTimeout(r, 0));
        if (signal?.aborted) return [];
      }

      const line = lines[i].trim();

      if (!line) {
        if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
          const text = textBuffer.join(' ').trim();
          if (text) {
            cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
          }
        }
        currentStartMs = null;
        currentEndMs = null;
        textBuffer = [];
        continue;
      }

      const arrowIndex = line.indexOf('-->');
      if (arrowIndex !== -1) {
        if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
          const text = textBuffer.join(' ').trim();
          if (text) {
            cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
          }
        }
        textBuffer = [];

        const startStr = line.slice(0, arrowIndex).trim();
        const rest = line.slice(arrowIndex + 3).trim();
        const spaceIdx = this.findFirstSpace(rest);
        const endStr = spaceIdx !== -1 ? rest.slice(0, spaceIdx) : rest;

        currentStartMs = this.parseTimestamp(startStr);
        currentEndMs = this.parseTimestamp(endStr);
        continue;
      }

      if (line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('Kind:') || line.startsWith('Language:')) {
        continue;
      }

      if (currentStartMs !== null && currentEndMs !== null) {
        const cleaned = this.cleanText(line);
        if (cleaned) {
          textBuffer.push(cleaned);
        }
      }
    }

    if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
      const text = textBuffer.join(' ').trim();
      if (text) {
        cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
      }
    }

    cues.sort((a, b) => a.startMs - b.startMs);
    return cues;
  }

  private static parseVttSync(vtt: string): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const lines = vtt.split('\n');
    const totalLines = lines.length;

    let currentStartMs: number | null = null;
    let currentEndMs: number | null = null;
    let textBuffer: string[] = [];

    for (let i = 0; i < totalLines; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
          const text = textBuffer.join(' ').trim();
          if (text) cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
        }
        currentStartMs = null;
        currentEndMs = null;
        textBuffer = [];
        continue;
      }

      const arrowIndex = line.indexOf('-->');
      if (arrowIndex !== -1) {
        if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
          const text = textBuffer.join(' ').trim();
          if (text) cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
        }
        textBuffer = [];

        const startStr = line.slice(0, arrowIndex).trim();
        const rest = line.slice(arrowIndex + 3).trim();
        const spaceIdx = this.findFirstSpace(rest);
        const endStr = spaceIdx !== -1 ? rest.slice(0, spaceIdx) : rest;

        currentStartMs = this.parseTimestamp(startStr);
        currentEndMs = this.parseTimestamp(endStr);
        continue;
      }

      if (line === 'WEBVTT' || line.startsWith('NOTE') || line.startsWith('STYLE')) {
        continue;
      }

      if (currentStartMs !== null && currentEndMs !== null) {
        const cleaned = this.cleanText(line);
        if (cleaned) textBuffer.push(cleaned);
      }
    }

    if (currentStartMs !== null && currentEndMs !== null && textBuffer.length > 0) {
      const text = textBuffer.join(' ').trim();
      if (text) cues.push({ startMs: currentStartMs, endMs: currentEndMs, text });
    }

    cues.sort((a, b) => a.startMs - b.startMs);
    return cues;
  }

  private static parseTtml(xml: string): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const pMsRegex = /<p\s+[^>]*t="(\d+)"[^>]*d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match: RegExpExecArray | null;
    while ((match = pMsRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durMs = parseInt(match[2], 10);
      const text = this.cleanText(match[3] || '');
      if (text) cues.push({ startMs, endMs: startMs + durMs, text });
    }

    if (cues.length > 0) return cues;

    const pTimeRegex = /<p\s+[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;
    while ((match = pTimeRegex.exec(xml)) !== null) {
      const startMs = this.parseTimestamp(match[1]);
      const endMs = this.parseTimestamp(match[2]);
      if (startMs === null || endMs === null) continue;
      const text = this.cleanText(match[3] || '');
      if (text) cues.push({ startMs, endMs, text });
    }

    return cues;
  }

  private static parseXml(xml: string): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const textRegex = /<text\s+[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;

    while ((match = textRegex.exec(xml)) !== null) {
      const startSec = parseFloat(match[1]);
      const durSec = parseFloat(match[2]);
      if (isNaN(startSec) || isNaN(durSec)) continue;

      const startMs = Math.round(startSec * 1000);
      const endMs = startMs + Math.round(durSec * 1000);
      const text = this.cleanText(match[3] || '');
      if (text) cues.push({ startMs, endMs, text });
    }

    return cues;
  }

  private static parseTimestamp(raw: string): number | null {
    let cleaned = raw.trim();
    if (!cleaned) return null;
    if (cleaned.endsWith('s')) {
      cleaned = cleaned.slice(0, -1);
    }
    const parts = cleaned.split(':');

    try {
      if (parts.length === 1) {
        const val = parseFloat(parts[0].replace(',', '.'));
        return isNaN(val) ? null : Math.round(val * 1000);
      } else if (parts.length === 2) {
        const min = parseInt(parts[0], 10);
        const sec = parseFloat(parts[1].replace(',', '.'));
        return isNaN(min) || isNaN(sec) ? null : Math.round(min * 60000 + sec * 1000);
      } else if (parts.length === 3) {
        const hr = parseInt(parts[0], 10);
        const min = parseInt(parts[1], 10);
        const sec = parseFloat(parts[2].replace(',', '.'));
        return isNaN(hr) || isNaN(min) || isNaN(sec)
          ? null
          : Math.round(hr * 3600000 + min * 60000 + sec * 1000);
      }
    } catch {
      return null;
    }
    return null;
  }
}
