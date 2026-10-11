// Obsidian note parsing and structure-aware chunking. Pure functions, no DOM.
import { fixedChunks } from './chunker.js';

// ponytail: no YAML parser. Only `tags:` is read, in the three common shapes
// (inline list, comma string, dash list). Upgrade path: a real YAML library if more fields matter.
export function parseNote(path, raw) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  let tags = [], body = text;
  const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    const lines = fm[1].split('\n');
    const i = lines.findIndex((l) => /^tags?\s*:/i.test(l));
    if (i >= 0) {
      const rest = lines[i].replace(/^tags?\s*:\s*/i, '').replace(/^\[|\]$/g, '').trim();
      if (rest) tags = rest.split(',');
      else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) tags.push(lines[j].replace(/^\s*-\s+/, ''));
    }
    tags = tags.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean);
  }
  return { path, title: path.split('/').pop().replace(/\.md$/i, ''), tags, body: cleanBody(body) };
}

// Remove Obsidian-only syntax that adds noise to embeddings but no meaning.
export function cleanBody(s) {
  return s
    .replace(/%%[\s\S]*?%%/g, '') // comments
    .replace(/^(```|~~~)\s*(dataview|dataviewjs|query|tasks)\b[\s\S]*?^\1[ \t]*$/gim, '') // generated content
    .replace(/!\[\[[^\]]*\]\]/g, '') // embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2') // [[target|alias]] -> alias
    .replace(/\[\[([^\]#|]*)#\^?([^\]|]*)\]\]/g, '$1 $2') // [[note#heading]] -> note heading
    .replace(/\[\[([^\]]*)\]\]/g, '$1') // [[note]] -> note
    .replace(/^(\s*>\s*)\[![^\]]+\][+-]?[ \t]*/gm, '$1') // callout marker, keep its title
    .replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, '') // block ids
    .replace(/==([^=\n]+)==/g, '$1') // highlights
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Split on Markdown headings. Each section keeps its heading line, its heading path and its offsets in `body`.
// Headings inside code fences are ignored.
export function sections(body) {
  const out = [], stack = [];
  let cur = { path: [], start: 0 }, fence = false, pos = 0;
  const flush = (end) => {
    const raw = body.slice(cur.start, end), text = raw.trim();
    if (!text) return;
    const start = cur.start + raw.length - raw.trimStart().length;
    out.push({ path: cur.path, text, start, end: start + text.length });
  };
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flush(pos);
      while (stack.length && stack.at(-1).level >= m[1].length) stack.pop();
      stack.push({ level: m[1].length, text: m[2] });
      cur = { path: stack.map((h) => h.text), start: pos };
    }
    pos += line.length + 1;
  }
  flush(body.length);
  return out;
}

// One chunk per section; tiny sections merge with a neighbour, oversized ones fall back to fixed-size splitting.
// Chunk = { path: [note title, ...headings], text, start, end } with offsets into note.body.
export function headingChunks({ title, body }, { min = 150, max = 1200 } = {}) {
  const merge = (a, b) => ({ path: b.end - b.start >= a.end - a.start ? b.path : a.path, start: a.start, end: b.end });
  const len = (s) => s.end - s.start;
  const merged = [];
  for (const s of sections(body)) {
    const last = merged.at(-1);
    if (last && len(last) < min && s.end - last.start <= max) merged[merged.length - 1] = merge(last, s);
    else merged.push(s);
  }
  if (merged.length > 1) { // a small tail joins the section before it
    const [prev, last] = merged.slice(-2);
    if (len(last) < min && last.end - prev.start <= max) merged.splice(-2, 2, merge(prev, last));
  }
  const out = [];
  for (const s of merged) {
    if (len(s) <= max) { out.push({ path: [title, ...s.path], start: s.start, end: s.end, text: body.slice(s.start, s.end) }); continue; }
    const text = body.slice(s.start, s.end);
    for (const c of fixedChunks(text, Math.min(800, max), 80)) {
      out.push({ path: [title, ...s.path], start: s.start + c.start, end: s.start + c.end, text: text.slice(c.start, c.end) });
    }
  }
  return out;
}

// The structure-blind alternative, for comparison: fixed windows over each note's body.
export function fixedNoteChunks({ title, body }, size = 500, overlap = 80) {
  return fixedChunks(body, size, overlap).map((c) => ({ path: [title], start: c.start, end: c.end, text: body.slice(c.start, c.end) }));
}

export const headingOffsets = (body) => sections(body).filter((s) => s.path.length).map((s) => s.start);
