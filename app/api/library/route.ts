import { libraryRequest, readJson } from '../../../lib/library-api';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return libraryRequest(request, (store, owner) => {
    const url = new URL(request.url), offset = Number(url.searchParams.get('offset') ?? 0);
    return store.list(owner, url.searchParams.get('archived') === '1', Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
  });
}
export async function POST(request: Request) {
  return libraryRequest(request, async (store, owner) => store.save(owner, await readJson(request)));
}
