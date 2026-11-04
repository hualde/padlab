/**
 * Servidor estático mínimo para desarrollo local, sin dependencias.
 *
 *   node server.mjs            → http://localhost:8123
 *   node server.mjs --host     → accesible desde la red local (sin micrófono por HTTP)
 *   PORT=9000 node server.mjs  → otro puerto
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8123);
const HOST = process.argv.includes('--host') ? '0.0.0.0' : '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  if (body) res.end(body);
  else res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      send(res, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
      return;
    }

    const requestUrl = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/') pathname = '/index.html';

    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      send(res, 403, 'Acceso denegado');
      return;
    }

    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      send(res, 404, 'No encontrado');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Cache-Control': 'no-store',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const content = await readFile(filePath);
    res.writeHead(200, headers);
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      send(res, 404, 'No encontrado');
      return;
    }
    console.error(error);
    send(res, 500, 'Error interno');
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  PadLab · entrenador de pad acústico');
  console.log(`  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    const addresses = [];
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
      }
    }
    for (const address of addresses) console.log(`  http://${address}:${PORT}  (solo interfaz; el micrófono requiere HTTPS)`);
  }
  console.log('');
  console.log('  Ctrl+C para parar.');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  Servidor detenido.');
  server.close(() => process.exit(0));
});
