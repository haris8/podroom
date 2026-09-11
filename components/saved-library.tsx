'use client';
import { useEffect, useRef, useState } from 'react';
import { Archive, BookOpen, CloudUpload, RotateCcw } from 'lucide-react';
import type { LibraryItem, LibrarySave, SavedEpisode } from '../lib/library-store';
import type { LibrarySync } from '../lib/library-sync';

export async function libraryFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {...options, cache: 'no-store', headers: {'Content-Type': 'application/json', ...options.headers}});
  const data = await response.json().catch(() => { throw new Error('Your library response was incomplete. Please retry.'); });
  if (!response.ok) { const error = new Error((data as {error?: string})?.error || 'Your library could not be reached.') as Error & {status: number}; error.status = response.status; throw error; }
  return data as T;
}
type Props = {
  draft: LibrarySave | null; savedId: string; busy: boolean; sync: LibrarySync; progressMessage: string;
  onOpen: (data: LibrarySave) => void; onSaved: (id: string, episodes: SavedEpisode[]) => void;
  onBusy: (busy: boolean) => void; onPause: () => void;
};
export function SavedLibrary({draft, savedId, busy, sync, progressMessage, onOpen, onSaved, onBusy, onPause}: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [archived, setArchived] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [message, setMessage] = useState('');
  const pendingSave = useRef<LibrarySave | null>(null);
  const actions = useRef({onOpen, onSaved, onBusy, onPause}); actions.current = {onOpen, onSaved, onBusy, onPause};
  const listToken = useRef(0);
  const locked = useRef(false);
  function fail(error: unknown) { setError(error instanceof Error ? error.message : 'Your library could not be reached. Please retry.'); setNeedsSignIn((error as {status?: number})?.status === 401); }
  async function refresh(showArchived = archived, offset = 0) {
    const token = ++listToken.current;
    setLoading(true); setError('');
    try {
      const result = await libraryFetch<{items: LibraryItem[]; nextOffset: number | null}>(`/api/library?archived=${showArchived ? 1 : 0}&offset=${offset}`);
      if (token !== listToken.current) return;
      setItems(previous => offset ? [...previous, ...result.items] : result.items); setNextOffset(result.nextOffset); setNeedsSignIn(false);
    } catch (error) { if (token === listToken.current) fail(error); }
    finally { if (token === listToken.current) setLoading(false); }
  }
  async function open(id: string) {
    if (locked.current) return;
    locked.current = true; actions.current.onBusy(true); setError(''); setMessage('Opening saved episodes…');
    try {
      // Finish writes before replacing the active library. A conflict is resolved by loading server state.
      actions.current.onPause();
      if (!await sync.flush() && !sync.canReload(id)) throw new Error('Your latest progress has not saved. Use Retry progress before opening another item.');
      const data = await libraryFetch<LibrarySave>(`/api/library/${id}`);
      actions.current.onOpen(data);
      sync.register(id, data.episodes);
      const url = new URL(window.location.href); url.searchParams.set('library', id); window.history.replaceState(null, '', url);
      setMessage('Opened. Press play to resume from your saved passage.');
    } catch (error) { fail(error); setMessage(''); }
    finally { locked.current = false; actions.current.onBusy(false); }
  }
  useEffect(() => {
    void refresh(false);
    const id = new URL(window.location.href).searchParams.get('library');
    if (id) void open(id);
    // Initial restore only; subsequent changes are explicit library actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function save() {
    if (!draft || locked.current) return;
    locked.current = true; actions.current.onBusy(true); setError(''); setMessage('Saving source and episodes…');
    // Freeze the first attempt for idempotent retries, even if playback advances.
    if (pendingSave.current?.id !== draft.id) pendingSave.current = draft;
    const snapshot = pendingSave.current;
    try {
      await libraryFetch('/api/library', {method: 'POST', body: JSON.stringify(snapshot)});
      const stored = await libraryFetch<LibrarySave>(`/api/library/${snapshot.id}`);
      sync.register(stored.id, stored.episodes);
      actions.current.onSaved(stored.id, stored.episodes);
      const url = new URL(window.location.href); url.searchParams.set('library', stored.id); window.history.replaceState(null, '', url);
      setMessage('Saved to your account. Listening progress will save automatically.');
      setArchived(false); await refresh(false);
    } catch (error) { fail(error); setMessage(''); }
    finally { locked.current = false; actions.current.onBusy(false); }
  }
  async function archive(item: LibraryItem) {
    if (locked.current) return;
    locked.current = true; actions.current.onBusy(true); setError('');
    try {
      await libraryFetch(`/api/library/${item.id}`, {method: 'PATCH', body: JSON.stringify({archived: !archived})});
      setMessage(archived ? 'Restored to your library.' : 'Archived. You can restore it from Archived.'); await refresh();
    } catch (error) { fail(error); }
    finally { locked.current = false; actions.current.onBusy(false); }
  }
  return <section className="saved-library" aria-labelledby="saved-library-heading">
    <div className="saved-heading"><h2 id="saved-library-heading"><BookOpen size={19}/>Saved library</h2><button disabled={busy || loading} onClick={() => void refresh()} aria-label="Refresh saved library"><RotateCcw size={16}/></button></div>
    <p className="saved-help">Save source text and episodes to your account, then resume on another device. Original files and audio are not stored.</p>
    <button className="save-library-button" disabled={!draft || !!savedId || busy || needsSignIn} onClick={() => void save()}><CloudUpload size={18}/>{savedId ? 'Saved to your library' : 'Save to library'}</button>
    {savedId && progressMessage && <div className="saved-status" aria-live="polite"><span>{progressMessage}</span>{!['Progress saved', 'Saving progress…'].includes(progressMessage) && <button onClick={() => void sync.retry()}>Retry progress</button>}</div>}
    <div className="saved-tabs"><button aria-pressed={!archived} disabled={busy} onClick={() => {setArchived(false); void refresh(false);}}>Saved</button><button aria-pressed={archived} disabled={busy} onClick={() => {setArchived(true); void refresh(true);}}>Archived</button></div>
    {loading && <p className="saved-help" role="status">Loading library…</p>}
    {error && <div className="saved-error" role="alert"><p>{error}</p>{needsSignIn ? <><p>Sign in before preparing an episode; this page reloads during sign-in.</p><a href="/signin-with-chatgpt?return_to=/" target="_top">Sign in with ChatGPT</a></> : <button disabled={busy} onClick={() => void refresh()}>Retry library</button>}</div>}
    {!loading && !error && !items.length && <p className="saved-help">{archived ? 'No archived items.' : 'Your saved episodes will appear here.'}</p>}
    <ul className="saved-items">{items.map(item => <li key={item.id}><button className="saved-open" disabled={busy} onClick={() => void open(item.id)}><strong>{item.title}</strong><span>{item.episodeCount} {item.episodeCount === 1 ? 'episode' : 'episodes'} · {new Date(item.createdAt).toLocaleDateString()}</span></button><button className="saved-archive" disabled={busy} onClick={() => void archive(item)} aria-label={`${archived ? 'Restore' : 'Archive'} ${item.title}`}>{archived ? <RotateCcw size={17}/> : <Archive size={17}/>}</button></li>)}</ul>
    {nextOffset !== null && <button disabled={busy || loading} onClick={() => void refresh(archived, nextOffset)}>Load more</button>}
    {message && <p className="saved-help" role="status">{message}</p>}
  </section>;
}
