import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream';
import { URL } from 'node:url';
import { CLIENT_CONFIGS, resolveClientUserAgent } from '../clients/client-configs.js';
import { defaultPlayerFallback } from '../extractor/player-fallback.js';

export interface ChunkedProxyOptions {
  port?: number;
  host?: string;
}

// 2MB chunk cap for direct Range requests so ultra-long 19-37h videos never overflow RAM
const MAX_RANGE_CHUNK_BYTES = 2 * 1024 * 1024; // 2,097,152 bytes

export class ChunkedRangeProxyServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private host: string = '127.0.0.1';

  // Persistent keepAlive agents with infinite timeout
  private httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 0,
  });

  private httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 0,
  });

  constructor(options?: ChunkedProxyOptions) {
    if (options?.port) this.port = options.port;
    if (options?.host) this.host = options.host;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Proxy Error: ${err.message}`);
          }
        });
      });

      this.server.timeout = 0;
      this.server.keepAliveTimeout = 60000;
      this.server.headersTimeout = 0;

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          resolve(this.port);
        }
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Generates a proxy stream URL for a given target googlevideo stream URL.
   */
  getProxyUrl(targetUrl: string, clientName?: string, videoId?: string, itag?: number): string {
    const encoded = encodeURIComponent(targetUrl);
    const clientParam = clientName ? `&client=${encodeURIComponent(clientName)}` : '';
    const idParam = videoId ? `&id=${encodeURIComponent(videoId)}` : '';
    const itagParam = itag ? `&itag=${itag}` : '';
    return `http://${this.host}:${this.port}/stream?url=${encoded}${clientParam}${idParam}${itagParam}`;
  }

  /**
   * Generates a proxy HLS master playlist URL for a given video ID and target HLS URL.
   */
  getHlsUrl(videoId: string, targetHlsUrl?: string): string {
    const urlParam = targetHlsUrl ? `url=${encodeURIComponent(targetHlsUrl)}&` : '';
    return `http://${this.host}:${this.port}/hls-manifest?${urlParam}id=${encodeURIComponent(videoId)}`;
  }

  /**
   * Normalizes and bounds open-ended or oversized Range headers into 2MB chunks
   * so seeking 19-37 hour videos never overflows RAM or triggers open-range 403 blocks.
   */
  private buildChunkedRangeHeader(rawRange: string | undefined, targetUrl: URL): string | undefined {
    const isDiscreteHlsSegment =
      targetUrl.pathname.includes('/gosq/') ||
      targetUrl.pathname.endsWith('.ts') ||
      targetUrl.pathname.includes('/slices=');

    if (!rawRange) {
      if (isDiscreteHlsSegment) {
        return undefined;
      }
      rawRange = 'bytes=0-';
    }

    const match = rawRange.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return rawRange;
    }

    const start = parseInt(match[1], 10);
    const requestedEnd = match[2] ? parseInt(match[2], 10) : null;
    const clenParam = targetUrl.searchParams.get('clen');
    const totalSize = clenParam ? parseInt(clenParam, 10) : null;

    let end: number;
    if (requestedEnd === null || requestedEnd - start + 1 > MAX_RANGE_CHUNK_BYTES) {
      end = start + MAX_RANGE_CHUNK_BYTES - 1;
    } else {
      end = requestedEnd;
    }

    if (totalSize && !isNaN(totalSize) && totalSize > 0 && end >= totalSize) {
      end = totalSize - 1;
    }

    return end >= start ? `bytes=${start}-${end}` : `bytes=${start}-`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    req.socket.setTimeout(0);
    res.socket?.setTimeout(0);
    req.socket.setKeepAlive(true, 10000);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, User-Agent, Accept, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedReqUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);

    // =========================================================================
    // ENDPOINT 1: /hls-manifest (and alias /hls.m3u8) -> YouTube Official HLS Proxy & Rewriter
    // =========================================================================
    if (parsedReqUrl.pathname === '/hls-manifest' || parsedReqUrl.pathname === '/hls.m3u8') {
      const videoId = parsedReqUrl.searchParams.get('id') || '';
      let targetHlsUrl = parsedReqUrl.searchParams.get('url');

      if (!targetHlsUrl && videoId) {
        try {
          const iosData = await defaultPlayerFallback.fetchIosStreamingData(videoId);
          targetHlsUrl = iosData.hlsManifestUrl || null;
        } catch {
          targetHlsUrl = null;
        }
      }

      if (!targetHlsUrl) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('HLS Manifest URL not found for video');
        return;
      }

      try {
        const { text: rawM3u8, finalUrl } = await this.fetchRawM3u8(targetHlsUrl, 3);
        const m3u8 = this.rewriteM3u8(rawM3u8, finalUrl, videoId);

        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Content-Length': Buffer.byteLength(m3u8, 'utf-8').toString(),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(m3u8);
        return;
      } catch (err: any) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Failed to fetch HLS manifest: ${err.message}`);
        return;
      }
    }

    // =========================================================================
    // ENDPOINT 2: /stream -> Chunked Range & Direct Pass-Through to googlevideo.com
    // =========================================================================
    if (parsedReqUrl.pathname !== '/stream') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found. Use /hls-manifest or /stream');
      return;
    }

    const targetUrl = parsedReqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return;
    }

    let cleanTargetUrl: URL;
    try {
      cleanTargetUrl = new URL(targetUrl);
      cleanTargetUrl.searchParams.delete('range');
      cleanTargetUrl.searchParams.delete('rn');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid url parameter');
      return;
    }

    const videoId = parsedReqUrl.searchParams.get('id') || undefined;
    const itagParam = parsedReqUrl.searchParams.get('itag') || cleanTargetUrl.searchParams.get('itag');
    const itag = itagParam ? parseInt(itagParam, 10) : undefined;

    // Prioritize the `c=` client parameter embedded inside the signed googlevideo.com URL
    const urlClient = cleanTargetUrl.searchParams.get('c');
    const paramClient = parsedReqUrl.searchParams.get('client');
    const { clientName, userAgent } = resolveClientUserAgent(urlClient, paramClient);

    const rangeHeader = this.buildChunkedRangeHeader(req.headers['range'], cleanTargetUrl);

    await this.pipeStreamToGoogle(
      cleanTargetUrl.toString(),
      rangeHeader,
      clientName,
      userAgent,
      req,
      res,
      3,
      { videoId, itag, allowClientFallback: true }
    );
  }

  /**
   * Streams data from googlevideo.com to the client with:
   * - Exact User-Agent matching the client that created the URL
   * - 2MB chunked Range headers to prevent RAM overflow on 19-37h videos
   * - Automatic fallback to alternative InnerTube client if HTTP 403 occurs
   * - Detailed error logging to terminal when upstream returns status >= 400
   */
  private async pipeStreamToGoogle(
    targetUrl: string,
    rangeHeader: string | undefined,
    clientName: string,
    userAgent: string,
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
    maxRedirects: number = 3,
    fallbackCtx?: { videoId?: string; itag?: number; allowClientFallback?: boolean }
  ): Promise<void> {
    return new Promise((resolve) => {
      let isResolved = false;
      const done = () => {
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      };

      if (clientRes.writableEnded || clientRes.destroyed) {
        return done();
      }

      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch (err: any) {
        if (!clientRes.headersSent) {
          clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
          clientRes.end(`Invalid remote URL: ${err.message}`);
        }
        return done();
      }

      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const agent = isHttps ? this.httpsAgent : this.httpAgent;

      const abortController = new AbortController();
      const upstreamHeaders: Record<string, string> = {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
      };
      if (rangeHeader) {
        upstreamHeaders['Range'] = rangeHeader;
      }

      const remoteReq = lib.request(
        parsed.toString(),
        {
          method: clientReq.method || 'GET',
          agent,
          signal: abortController.signal,
          headers: upstreamHeaders,
        },
        (remoteRes) => {
          const rawStatus = remoteRes.statusCode || 200;

          // Follow Google CDN 301/302/307/308 redirects
          if (
            (rawStatus === 301 || rawStatus === 302 || rawStatus === 307 || rawStatus === 308) &&
            remoteRes.headers.location &&
            maxRedirects > 0
          ) {
            clientRes.removeListener('close', onClientClose);
            remoteRes.destroy();
            const nextUrl = new URL(remoteRes.headers.location, parsed).toString();
            this.pipeStreamToGoogle(
              nextUrl,
              rangeHeader,
              clientName,
              userAgent,
              clientReq,
              clientRes,
              maxRedirects - 1,
              fallbackCtx
            )
              .then(done)
              .catch(done);
            return;
          }

          // Log detailed upstream errors (status >= 400) for debugging
          if (rawStatus >= 400) {
            console.error(
              `[Proxy Upstream Error] HTTP ${rawStatus} from googlevideo.com | client=${clientName} | UA="${userAgent}" | range=${rangeHeader || 'none'} | headers=${JSON.stringify(remoteRes.headers)}`
            );

            // Automatic fallback to alternative InnerTube client when HTTP 403 Forbidden occurs
            if (
              rawStatus === 403 &&
              fallbackCtx?.allowClientFallback &&
              fallbackCtx.videoId
            ) {
              clientRes.removeListener('close', onClientClose);
              remoteRes.destroy();
              defaultPlayerFallback
                .resolveFallbackStreamUrl(fallbackCtx.videoId, fallbackCtx.itag, clientName)
                .then((alt) => {
                  if (!alt) {
                    if (!clientRes.headersSent) {
                      clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
                      clientRes.end('Upstream googlevideo 403 Forbidden across fallback clients');
                    }
                    return done();
                  }
                  const cleanAlt = new URL(alt.url);
                  cleanAlt.searchParams.delete('range');
                  cleanAlt.searchParams.delete('rn');
                  const nextRange = this.buildChunkedRangeHeader(clientReq.headers['range'], cleanAlt);
                  return this.pipeStreamToGoogle(
                    cleanAlt.toString(),
                    nextRange,
                    alt.clientName,
                    alt.userAgent,
                    clientReq,
                    clientRes,
                    3,
                    { ...fallbackCtx, allowClientFallback: false }
                  );
                })
                .then(done)
                .catch(done);
              return;
            }
          }

          const responseHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
          };

          if (remoteRes.headers['content-range']) {
            responseHeaders['Content-Range'] = remoteRes.headers['content-range'] as string;
          }
          if (remoteRes.headers['content-length']) {
            responseHeaders['Content-Length'] = remoteRes.headers['content-length'] as string;
          }
          if (remoteRes.headers['content-type']) {
            responseHeaders['Content-Type'] = remoteRes.headers['content-type'] as string;
          } else {
            responseHeaders['Content-Type'] = parsed.searchParams.get('mime') || 'video/mp4';
          }

          if (clientReq.method === 'HEAD') {
            clientRes.writeHead(rawStatus, responseHeaders);
            clientRes.end();
            remoteRes.destroy();
            clientRes.removeListener('close', onClientClose);
            return done();
          }

          clientRes.writeHead(rawStatus, responseHeaders);
          if (typeof (clientRes as any).flushHeaders === 'function') {
            (clientRes as any).flushHeaders();
          }

          if (rawStatus < 200 || rawStatus >= 300) {
            remoteRes.destroy();
            if (!clientRes.writableEnded) clientRes.end();
            clientRes.removeListener('close', onClientClose);
            return done();
          }

          pipeline(remoteRes, clientRes, () => {
            clientRes.removeListener('close', onClientClose);
            done();
          });
        }
      );

      const onClientClose = () => {
        if (!clientRes.writableEnded) {
          abortController.abort();
          remoteReq.destroy();
        }
        done();
      };
      clientRes.once('close', onClientClose);

      remoteReq.on('error', (err) => {
        clientRes.removeListener('close', onClientClose);
        if (!clientRes.headersSent && !clientRes.destroyed) {
          clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
          clientRes.end(`Upstream Google Gateway Error: ${err.message}`);
        } else if (!clientRes.writableEnded && !clientRes.destroyed) {
          clientRes.end();
        }
        done();
      });

      remoteReq.end();
    });
  }

  /**
   * Fetches raw M3U8 text following redirects cleanly, returning final URL alongside text.
   */
  private async fetchRawM3u8(
    hlsUrl: string,
    maxRedirects: number = 3
  ): Promise<{ text: string; finalUrl: string }> {
    const parsedHlsUrl = new URL(hlsUrl);
    const isHttps = parsedHlsUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const agent = isHttps ? this.httpsAgent : this.httpAgent;

    return new Promise((resolve, reject) => {
      const req = lib.get(
        hlsUrl,
        {
          agent,
          headers: {
            'User-Agent': CLIENT_CONFIGS.IOS.userAgent,
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
          },
        },
        (res) => {
          const status = res.statusCode || 200;
          if (
            (status === 301 || status === 302 || status === 307 || status === 308) &&
            res.headers.location &&
            maxRedirects > 0
          ) {
            res.destroy();
            const redirectUrl = new URL(res.headers.location, hlsUrl).toString();
            this.fetchRawM3u8(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
            return;
          }
          if (status >= 400) {
            console.error(
              `[Proxy HLS Manifest Error] HTTP ${status} from googlevideo.com | headers=${JSON.stringify(res.headers)}`
            );
            res.destroy();
            reject(new Error(`HTTP ${status} from Google HLS manifest`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              text: Buffer.concat(chunks).toString('utf-8'),
              finalUrl: hlsUrl,
            });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Rewrites sub-playlist URLs to /hls-manifest and media segment URLs (.ts / .mp4 / videoplayback)
   * to /stream?url=...&client=IOS.
   * Note: YouTube HLS segment URLs contain `/playlist/index.m3u8/govp/.../file/seg.ts` in their path,
   * so we check `/videoplayback` first to avoid misclassifying `.ts` segments as playlists!
   */
  private rewriteM3u8(rawM3u8: string, baseUrl: string, videoId: string): string {
    const proxyBase = `http://${this.host}:${this.port}`;
    const idSuffix = videoId ? `&id=${encodeURIComponent(videoId)}` : '';
    const lines = rawM3u8.split('\n');
    const out: string[] = new Array(lines.length);

    const isPlaylistUrl = (absUrl: string): boolean => {
      try {
        const u = new URL(absUrl);
        if (u.pathname.includes('/videoplayback') || u.pathname.endsWith('.ts') || u.pathname.endsWith('.mp4')) {
          return false;
        }
        return (
          u.pathname.endsWith('.m3u8') ||
          u.pathname.includes('/api/manifest/hls_playlist') ||
          u.pathname.includes('/api/manifest/hls_variant') ||
          u.pathname.includes('/api/manifest/hls_timedtext')
        );
      } catch {
        return absUrl.endsWith('.m3u8') && !absUrl.includes('/videoplayback');
      }
    };

    const rewriteTarget = (rawUri: string): string => {
      const absUrl = new URL(rawUri, baseUrl).toString();
      if (isPlaylistUrl(absUrl)) {
        return `${proxyBase}/hls-manifest?url=${encodeURIComponent(absUrl)}${idSuffix}`;
      }
      return `${proxyBase}/stream?url=${encodeURIComponent(absUrl)}&client=IOS${idSuffix}`;
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) {
        out[i] = rawLine;
        continue;
      }

      if (line.charCodeAt(0) === 35) { // '#'
        if (line.includes('URI="')) {
          out[i] = line.replace(/URI="([^"]+)"/g, (_, uri) => {
            try {
              return `URI="${rewriteTarget(uri)}"`;
            } catch {
              return `URI="${uri}"`;
            }
          });
        } else {
          out[i] = rawLine;
        }
        continue;
      }

      try {
        out[i] = rewriteTarget(line);
      } catch {
        out[i] = rawLine;
      }
    }

    return out.join('\n');
  }
}

export const defaultChunkedProxy = new ChunkedRangeProxyServer({ port: 8989 });
