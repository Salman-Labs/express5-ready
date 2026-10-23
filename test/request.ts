import http from 'node:http';
import type { Express } from 'express';

export function request(
  app: Express,
  urlPath: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('no port'));
        return;
      }
      const body = init.body;
      const headers = { connection: 'close', ...init.headers };
      if (body != null && headers['content-length'] == null) headers['content-length'] = String(Buffer.byteLength(body));
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: urlPath,
          method: init.method ?? 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            server.close(() => {
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
            });
          });
        },
      );
      req.on('error', (error) => {
        server.close(() => reject(error));
      });
      if (body != null) req.write(body);
      req.end();
    });
  });
}
