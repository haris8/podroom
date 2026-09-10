export const MAX_CHARACTERS = 1_000_000;
export const SAMPLE_TITLE = 'The quiet power of curiosity';
export const SAMPLE_TEXT = `Curiosity is a small habit with a surprisingly big reach. It starts with something simple: paying attention.

Think about the last time you walked somewhere familiar. You probably knew the turns without thinking about them. But what happens when you slow down and notice one new thing? A tree growing through a fence. A shop you have never stepped into. The sound of birds above the traffic.

That small shift is curiosity at work. It turns an ordinary moment into a question, and a question into a possibility.

You do not need to become an expert in everything. Try following one question a little further today. Ask someone how they learned a skill. Look up a word you keep hearing. Take a different route home.

The reward is not always an answer. Sometimes it is simply remembering that there is more to the world than the part we already know.`;

export function cleanText(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/^\uFEFF/, '')
    .replace(/^\s*```[^\n]*$/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function wordCount(text: string): number { return text.trim() ? text.trim().split(/\s+/u).length : 0; }
export function splitPassages(input: string, limit = 220): string[] {
  const text = cleanText(input);
  if (!/[\p{L}\p{N}]/u.test(text)) return [];
  // Sentence boundaries are a preference; the hard bound also handles unpunctuated text.
  const sentences = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, {granularity: 'sentence'}).segment(text), part => part.segment)
    : text.split(/\n+/u);
  const passages: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit);
      if (cut < limit / 3) cut = limit;
      // Do not cut a UTF-16 surrogate pair in half.
      if (/[\uD800-\uDBFF]/u.test(rest[cut - 1])) cut--;
      passages.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) passages.push(rest);
  }
  const grouped: string[] = [];
  for (const passage of passages) {
    const last = grouped.length - 1;
    if (last >= 0 && grouped[last].length + passage.length + 1 <= limit) grouped[last] += ' ' + passage;
    else grouped.push(passage);
  }
  return grouped;
}
export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
export function estimatedSeconds(text: string, rate = 1): number { return Math.max(1, wordCount(text) / (165 * rate) * 60); }
export function suggestedTitle(text: string): string {
  const first = cleanText(text).split(/[\n.!?]/u)[0] || 'Untitled episode';
  return first.length > 66 ? first.slice(0, 63).trim() + '…' : first;
}

export const MAX_EPISODES = 200;
export type SplitMethod = 'episodes' | 'headings' | 'separator';
export type EpisodeDraft = { id: string; title: string; text: string; warning?: string };
type Heading = { start: number; end: number; title: string; key: string; level: number; kind: 'episode' | 'chapter' | 'heading' };

/** Detect boundaries without rewriting or discarding document content. */
export function splitEpisodes(input: string, method: SplitMethod = 'episodes', separator = '---EPISODE---'): {drafts: EpisodeDraft[]; message: string} {
  if (input.length > MAX_CHARACTERS) throw new Error('Use up to 1,000,000 characters at a time.');
  const source = input.replace(/\r\n?/g, '\n');
  if (!/[\p{L}\p{N}]/u.test(source)) throw new Error('Add readable text before reviewing episodes.');
  const lines = source.matchAll(/[^\n]*(?:\n|$)/g);
  const headings: Heading[] = [];
  const separators: {start: number; end: number}[] = [];
  if (method === 'separator' && (!separator.trim() || separator.length > 120 || /[\r\n]/.test(separator))) throw new Error('Enter a separator of 1–120 characters on a single line.');
  let fence = '';
  for (const match of lines) {
    if (!match[0]) continue;
    const raw = match[0].replace(/\n$/, '');
    const trimmed = raw.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) { if (!fence) fence = fenceMatch[1][0]; else if (fence === fenceMatch[1][0]) fence = ''; continue; }
    if (fence) continue;
    if (method === 'separator') {
      if (trimmed === separator.trim()) separators.push({start: match.index, end: match.index + match[0].length});
      continue;
    }
    const markdown = trimmed.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const title = (markdown?.[2] ?? trimmed).replace(/^(\*\*|__)(.*?)\1$/, '$2').trim();
    if (!title || title.length > 160) continue;
    if (method === 'headings') {
      if (markdown) headings.push({start:match.index, end:match.index + match[0].length, title, key:title.toLowerCase(), level:markdown[1].length, kind:'heading'});
      continue;
    }
    // Anchored heading lines only; prose mentions and dot-leader TOC entries are not boundaries.
    if (/[.·…]{2,}\s*\d+\s*$/.test(title) || /\s{2,}\d+\s*$/.test(title)) continue;
    const label = title.match(/^(?:(?:season\s+(?:\d+|[ivxlcdm]+))\s*[,.:—–-]?\s+)?(episode|ep\.?|chapter)\s*(?:(?:no\.?|#)\s*)?(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?=$|\s|[:.\-—–|])\s*(.*)$/i);
    if (!label) continue;
    const explicitlyFormatted = !!markdown || /^(\*\*|__)/.test(trimmed);
    if (label[3] && !explicitlyFormatted && !/^[:.\-—–|(]/.test(label[3])) continue;
    headings.push({start:match.index, end:match.index + match[0].length, title, key:title.toLowerCase().replace(/\s+/g,' '), level:0, kind:label[1].toLowerCase()==='chapter'?'chapter':'episode'});
  }
  let drafts: EpisodeDraft[];
  let message = '';
  if (method === 'separator') {
    const ranges = [];
    let start = 0;
    for (const marker of separators) { ranges.push({start, end:marker.start}); start = marker.end; }
    ranges.push({start, end:source.length});
    drafts = ranges.filter(r => source.slice(r.start,r.end).trim()).map((r,i) => ({id:`draft-${r.start}`, title:suggestedTitle(source.slice(r.start,r.end)) || `Episode ${i+1}`, text:source.slice(r.start,r.end)}));
    message = separators.length ? 'Separator lines are omitted from narration. All other text stays in document order.' : 'No separator lines found. Put your separator on its own line between episodes, then review again.';
  } else {
    let candidates = headings;
    if (method === 'episodes') {
      const explicit = headings.filter(h=>h.kind==='episode');
      candidates = explicit.length ? explicit : headings.filter(h=>h.kind==='chapter');
      const beforeFirst = source.slice(0,candidates[0]?.start ?? 0);
      if (/(?:^|\n)\s*(?:#{1,6}\s*)?(?:table of )?contents\s*:?\s*(?=\n|$)/i.test(beforeFirst)) {
        const later = new Map(candidates.map((h,i)=>[h.key,i]));
        let firstBody = 0;
        // Contents entries can have a trailing page number and be followed by a foreword.
        while (firstBody<candidates.length) {
          const key = candidates[firstBody].key;
          if (Math.max(later.get(key)??firstBody,later.get(key.replace(/\s+\d+$/,''))??firstBody)<=firstBody) break;
          firstBody++;
        }
        candidates = candidates.slice(firstBody);
      }
      // A heading-only duplicate before later body content is usually a contents listing.
      const lastOccurrence = new Map(candidates.map((h,i)=>[h.key,i]));
      candidates = candidates.filter((h,i,list) => !((lastOccurrence.get(h.key) ?? i)>i && list[i+1] && !source.slice(h.end,list[i+1].start).trim()));
    } else {
      const counts = new Map<number,number>();
      for (const h of candidates) counts.set(h.level,(counts.get(h.level)??0)+1);
      const level = Math.min(...Array.from(counts).filter(([,count])=>count>=2).map(([level])=>level));
      candidates = candidates.filter(h=>h.level===level);
    }
    // Repeated page headers within the same episode retain their text but not a new boundary.
    candidates = candidates.filter((h,i,list)=>i===0 || h.key!==list[i-1].key);
    drafts = candidates.length ? candidates.map((h,i) => {
      const end = candidates[i+1]?.start ?? source.length;
      return {id:`draft-${i===0?0:h.start}`, title:h.title.slice(0,120), text:source.slice(i===0?0:h.start,end), warning:!source.slice(h.end,end).trim()?'This heading has no body text. Check this boundary or merge it with the previous episode.':undefined};
    }) : [{id:'draft-0',title:suggestedTitle(source),text:source}];
    message = candidates.length>1 ? 'Headings start each episode. Any text before the first heading stays in episode 1.' : 'Only one episode was found. Try Markdown headings or add a separator line between episodes, then review again.';
  }
  if (drafts.length > MAX_EPISODES) throw new Error(`Found ${drafts.length} episodes. Use a section with at most ${MAX_EPISODES} episodes, or choose a more specific separator.`);
  if (!drafts.length) throw new Error('No episode content was found between the separator lines.');
  return {drafts,message};
}

export function mergeDraftWithPrevious(drafts: EpisodeDraft[], index: number): EpisodeDraft[] {
  if (index < 1 || index >= drafts.length) return drafts;
  const previous = drafts[index-1];
  return [...drafts.slice(0,index-1), {...previous,text:previous.text+drafts[index].text,warning:undefined}, ...drafts.slice(index+1)];
}

export const SERIES_SAMPLE = `Series introduction\nThree short episodes about making room for curiosity.\n\nEpisode 1: Start with a question\nCuriosity begins when we notice something we do not yet understand. Ask one small question today, and give yourself time to follow it.\n\nEpisode 2: Look a little closer\nTake a familiar walk and look for one detail you have never noticed before. Paying attention can make an ordinary place feel new.\n\nEpisode 3: Keep the conversation going\nAsk someone how they learned something they enjoy. Listen to their story, and see which question you want to ask next.`;
