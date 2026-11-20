import vm from 'node:vm';
import {
  parseChallengeData,
  parseIntegrityTokenData,
  u8ToBase64Url,
  stringToU8,
} from './js-util.js';

export interface PoTokenResult {
  playerRequestPoToken: string;
  streamingDataPoToken: string;
  visitorData?: string;
  mintedAt: number;
}

const GOOGLE_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.3';

export class PoTokenGenerator {
  private minter: ((identifier: Uint8Array) => Uint8Array) | null = null;
  private streamingPot: string | null = null;
  private sessionId: string | null = null;
  private expirationTime: number = 0;
  private isInitializing: Promise<void> | null = null;

  get isExpired(): Boolean {
    return Date.now() > this.expirationTime;
  }

  /**
   * Initializes BotGuard via JNN Create -> VM Execution -> GenerateIT -> createPoTokenMinter
   */
  async initialize(sessionId?: string): Promise<void> {
    if (this.isInitializing) return this.isInitializing;

    this.isInitializing = (async () => {
      try {
        this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Step 1: JNN Create
        const createRes = await fetch('https://www.youtube.com/api/jnn/v1/Create', {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
            'Content-Type': 'application/json+protobuf',
            'x-goog-api-key': GOOGLE_API_KEY,
            'x-user-agent': 'grpc-web-javascript/0.1',
          },
          body: JSON.stringify([REQUEST_KEY]),
        });

        if (!createRes.ok) {
          throw new Error(`JNN Create failed with status: ${createRes.status}`);
        }

        const createBody = await createRes.text();
        const challenge = parseChallengeData(createBody);

        // Step 2: Run BotGuard in isolated Node VM environment
        const { botguardResponse, webPoSignalOutput } = await this.runBotGuardInVm(challenge);

        // Step 3: JNN GenerateIT
        const generateRes = await fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
            'Content-Type': 'application/json+protobuf',
            'x-goog-api-key': GOOGLE_API_KEY,
            'x-user-agent': 'grpc-web-javascript/0.1',
          },
          body: JSON.stringify([REQUEST_KEY, botguardResponse]),
        });

        if (!generateRes.ok) {
          throw new Error(`JNN GenerateIT failed with status: ${generateRes.status}`);
        }

        const generateBody = await generateRes.text();
        const { integrityTokenU8, expirationTimeInSeconds } = parseIntegrityTokenData(generateBody);

        this.expirationTime = Date.now() + Math.max(expirationTimeInSeconds - 600, 3600) * 1000;

        // Step 4: Create PoToken Minter from webPoSignalOutput
        const getMinter = webPoSignalOutput[0];
        if (typeof getMinter !== 'function') {
          throw new Error('BotGuard webPoSignalOutput[0] is not a function');
        }

        const minterFunc = getMinter(integrityTokenU8);
        if (typeof minterFunc !== 'function') {
          throw new Error('BotGuard minter generator did not return a function');
        }

        this.minter = minterFunc;

        // Step 5: Mint streaming POT for current session
        const sessionU8 = stringToU8(this.sessionId);
        const streamingPotU8 = this.minter!(sessionU8);
        this.streamingPot = u8ToBase64Url(streamingPotU8);
      } catch (err: any) {
        // Clear minter on failure
        this.minter = null;
        this.streamingPot = null;
        throw err;
      } finally {
        this.isInitializing = null;
      }
    })();

    return this.isInitializing;
  }

  /**
   * Execute BotGuard interpreter in Node.js VM context simulating a browser DOM.
   */
  private async runBotGuardInVm(challenge: ReturnType<typeof parseChallengeData>): Promise<{
    botguardResponse: string;
    webPoSignalOutput: any[];
  }> {
    const sandbox: Record<string, any> = {
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Uint8Array,
      Array,
      Object,
      Function,
      String,
      Number,
      Boolean,
      Math,
      Date,
      RegExp,
      Promise,
      Buffer,
    };

    // Minimal browser mock for BotGuard fingerprinting
    const mockWindow: Record<string, any> = {
      location: {
        href: 'https://www.youtube.com/',
        hostname: 'www.youtube.com',
        origin: 'https://www.youtube.com',
        protocol: 'https:',
      },
      navigator: {
        userAgent: USER_AGENT,
        language: 'vi-VN',
        languages: ['vi-VN', 'vi', 'en-US', 'en'],
        platform: 'Win32',
        vendor: 'Google Inc.',
        cookieEnabled: true,
      },
      document: {
        referrer: '',
        documentElement: {},
        createElement: () => ({
          setAttribute: () => {},
          appendChild: () => {},
          style: {},
        }),
        getElementsByTagName: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      screen: {
        width: 1920,
        height: 1080,
        availWidth: 1920,
        availHeight: 1040,
        colorDepth: 24,
      },
      history: { length: 2 },
      performance: { now: () => Date.now() },
    };

    sandbox.window = mockWindow;
    sandbox.document = mockWindow.document;
    sandbox.navigator = mockWindow.navigator;
    sandbox.screen = mockWindow.screen;
    sandbox.location = mockWindow.location;
    sandbox.self = mockWindow;
    sandbox.globalThis = mockWindow;

    const context = vm.createContext(sandbox);

    const scriptCode = challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!scriptCode) {
      throw new Error('No interpreter JavaScript in challenge');
    }

    // Execute interpreter
    vm.runInContext(scriptCode, context);

    // Now execute program loading and snapshot
    const runnerScript = `
      (function() {
        return new Promise(function(resolve, reject) {
          try {
            var globalObj = window;
            var vmInstance = globalObj["${challenge.globalName}"];
            if (!vmInstance || !vmInstance.a) {
              return reject(new Error('Could not find BotGuard VM object'));
            }

            var vmFunctions = {};
            var callback = function(asyncSnapshot, shutdown, passEvent, checkCamera) {
              vmFunctions.asyncSnapshot = asyncSnapshot;
              vmFunctions.shutdown = shutdown;
              vmFunctions.passEvent = passEvent;
              vmFunctions.checkCamera = checkCamera;
            };

            var syncSnapshot = vmInstance.a("${challenge.program}", callback, true, null, function() {}, [ [], [] ])[0];

            var startTime = Date.now();
            var interval = setInterval(function() {
              if (vmFunctions.asyncSnapshot) {
                clearInterval(interval);
                var webPoSignalOutput = [];
                vmFunctions.asyncSnapshot(function(response) {
                  resolve({
                    botguardResponse: response,
                    webPoSignalOutput: webPoSignalOutput
                  });
                }, [null, null, webPoSignalOutput, false]);
              } else if (Date.now() - startTime > 10000) {
                clearInterval(interval);
                reject(new Error('asyncSnapshot timeout'));
              }
            }, 10);
          } catch(e) {
            reject(e);
          }
        });
      })()
    `;

    return await vm.runInContext(runnerScript, context);
  }

  /**
   * Generates a PoToken for the given videoId.
   */
  async generatePoToken(videoId: string, sessionId?: string): Promise<PoTokenResult> {
    if (!this.minter || this.isExpired) {
      await this.initialize(sessionId);
    }

    if (!this.minter) {
      throw new Error('PoToken minter not available');
    }

    const videoU8 = stringToU8(videoId);
    const playerPotU8 = this.minter(videoU8);
    const playerRequestPoToken = u8ToBase64Url(playerPotU8);

    return {
      playerRequestPoToken,
      streamingDataPoToken: this.streamingPot || playerRequestPoToken,
      visitorData: this.sessionId || undefined,
      mintedAt: Date.now(),
    };
  }
}
