// Pure functions, no DOM, so the same file runs in the browser and in the node test.

// ponytail: regex sentence splitter. "e.g. foo" splits early and CJK text isn't handled.
// Upgrade path: Intl.Segmenter({granularity:'sentence'}).
export function splitSentences(text, hardMax = 400) {
  const out = [];
  const re = /\S[\s\S]*?(?:[.!?]+["')\]]*(?=\s|$)|\n{2,}|$)/g;
  for (const m of text.matchAll(re)) {
    let start = m.index;
    const end = start + m[0].trimEnd().length;
    // A sentence with no punctuation (code, tables, PDF junk) would become one giant chunk; wrap it.
    while (end - start > hardMax) {
      let cut = text.lastIndexOf(' ', start + hardMax);
      if (cut <= start) cut = start + hardMax;
      out.push({ start, end: cut });
      start = cut;
      while (/\s/.test(text[start] ?? 'x')) start++;
    }
    if (end > start) out.push({ start, end });
  }
  return out;
}

// Fixed-size windows of ~size chars, each starting `overlap` chars before the previous one ended.
// Cuts snap to word boundaries so words aren't sliced in half.
export function fixedChunks(text, size, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (start >= text.length) break;
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > start + size * 0.5) end = sp;
    }
    chunks.push({ start, end });
    if (end >= text.length) break;
    let next = end - overlap;
    if (next > start) {
      const ws = text.slice(next, end).search(/\s/);
      if (ws >= 0) next += ws + 1;
    }
    start = next > start ? next : end;
  }
  return chunks;
}

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Similarity between each sentence and the next one. Vectors are unit length, so dot == cosine.
export function neighbourSims(vecs) {
  const sims = [];
  for (let i = 0; i < vecs.length - 1; i++) sims.push(dot(vecs[i], vecs[i + 1]));
  return sims;
}

// Cut where the topic shifts: after sentence i if sim(i, i+1) is among the lowest `breakPct` percent.
// minChars stops tiny fragments, maxChars stops one runaway chunk.
export function semanticChunks(sentences, sims, { breakPct = 20, minChars = 150, maxChars = 1200 } = {}) {
  if (!sentences.length) return { chunks: [], threshold: 0 };
  const sorted = [...sims].sort((a, b) => a - b);
  const threshold = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * breakPct / 100))] : 0;
  const chunks = [];
  let from = 0;
  for (let i = 0; i < sentences.length; i++) {
    const size = sentences[i].end - sentences[from].start;
    const last = i === sentences.length - 1;
    const nextSize = last ? 0 : sentences[i + 1].end - sentences[from].start;
    const topicShift = !last && sims[i] < threshold && size >= minChars;
    if (last || topicShift || nextSize > maxChars) {
      chunks.push({ start: sentences[from].start, end: sentences[i].end, sentenceFrom: from, sentenceTo: i });
      from = i + 1;
    }
  }
  return { chunks, threshold };
}

const STOP = new Set('a an and are as at be by do does for from how i if in is it its my of on or so that the this to was what when where which who why will with you your can get me we our'.split(' '));
export const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOP.has(t));

// Plain BM25. Zero when no query word appears in the chunk, which is the whole point of the comparison.
export function bm25(docs, query, k1 = 1.5, b = 0.75) {
  const toks = docs.map(tokenize);
  const avg = toks.reduce((s, t) => s + t.length, 0) / (toks.length || 1) || 1;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const q = [...new Set(tokenize(query))];
  return toks.map((t) => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (toks.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * t.length / avg));
    }
    return score;
  });
}

export const topK = (scores, k = 3) =>
  scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score).slice(0, k);
