import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ModelError } from '@safehandoff/core-interface';

// Direct transport: neither proxy environment variables nor a global fetch dispatcher
// may send model credentials to a different endpoint. Native request never follows redirects.
export function postJSON(url: URL, body: string, key: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST', agent: false, signal,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${key}` },
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy(); reject(new ModelError('MODEL_UNAVAILABLE')); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { response.destroy(); reject(new ModelError('MODEL_INVALID_RESPONSE')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', reject);
    request.end(body);
  });
}
