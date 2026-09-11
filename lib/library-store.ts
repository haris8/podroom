// No runtime-specific imports: exercised with real local D1 and R2 bindings in tests.
export type SavedEpisode = {
  id: string; title: string; passages: string[]; voice: string; voiceName: string;
  engine: 'neural' | 'device'; rate: number; words: number;
  progressIndex: number; completed: boolean; revision: number;
};
export type LibraryItem = {id: string; title: string; episodeCount: number; createdAt: number; archived: number};
export type LibrarySave = {id: string; title: string; source: string; episodes: SavedEpisode[]};
export type Progress = {index: number; completed: boolean; rate: number};
export class LibraryError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new LibraryError(400, 'Invalid saved episode identifier.');
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryError(400, 'Invalid library data.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new LibraryError(400, 'Library text is missing or too long.');
  return value;
}
export function validateProgress(value: unknown, count: number): Progress & {revision: number} {
  const p = record(value);
  if (!Number.isInteger(p.index) || (p.index as number) < 0 || (p.index as number) >= count ||
      typeof p.completed !== 'boolean' || ![0.75, 1, 1.25, 1.5, 2].includes(p.rate as number) ||
      !Number.isInteger(p.revision) || (p.revision as number) < 0) throw new LibraryError(400, 'Invalid listening position or speed.');
  return {index: p.index as number, completed: p.completed, rate: p.rate as number, revision: p.revision as number};
}
export function validateSave(value: unknown): LibrarySave {
  const input = record(value);
  const id = validId(input.id), title = string(input.title, 200), source = string(input.source, 1_000_000);
  if (!Array.isArray(input.episodes) || !input.episodes.length || input.episodes.length > 200) throw new LibraryError(400, 'Save between 1 and 200 episodes.');
  let characters = 0;
  const ids = new Set<string>();
  const episodes = input.episodes.map<SavedEpisode>(value => {
    const e = record(value), id = validId(e.id);
    if (ids.has(id)) throw new LibraryError(400, 'Episode identifiers must be unique.');
    ids.add(id);
    if (!Array.isArray(e.passages) || !e.passages.length || e.passages.length > 10000) throw new LibraryError(400, 'Invalid transcript.');
    const passages = e.passages.map(p => string(p, 220));
    characters += passages.reduce((sum, p) => sum + p.length, 0);
    if (characters > 1_000_000) throw new LibraryError(400, 'Episodes exceed 1,000,000 characters.');
    if (e.engine !== 'neural' && e.engine !== 'device') throw new LibraryError(400, 'Invalid narration engine.');
    const p = validateProgress({index: e.progressIndex ?? 0, completed: e.completed ?? false, rate: e.rate, revision: 0}, passages.length);
    return {id, title: string(e.title, 200), passages, voice: string(e.voice, 1000, true), voiceName: string(e.voiceName, 200), engine: e.engine,
      words: passages.join(' ').trim().split(/\s+/u).length, rate: p.rate, progressIndex: p.index, completed: p.completed, revision: 0};
  });
  return {id, title, source, episodes};
}
type LibraryRow = {id: string; title: string; source_key: string; source_hash: string};
type EpisodeRow = {id: string; title: string; voice: string; voice_name: string; engine: 'neural' | 'device'; rate: number; words: number; passage_count: number; progress_index: number; completed: number; revision: number};
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');

export function libraryStore(db: D1Database, bucket: R2Bucket) {
  const owned = async (owner: string, id: string) => {
    validId(id);
    const row = await db.prepare('SELECT id,title,source_key,source_hash FROM libraries WHERE id=? AND owner_id=?').bind(id, owner).first<LibraryRow>();
    if (!row) throw new LibraryError(404, 'Saved item not found.');
    return row;
  };
  return {
    async list(owner: string, archived: boolean, offset: number) {
      const rows = await db.prepare('SELECT id,title,episode_count AS episodeCount,created_at AS createdAt,archived FROM libraries WHERE owner_id=? AND archived=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').bind(owner, archived ? 1 : 0, offset).all<LibraryItem>();
      return {items: rows.results.slice(0, 50), nextOffset: rows.results.length > 50 ? offset + 50 : null};
    },
    async save(owner: string, value: unknown) {
      const data = validateSave(value);
      // Include metadata in the fingerprint; retrying a save cannot silently replace a different one.
      const hash = await digest(JSON.stringify(data));
      const existing = await db.prepare('SELECT source_hash FROM libraries WHERE id=? AND owner_id=?').bind(data.id, owner).first<{source_hash: string}>();
      if (existing) {
        if (existing.source_hash !== hash) throw new LibraryError(409, 'This save has different contents. Create a new saved copy.');
        return {id: data.id};
      }
      const key = `sources/${await digest(owner)}/${data.id}/${hash}.json`;
      await bucket.put(key, JSON.stringify({version: 1, source: data.source, episodes: data.episodes.map(e => ({id: e.id, passages: e.passages}))}), {httpMetadata: {contentType: 'application/json'}});
      // One atomic D1 batch. R2 objects are immutable; never delete on ambiguous D1 failure.
      await db.batch([
        db.prepare('INSERT INTO libraries (id,owner_id,title,source_key,source_hash,episode_count,created_at,archived) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(id) DO NOTHING').bind(data.id, owner, data.title, key, hash, data.episodes.length, Date.now()),
        db.prepare(`INSERT INTO episodes (id,library_id,ordinal,title,words,voice,voice_name,engine,rate,passage_count,progress_index,completed,revision)
          SELECT json_extract(value,'$.id'),?,CAST(key AS INTEGER),json_extract(value,'$.title'),json_extract(value,'$.words'),json_extract(value,'$.voice'),json_extract(value,'$.voiceName'),json_extract(value,'$.engine'),json_extract(value,'$.rate'),json_extract(value,'$.passageCount'),json_extract(value,'$.progressIndex'),json_extract(value,'$.completed'),0
          FROM json_each(?) WHERE EXISTS (SELECT 1 FROM libraries WHERE id=? AND owner_id=? AND source_hash=?) ON CONFLICT(library_id,id) DO NOTHING`)
          .bind(data.id, JSON.stringify(data.episodes.map(({passages, ...e}) => ({...e, passageCount: passages.length}))), data.id, owner, hash),
      ]);
      const saved = await owned(owner, data.id);
      if (saved.source_hash !== hash) throw new LibraryError(409, 'This save has different contents. Create a new saved copy.');
      return {id: data.id};
    },
    async read(owner: string, id: string) {
      const row = await owned(owner, id);
      const object = await bucket.get(row.source_key);
      if (!object) throw new LibraryError(503, 'The saved source is temporarily unavailable. Please retry.');
      const source = await object.json<{version: number; source: string; episodes: {id: string; passages: string[]}[]}>();
      const rows = await db.prepare('SELECT * FROM episodes WHERE library_id=? ORDER BY ordinal').bind(id).all<EpisodeRow>();
      const texts = new Map(source.episodes.map(e => [e.id, e.passages]));
      const episodes: SavedEpisode[] = rows.results.map(e => {
        const passages = texts.get(e.id);
        if (!passages || passages.length !== e.passage_count) throw new LibraryError(503, 'The saved transcript is temporarily unavailable. Please retry.');
        return {id: e.id, title: e.title, passages, words: e.words, voice: e.voice, voiceName: e.voice_name, engine: e.engine, rate: e.rate, progressIndex: e.progress_index, completed: Boolean(e.completed), revision: e.revision};
      });
      return {id, title: row.title, source: source.source, episodes};
    },
    async progress(owner: string, libraryId: string, episodeId: string, value: unknown) {
      validId(libraryId); validId(episodeId);
      const row = await db.prepare('SELECT passage_count FROM episodes WHERE id=? AND library_id=? AND EXISTS (SELECT 1 FROM libraries WHERE id=? AND owner_id=?)').bind(episodeId, libraryId, libraryId, owner).first<{passage_count: number}>();
      if (!row) throw new LibraryError(404, 'Saved episode not found.');
      const p = validateProgress(value, row.passage_count);
      const result = await db.prepare('UPDATE episodes SET progress_index=?,completed=?,rate=?,revision=revision+1 WHERE id=? AND library_id=? AND revision=? AND EXISTS (SELECT 1 FROM libraries WHERE id=? AND owner_id=?) RETURNING revision').bind(p.index, p.completed ? 1 : 0, p.rate, episodeId, libraryId, p.revision, libraryId, owner).first<{revision: number}>();
      if (!result) {
        // A response may be lost after the write commits. Repeating that exact write is safe.
        const current = await db.prepare('SELECT revision,progress_index,completed,rate FROM episodes WHERE id=? AND library_id=?').bind(episodeId, libraryId).first<{revision: number; progress_index: number; completed: number; rate: number}>();
        if (current && current.revision === p.revision + 1 && current.progress_index === p.index && Boolean(current.completed) === p.completed && current.rate === p.rate) return {revision: current.revision};
        throw new LibraryError(409, 'Progress changed on another device. Reopen this saved item before continuing to sync.');
      }
      return result;
    },
    async archive(owner: string, id: string, archived: boolean) {
      await owned(owner, id);
      await db.prepare('UPDATE libraries SET archived=? WHERE id=? AND owner_id=?').bind(archived ? 1 : 0, id, owner).run();
      return {id, archived};
    },
  };
}
