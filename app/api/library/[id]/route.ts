import { libraryRequest, readJson } from '../../../../lib/library-api';
import { LibraryError } from '../../../../lib/library-store';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, context: Context) {
  return libraryRequest(request, async (store, owner) => store.read(owner, (await context.params).id));
}
export async function PATCH(request: Request, context: Context) {
  return libraryRequest(request, async (store, owner) => {
    const data = await readJson(request, 1024) as {archived?: unknown} | null;
    if (typeof data?.archived !== 'boolean') throw new LibraryError(400, 'Choose archive or restore.');
    return store.archive(owner, (await context.params).id, data.archived);
  });
}
