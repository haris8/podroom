export const MAX_CHARACTERS = 100_000;
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
