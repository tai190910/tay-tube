/**
 * HDR Itag and Codec detection.
 * Ported from YTXTube-2.2.0:
 * com/tensei/ytxtube/HdrFormats.kt and HdrItags.kt
 */

export interface HdrItagEntry {
  itag: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  qualityLabel: string;
}

export const HDR_ITAG_TABLE: Record<number, HdrItagEntry> = {
  337: { itag: 337, height: 2160, fps: 60, codec: 'vp09.02.51.10', bitrate: 24_850_000, qualityLabel: '2160p60 HDR' },
  336: { itag: 336, height: 1440, fps: 60, codec: 'vp09.02.51.10', bitrate: 12_400_000, qualityLabel: '1440p60 HDR' },
  335: { itag: 335, height: 1080, fps: 60, codec: 'vp09.02.51.10', bitrate: 6_900_000, qualityLabel: '1080p60 HDR' },
  334: { itag: 334, height: 720, fps: 60, codec: 'vp09.02.51.10', bitrate: 3_400_000, qualityLabel: '720p60 HDR' },
  701: { itag: 701, height: 2160, fps: 60, codec: 'av01.0.13M.10', bitrate: 20_900_000, qualityLabel: '2160p60 HDR' },
  700: { itag: 700, height: 1440, fps: 60, codec: 'av01.0.09M.10', bitrate: 10_600_000, qualityLabel: '1440p60 HDR' },
  699: { itag: 699, height: 1080, fps: 60, codec: 'av01.0.08M.10', bitrate: 5_800_000, qualityLabel: '1080p60 HDR' },
  698: { itag: 698, height: 720, fps: 60, codec: 'av01.0.05M.10', bitrate: 2_900_000, qualityLabel: '720p60 HDR' },
};

export function isHdrItag(itag: number): boolean {
  return itag in HDR_ITAG_TABLE;
}

export function av1BitDepth(codec: string): number {
  const parts = codec.split('.');
  if (parts.length > 3) {
    const depthStr = parts[3].slice(0, 2);
    const depth = parseInt(depthStr, 10);
    return isNaN(depth) ? 0 : depth;
  }
  return 0;
}

export function isHdrFormat(format: any): boolean {
  if (!format) return false;

  const color = format.colorInfo;
  if (color) {
    const transfer = (color.transferCharacteristics || '').toUpperCase();
    const primaries = (color.primaries || '').toUpperCase();
    if (
      transfer.includes('2084') ||
      transfer.includes('HLG') ||
      transfer.includes('ARIB_STD_B67') ||
      primaries.includes('BT2020')
    ) {
      return true;
    }
  }

  const itag = Number(format.itag);
  if (isHdrItag(itag)) return true;

  const mime = (format.mimeType || '').toLowerCase();
  const codecMatch = mime.match(/codecs="([^"]+)"/);
  const codec = codecMatch ? codecMatch[1] : '';

  if (codec.includes('vp09.02') || codec.includes('vp9.2')) {
    return true;
  }

  if (codec.startsWith('av01') && av1BitDepth(codec) >= 10) {
    return true;
  }

  return false;
}
