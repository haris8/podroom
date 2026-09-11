import { libraryRequest, readJson } from '../../../../../../lib/library-api';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: {params: Promise<{id: string; episodeId: string}>}) {
  return libraryRequest(request, async (store, owner) => {
    const {id, episodeId} = await context.params;
    return store.progress(owner, id, episodeId, await readJson(request, 1024));
  });
}
