export interface VideoChapter {
  startSec: number;
  timestampText: string;
  title: string;
}

export type DescriptionToken =
  | { type: 'text'; text: string }
  | { type: 'timestamp'; text: string; seconds: number }
  | { type: 'url'; text: string; href: string };

/**
 * Parses `MM:SS`, `M:SS`, `HH:MM:SS`, or `H:MM:SS` into total integer seconds.
 */
export function parseTimestampToSeconds(raw: string): number | null {
  const match = raw.trim().match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function splitTrailingUrlPunctuation(rawUrl: string): { cleanUrl: string; trailing: string } {
  let cleanUrl = rawUrl;
  let trailing = '';

  const bracketPairs: Array<[string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];

  while (cleanUrl.length > 0) {
    const lastChar = cleanUrl[cleanUrl.length - 1];
    if ('.,;:!?'.includes(lastChar)) {
      trailing = lastChar + trailing;
      cleanUrl = cleanUrl.slice(0, -1);
      continue;
    }

    const pair = bracketPairs.find(([, close]) => close === lastChar);
    if (pair) {
      const [open, close] = pair;
      let openCount = 0;
      let closeCount = 0;
      for (const ch of cleanUrl) {
        if (ch === open) openCount++;
        else if (ch === close) closeCount++;
      }
      if (closeCount > openCount) {
        trailing = lastChar + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { cleanUrl, trailing };
}

/**
 * Splits a single description line into plain text, interactive timestamp links, and URLs.
 */
export function tokenizeDescriptionLine(
  line: string,
  maxDurationSec?: number
): DescriptionToken[] {
  if (!line) return [];

  const tokens: DescriptionToken[] = [];
  const pattern = /(https?:\/\/[^\s<>]+)|(\b(?:\d{1,2}:)?[0-5]?\d:[0-5]\d\b)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === 'text') {
      prev.text += text;
    } else {
      tokens.push({ type: 'text', text });
    }
  };

  while ((match = pattern.exec(line)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];
    const matchEnd = matchStart + matchText.length;

    if (matchStart > lastIndex) {
      pushText(line.slice(lastIndex, matchStart));
    }

    if (match[1]) {
      const { cleanUrl, trailing } = splitTrailingUrlPunctuation(match[1]);
      if (cleanUrl) {
        tokens.push({ type: 'url', text: cleanUrl, href: cleanUrl });
      }
      if (trailing) {
        pushText(trailing);
      }
    } else if (match[2]) {
      const prevChar = matchStart > 0 ? line[matchStart - 1] : '';
      const nextChar = matchEnd < line.length ? line[matchEnd] : '';
      const hasInvalidNeighbor = /[:\d.]/.test(prevChar) || /[:\d.]/.test(nextChar);
      const sec = hasInvalidNeighbor ? null : parseTimestampToSeconds(match[2]);
      const withinDuration = !maxDurationSec || maxDurationSec <= 0 || (sec !== null && sec <= maxDurationSec);

      if (sec !== null && withinDuration) {
        tokens.push({ type: 'timestamp', text: match[2], seconds: sec });
      } else {
        pushText(matchText);
      }
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < line.length) {
    pushText(line.slice(lastIndex));
  }

  return tokens;
}

function cleanChapterTitle(rawTitle: string): string {
  let cleaned = rawTitle
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/^[\s\-–—:|•·/\\.,]+/, '')
    .replace(/[\s\-–—:|•·/\\]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading numbered/bulleted prefix and any remaining separator punctuation
  cleaned = cleaned
    .replace(/^(?:\d+[.)]\s*|[-–—•·]\s*)/, '')
    .replace(/^[\s\-–—:|•·/\\.,]+/, '')
    .trim();

  if (cleaned.length > 120) {
    cleaned = `${cleaned.slice(0, 117).trimEnd()}...`;
  }
  return cleaned;
}

/**
 * Extracts ordered video chapters from description lines containing timestamps + titles.
 */
export function extractChaptersFromDescription(
  description: string,
  maxDurationSec?: number
): VideoChapter[] {
  if (!description) return [];

  const chaptersBySec = new Map<number, VideoChapter>();
  const lines = description.split(/\r?\n/);

  for (const rawLine of lines) {
    const tokens = tokenizeDescriptionLine(rawLine, maxDurationSec);
    const tsIdx = tokens.findIndex((t) => t.type === 'timestamp');
    if (tsIdx === -1) continue;

    const tsToken = tokens[tsIdx];
    if (tsToken.type !== 'timestamp') continue;

    // Combine non-timestamp, non-URL text on the line
    const beforeParts = tokens
      .slice(0, tsIdx)
      .filter((t) => t.type !== 'url')
      .map((t) => t.text)
      .join('');
    const afterParts = tokens
      .slice(tsIdx + 1)
      .filter((t) => t.type !== 'url')
      .map((t) => t.text)
      .join('');

    const combined = `${beforeParts.replace(/[(\[]\s*$/, '')} ${afterParts.replace(/^\s*[)\]]/, '')}`;
    const title = cleanChapterTitle(combined);
    if (!title) continue;

    if (!chaptersBySec.has(tsToken.seconds)) {
      chaptersBySec.set(tsToken.seconds, {
        startSec: tsToken.seconds,
        timestampText: tsToken.text,
        title,
      });
    }
  }

  return Array.from(chaptersBySec.values()).sort((a, b) => a.startSec - b.startSec);
}

/**
 * Returns the chapter active at `currentSec` using a small 0.25s boundary tolerance.
 */
export function findActiveChapter(chapters: VideoChapter[], currentSec: number): VideoChapter | null {
  if (chapters.length === 0) return null;
  let active: VideoChapter | null = null;
  const threshold = currentSec + 0.25;
  for (const ch of chapters) {
    if (ch.startSec <= threshold) {
      active = ch;
    } else {
      break;
    }
  }
  return active;
}

function parseYouTubeTimeParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  if (/^\d+s$/.test(trimmed)) {
    return parseInt(trimmed.slice(0, -1), 10);
  }
  const hmsMatch = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
    const h = hmsMatch[1] ? parseInt(hmsMatch[1], 10) : 0;
    const m = hmsMatch[2] ? parseInt(hmsMatch[2], 10) : 0;
    const s = hmsMatch[3] ? parseInt(hmsMatch[3], 10) : 0;
    return h * 3600 + m * 60 + s;
  }
  return undefined;
}

/**
 * Recognizes internal YouTube video links and optional `t=` start offsets.
 */
export function extractYouTubeLinkTarget(
  href: string
): { videoId: string; startSec?: number } | null {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0];
      if (seg && /^[A-Za-z0-9_-]{11}$/.test(seg)) {
        videoId = seg;
      }
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
        videoId = vParam;
      } else {
        const segs = url.pathname.split('/').filter(Boolean);
        if (
          segs.length >= 2 &&
          ['shorts', 'live', 'embed'].includes(segs[0]) &&
          /^[A-Za-z0-9_-]{11}$/.test(segs[1])
        ) {
          videoId = segs[1];
        }
      }
    }

    if (!videoId) return null;
    const startSec = parseYouTubeTimeParam(url.searchParams.get('t') || url.searchParams.get('start'));
    return { videoId, startSec };
  } catch {
    return null;
  }
}
