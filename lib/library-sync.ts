import type { Progress, SavedEpisode } from './library-store';
type Entry = {libraryId: string; revision: number; current: Progress; saved: Progress; pending?: Progress & {revision: number}; running?: Promise<void>; error?: string; conflict?: boolean};
export class LibrarySync {
  private entries = new Map<string, Entry>();
  private notify: (message: string) => void;
  private write: (libraryId: string, id: string, p: Progress & {revision: number}) => Promise<{revision: number}>;
  constructor(write: LibrarySync['write'], notify: (message: string) => void) { this.write = write; this.notify = notify; }
  register(libraryId: string, episodes: SavedEpisode[]) {
    this.entries.clear();
    for (const e of episodes) {
      const value = {index: e.progressIndex, completed: e.completed, rate: e.rate};
      this.entries.set(e.id, {libraryId, revision: e.revision, current: value, saved: value});
    }
    this.notify('Progress saved');
  }
  clear() { this.entries.clear(); this.notify(''); }
  canReload(libraryId: string) {
    const entries = [...this.entries.values()];
    return entries.some(e => e.conflict) && entries.every(e => e.libraryId === libraryId && (!e.error || e.conflict));
  }
  change(id: string, value: Progress) {
    const e = this.entries.get(id); if (!e) return;
    e.current = value;
    if (!e.error) void this.send(id, e);
  }
  private same(a: Progress, b: Progress) { return a.index === b.index && a.completed === b.completed && a.rate === b.rate; }
  private send(id: string, e: Entry): Promise<void> {
    if (e.running) return e.running;
    if (e.error || (!e.pending && this.same(e.current, e.saved))) return Promise.resolve();
    e.running = (async () => {
      this.notify('Saving progress…');
      while (e.pending || !this.same(e.current, e.saved)) {
        const value = e.pending ?? {...e.current, revision: e.revision};
        e.pending = value;
        try {
          const result = await this.write(e.libraryId, id, value);
          if (!Number.isInteger(result.revision) || result.revision !== value.revision + 1) throw new Error('Progress response was incomplete. Please retry.');
          e.revision = result.revision; e.saved = value; e.pending = undefined;
        } catch (error) {
          e.error = error instanceof Error ? error.message : 'Progress could not be saved. Retry when connected.';
          e.conflict = (error as {status?: number})?.status === 409;
          break;
        }
      }
    })().finally(() => {
      e.running = undefined;
      const errors = [...this.entries.values()].find(e => e.error);
      this.notify(errors?.error ?? ([...this.entries.values()].some(e => e.running) ? 'Saving progress…' : 'Progress saved'));
    });
    return e.running;
  }
  async flush() {
    await Promise.all([...this.entries].map(([id, e]) => this.send(id, e)));
    return ![...this.entries.values()].some(e => e.error);
  }
  async retry() {
    for (const e of this.entries.values()) if (!e.conflict) e.error = undefined;
    return this.flush();
  }
}
