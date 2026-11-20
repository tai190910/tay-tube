/**
 * JavaScript & cryptographic utilities for YouTube BotGuard / PoToken generation.
 * Reconstructed from YTXTube-2.2.0:
 * com/tensei/ytxtube/potoken/JavaScriptUtil.kt
 */

export interface ParsedChallengeData {
  messageId: string;
  interpreterJavascript: {
    privateDoNotAccessOrElseSafeScriptWrappedValue: string | null;
    privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string | null;
  };
  interpreterHash: string;
  program: string;
  globalName: string;
  clientExperimentsStateBlob: string;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  // Convert URL-safe base64 / standard base64
  let base64Mod = base64.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
  // Pad if needed
  while (base64Mod.length % 4 !== 0) {
    base64Mod += '=';
  }
  const binaryString = Buffer.from(base64Mod, 'base64');
  return new Uint8Array(binaryString);
}

export function descramble(scrambledChallenge: string): string {
  const bytes = base64ToUint8Array(scrambledChallenge);
  const descrambled = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    // (bytes[i] + 97) & 0xff
    descrambled[i] = (bytes[i] + 97) & 0xff;
  }
  return Buffer.from(descrambled).toString('utf-8');
}

export function parseChallengeData(rawChallengeData: string): ParsedChallengeData {
  const scrambled = typeof rawChallengeData === 'string' ? JSON.parse(rawChallengeData) : rawChallengeData;

  let challengeData: any[];
  if (Array.isArray(scrambled) && scrambled.length > 1 && scrambled[1]) {
    const descrambledJson = descramble(scrambled[1]);
    challengeData = JSON.parse(descrambledJson);
  } else if (Array.isArray(scrambled)) {
    challengeData = scrambled[0];
  } else {
    throw new Error('Invalid raw challenge data structure');
  }

  const messageId = challengeData[0];
  const interpreterHash = challengeData[3];
  const program = challengeData[4];
  const globalName = challengeData[5];
  const clientExperimentsStateBlob = challengeData[7];

  let privateDoNotAccessOrElseSafeScriptWrappedValue: string | null = null;
  let privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string | null = null;

  if (Array.isArray(challengeData[1])) {
    for (const item of challengeData[1]) {
      if (typeof item === 'string') {
        privateDoNotAccessOrElseSafeScriptWrappedValue = item;
        break;
      }
    }
  }

  if (Array.isArray(challengeData[2])) {
    for (const item of challengeData[2]) {
      if (typeof item === 'string') {
        privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = item;
        break;
      }
    }
  }

  return {
    messageId,
    interpreterJavascript: {
      privateDoNotAccessOrElseSafeScriptWrappedValue,
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue,
    },
    interpreterHash,
    program,
    globalName,
    clientExperimentsStateBlob,
  };
}

export function parseIntegrityTokenData(rawIntegrityTokenData: string | any[]): {
  integrityTokenU8: Uint8Array;
  expirationTimeInSeconds: number;
} {
  const integrityData =
    typeof rawIntegrityTokenData === 'string'
      ? JSON.parse(rawIntegrityTokenData)
      : rawIntegrityTokenData;

  const base64Str = integrityData[0];
  const expirationSeconds = Number(integrityData[1]);
  return {
    integrityTokenU8: base64ToUint8Array(base64Str),
    expirationTimeInSeconds: expirationSeconds,
  };
}

export function u8ToBase64Url(u8: Uint8Array | number[]): string {
  const buf = Buffer.from(u8);
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function stringToU8(identifier: string): Uint8Array {
  return new Uint8Array(Buffer.from(identifier, 'utf-8'));
}
