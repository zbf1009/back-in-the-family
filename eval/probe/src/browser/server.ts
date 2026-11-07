// Static file server for the built Probe_Page (eval/probe/dist), used by the browser driver. node:http,
// bound to 127.0.0.1 on an ephemeral port (127.0.0.1 is a secure context, which WebGPU needs). It sets no
// COOP or COEP header (design: Probe_Page build) and serves only files below its root.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface StaticServer {
  /** `http://127.0.0.1:<port>/` */
  readonly url: string;
  /** `http://127.0.0.1:<port>`, the origin the byte classifier treats as local. */
  readonly origin: string;
  close(): Promise<void>;
}

export type StaticServerFactory = (root: string) => Promise<StaticServer>;

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export const mimeFor = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Maps a request path to a file below `root`; `null` for a path that leaves the root, contains a NUL byte
 * or does not decode. `/` maps to `index.html`.
 */
export function resolveRequestPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]?.split('#')[0] ?? '');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const base = path.resolve(root);
  const full = path.resolve(base, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export const startStaticServer: StaticServerFactory = async (root) => {
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const file = resolveRequestPath(root, req.url ?? '/');
      if (file === null) {
        res.writeHead(400).end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': mimeFor(file), 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('static server: no port assigned');
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    url: `${origin}/`,
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
};
