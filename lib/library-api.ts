import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { getD1 } from '../db';
import { LibraryError, libraryStore } from './library-store';

export const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie'}});
export async function libraryRequest(request: Request, action: (store: ReturnType<typeof libraryStore>, owner: string) => Promise<unknown>) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new LibraryError(401, 'Sign in with ChatGPT to use your saved library.');
    if (request.method !== 'GET') {
      const origin = request.headers.get('origin');
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) throw new LibraryError(403, 'Open Podroom to make this change.');
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new LibraryError(415, 'Send library changes as JSON.');
    }
    if (!env.BUCKET) throw new LibraryError(503, 'Your saved library is not available yet. Please retry shortly.');
    return json(await action(libraryStore(getD1(), env.BUCKET), user.userId));
  } catch (error) {
    if (error instanceof LibraryError) return json({error: error.message}, error.status);
    console.error('Podroom library storage failed', error);
    return json({error: 'Your library could not be reached. Your current text is still here. Please retry.'}, 503);
  }
}
export async function readJson(request: Request, maxBytes = 16 * 1024 * 1024): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new LibraryError(413, 'This saved item is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new LibraryError(400, 'Missing library data.');
  const decoder = new TextDecoder(); let text = '', size = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new LibraryError(413, 'This saved item is too large.'); }
    text += decoder.decode(value, {stream: true});
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw new LibraryError(400, 'Invalid library data.'); }
}
