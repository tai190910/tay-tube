export interface InnerTubeClientConfig {
  name: string;
  id: string;
  version: string;
  userAgent: string;
  osName: string;
  osVersion: string;
  deviceMake: string;
  deviceModel: string;
  platform: string;
  clientScreen?: string;
}

export const CLIENT_CONFIGS: Record<string, InnerTubeClientConfig> = {
  ANDROID_VR: {
    name: 'ANDROID_VR',
    id: '28',
    version: '1.60.19',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    osName: 'Android',
    osVersion: '12L',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    platform: 'MOBILE',
    clientScreen: 'WATCH',
  },
  ANDROID: {
    name: 'ANDROID',
    id: '3',
    version: '20.10.38',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    osName: 'Android',
    osVersion: '14',
    deviceMake: 'Google',
    deviceModel: 'Pixel 8',
    platform: 'MOBILE',
    clientScreen: 'WATCH',
  },
  IOS: {
    name: 'IOS',
    id: '5',
    version: '21.10.3',
    userAgent:
      'com.google.ios.youtube/21.10.3 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.1.0.22B83',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    platform: 'MOBILE',
    clientScreen: 'WATCH',
  },
  IOS_HDR: {
    name: 'IOS',
    id: '5',
    version: '20.10.4',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,3; U; CPU iOS 18_3_1 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.3.1.22D72',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,3',
    platform: 'MOBILE',
    clientScreen: 'WATCH',
  },
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    id: '85',
    version: '2.0',
    userAgent:
      'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    osName: 'PlayStation',
    osVersion: '12.00',
    deviceMake: 'Sony',
    deviceModel: 'PlayStation 4',
    platform: 'TV',
    clientScreen: 'EMBED',
  },
  TVHTML5: {
    name: 'TVHTML5',
    id: '7',
    version: '7.20260213.00.00',
    userAgent:
      'Mozilla/5.0(SMART-TV; Linux; Tizen 4.0.0.2) AppleWebkit/605.1.15 (KHTML, like Gecko) SamsungBrowser/9.2 TV Safari/605.1.15',
    osName: 'Tizen',
    osVersion: '4.0.0.2',
    deviceMake: 'Samsung',
    deviceModel: 'SmartTV',
    platform: 'TV',
    clientScreen: 'WATCH',
  },
  WEB_EMBEDDED_PLAYER: {
    name: 'WEB_EMBEDDED_PLAYER',
    id: '56',
    version: '1.20260213.00.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    osName: 'Windows',
    osVersion: '10.0',
    deviceMake: '',
    deviceModel: '',
    platform: 'DESKTOP',
    clientScreen: 'EMBED',
  },
  WEB: {
    name: 'WEB',
    id: '1',
    version: '2.20260901.00.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    osName: 'Windows',
    osVersion: '10.0',
    deviceMake: '',
    deviceModel: '',
    platform: 'DESKTOP',
    clientScreen: 'WATCH',
  },
};

export const DEFAULT_USER_AGENT =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

/**
 * Resolves the exact User-Agent matching the YouTube client that generated a googlevideo.com URL.
 * Always prioritizes the signed `c=` query parameter inside the stream URL itself.
 */
export function resolveClientUserAgent(
  urlClientParam?: string | null,
  hintClientParam?: string | null
): { clientName: string; userAgent: string } {
  const rawName = (urlClientParam || hintClientParam || 'ANDROID_VR').toUpperCase();

  if (CLIENT_CONFIGS[rawName]) {
    return {
      clientName: rawName,
      userAgent: CLIENT_CONFIGS[rawName].userAgent,
    };
  }
  if (rawName.includes('IOS')) {
    return { clientName: 'IOS', userAgent: CLIENT_CONFIGS.IOS.userAgent };
  }
  if (rawName.includes('ANDROID_VR') || rawName.includes('VR')) {
    return { clientName: 'ANDROID_VR', userAgent: CLIENT_CONFIGS.ANDROID_VR.userAgent };
  }
  if (rawName.includes('ANDROID')) {
    return { clientName: 'ANDROID', userAgent: CLIENT_CONFIGS.ANDROID.userAgent };
  }
  if (rawName.includes('TVHTML5_SIMPLY')) {
    return {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      userAgent: CLIENT_CONFIGS.TVHTML5_SIMPLY_EMBEDDED_PLAYER.userAgent,
    };
  }
  if (rawName.includes('TV')) {
    return { clientName: 'TVHTML5', userAgent: CLIENT_CONFIGS.TVHTML5.userAgent };
  }

  return {
    clientName: 'ANDROID_VR',
    userAgent: CLIENT_CONFIGS.ANDROID_VR.userAgent,
  };
}
