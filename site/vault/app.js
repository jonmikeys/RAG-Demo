import { bm25, topK, dot } from '/chunker.js';
import { parseNote, headingChunks, fixedNoteChunks, headingOffsets } from '/obsidian.js';
import { embed, getExtractor, setHooks } from '/embed.js';
import { SAMPLE_VAULT, SAMPLE_QUESTIONS } from './sample.js';

const MAX_NOTES = 2000, MAX_NOTE_BYTES = 1024 * 1024, MAX_CHUNKS = 3000;
const $ = (id) => document.getElementById(id);
const hue = (i) => (i * 47) % 360;
const S = { notes: [], hoffs: [], mode: 'heading', prefix: true, chunks: [], vault: 0, busy: false, ni: 0 };
const byMode = {}; // cached chunk lists for the loaded vault, one per mode

// ---- messages and progress -------------------------------------------------
function say(t, info = false) { const m = $('msg'); m.textContent = t; m.className = info ? 'info' : ''; }
function bar(frac) { const b = $('bar'); b.classList.toggle('on', frac != null); if (frac != null) b.firstElementChild.style.width = Math.round(frac * 100) + '%'; }
setHooks({ status: (s, t) => { $('model').dataset.s = s; $('modeltext').textContent = t; }, progress: bar });
function setBusy(b) {
  S.busy = b;
  for (const el of document.querySelectorAll('#folder,#files,#pick,#sample,#go,#q,#prefix,input[name=mode],#notesel')) el.disabled = b;
}

// ---- reading a vault -------------------------------------------------------
const hidden = (segs) => segs.some((s) => s.startsWith('.'));
const isMd = (p) => /\.(md|markdown)$/i.test(p);

async function readEntries(dir) { // readEntries returns at most ~100 items per call; loop until empty
  const reader = dir.createReader(), all = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return all;
    all.push(...batch);
  }
}
async function walk(entry, out) {
  if (entry.name.startsWith('.')) return;
  if (entry.isFile) out.push({ path: entry.fullPath.replace(/^\//, ''), file: () => new Promise((res, rej) => entry.file(res, rej)) });
  else for (const e of await readEntries(entry)) await walk(e, out);
}

async function ingest(items, dropRoot) {
  const doc = ++S.vault;
  say('Reading notes…', true);
  let ignored = 0;
  const cand = [];
  for (const it of items) {
    const segs = it.path.split('/');
    const rel = dropRoot && segs.length > 1 ? segs.slice(1) : segs;
    if (hidden(rel) || !isMd(it.path)) { ignored++; continue; }
    cand.push({ ...it, path: rel.join('/') });
  }
  cand.sort((a, b) => a.path.localeCompare(b.path));
  if (!cand.length) return say('No Markdown (.md) notes found there.');
  const use = cand.slice(0, MAX_NOTES);
  const notes = [];
  let big = 0, empty = 0;
  for (let i = 0; i < use.length; i += 40) {
    const texts = await Promise.all(use.slice(i, i + 40).map(async (it) => {
      const f = await it.file();
      return f.size > MAX_NOTE_BYTES ? null : f.text();
    }));
    texts.forEach((t, j) => {
      if (t == null) return big++;
      const n = parseNote(use[i + j].path, t);
      n.body ? notes.push(n) : empty++;
    });
    bar((i + 40) / use.length);
  }
  bar(null);
  if (doc !== S.vault) return;
  if (!notes.length) return say('Those notes had no readable text.');
  const notes_ = [`${notes.length} notes`];
  if (cand.length > MAX_NOTES) notes_.push(`${cand.length - MAX_NOTES} skipped (limit ${MAX_NOTES})`);
  if (big) notes_.push(`${big} over 1 MB skipped`);
  if (empty) notes_.push(`${empty} empty`);
  if (ignored) notes_.push(`${ignored} non-note files ignored`);
  load(notes, notes_.join(', '));
}

function load(notes, summary) {
  S.notes = notes; S.hoffs = notes.map((n) => new Set([0, ...headingOffsets(n.body)]));
  S.ni = 0;
  for (const k of Object.keys(byMode)) delete byMode[k];
  $('loaded').textContent = 'Loaded: ' + summary + '.';
  say('');
  $('chunking').hidden = $('asking').hidden = $('out').hidden = false;
  $('notesel').replaceChildren(...notes.map((n, i) => Object.assign(document.createElement('option'), { value: i, textContent: n.path })));
  clearResults();
  getExtractor().catch(() => {}); // start the model download now
  rechunk();
}

// ---- chunking --------------------------------------------------------------
const label = (c) => c.path.filter((p, i) => p !== c.path[i - 1]).join(' > '); // collapse "Note > Note" when the H1 repeats the title
const embedText = (c) => (S.prefix ? label(c) + '\n' + c.text : c.text);

function chunksFor(mode) {
  if (byMode[mode]) return byMode[mode];
  const out = [];
  S.notes.forEach((n, ni) => (mode === 'heading' ? headingChunks(n) : fixedNoteChunks(n)).forEach((c) => out.push({ ...c, ni })));
  return (byMode[mode] = out);
}

function stats(chunks) {
  const total = chunks.reduce((s, c) => s + c.end - c.start, 0);
  return {
    n: chunks.length,
    avg: Math.round(total / chunks.length),
    atHeading: Math.round((chunks.filter((c) => S.hoffs[c.ni].has(c.start)).length / chunks.length) * 100),
    spanning: chunks.filter((c) => [...S.hoffs[c.ni]].some((h) => h > c.start && h < c.end)).length,
  };
}

function rechunk() {
  clearResults();
  S.chunks = chunksFor(S.mode);
  if (S.chunks.length > MAX_CHUNKS) say(`This vault makes ${S.chunks.length} chunks. Searching will embed all of them in your browser and may take several minutes.`, true);
  renderCompare(); renderNote();
}

function renderCompare() {
  const box = $('cmp'); box.replaceChildren();
  for (const [mode, title, hint] of [['heading', 'By heading', 'sections, merged when tiny, split when long'], ['fixed', 'Fixed size', '500 characters, 80 overlap']]) {
    const s = stats(chunksFor(mode)), d = document.createElement('div');
    d.className = mode === S.mode ? 'on' : '';
    const h = document.createElement('h3'); h.textContent = title; const p = document.createElement('div'); p.textContent = hint;
    const l1 = document.createElement('div'), l2 = document.createElement('div');
    l1.append(b(s.n), ' chunks, ', b(s.avg), ' chars on average');
    l2.append(b(s.atHeading + '%'), ' start at a heading; ', b(s.spanning), ' run across two or more sections');
    d.append(h, p, l1, l2); box.append(d);
  }
  function b(v) { const e = document.createElement('b'); e.textContent = v; return e; }
}

// ---- inspecting one note ---------------------------------------------------
function renderNote() {
  const ni = S.ni, n = S.notes[ni], body = n.body;
  $('notesel').value = ni;
  const mine = S.chunks.map((c, g) => [c, g]).filter(([c]) => c.ni === ni);
  $('notemeta').replaceChildren(...[['Chunks', mine.length], ['Length', body.length + ' chars'], ['Tags', n.tags.length ? n.tags.join(', ') : 'none']].map(([k, v]) => {
    const s = document.createElement('span'); s.append(k + ': '); const e = document.createElement('b'); e.textContent = v; s.append(e); return s;
  }));
  const map = $('map'); map.replaceChildren();
  mine.forEach(([c, g], k) => {
    const el = document.createElement('button');
    el.type = 'button'; el.dataset.g = g;
    el.style.cssText = `left:${(c.start / body.length) * 100}%;width:${((c.end - c.start) / body.length) * 100}%;top:${(k % 2) * 21 + 1}px;background:hsl(${hue(g)} 65% 55%)`;
    el.title = `${label(c)}: ${c.end - c.start} characters`; el.setAttribute('aria-label', el.title);
    el.onclick = () => select(g, false);
    map.append(el);
  });
  // headings are bold; every boundary (chunk start/end, heading start/end) splits the text into segments
  const hr = [...S.hoffs[ni]].filter((h) => h > 0 || /^#{1,6}\s/.test(body)).map((h) => [h, (body.indexOf('\n', h) + 1 || body.length + 1) - 1]);
  const pts = [...new Set([0, body.length, ...mine.flatMap(([c]) => [c.start, c.end]), ...hr.flat()])].filter((p) => p <= body.length).sort((a, b) => a - b);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], z = pts[k + 1];
    const cover = mine.filter(([c]) => c.start <= a && c.end >= z).map(([, g]) => g);
    const isHead = hr.some(([s, e]) => a >= s && z <= e);
    const el = document.createElement('span');
    el.className = 'seg' + (cover.length > 1 ? ' ov' : '') + (isHead ? ' hd' : '');
    el.dataset.c = ',' + cover.join(',') + ',';
    if (cover.length) el.style.background = `hsl(${hue(cover.at(-1))} 45% 26%)`;
    el.textContent = body.slice(a, z);
    frag.append(el);
  }
  $('doc').replaceChildren(frag);
  $('legend').textContent = 'This is the cleaned note: frontmatter, wikilink brackets, embeds, comments and Dataview blocks are removed. Striped text is shared by two chunks.';
  select(S.sel ?? -1, false);
}

function select(g, scroll) {
  S.sel = g;
  if (g >= 0 && S.chunks[g] && S.chunks[g].ni !== S.ni) { S.ni = S.chunks[g].ni; return renderNote(); }
  document.querySelectorAll('#map button').forEach((e) => e.classList.toggle('hit', +e.dataset.g === g));
  const hits = [];
  document.querySelectorAll('#doc .seg').forEach((e) => { const on = g >= 0 && e.dataset.c.includes(',' + g + ','); e.classList.toggle('hit', on && !e.classList.contains('ov')); if (on) hits.push(e); });
  document.querySelectorAll('.hitcard').forEach((c) => c.classList.toggle('sel', +c.dataset.g === g));
  if (scroll && hits[0]) {
    const box = $('doc');
    box.scrollTo({ top: hits[0].offsetTop - box.offsetTop - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('chunking').scrollIntoView({ block: 'nearest' });
  }
}

// ---- retrieval -------------------------------------------------------------
function clearResults() {
  S.sel = -1;
  const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Results appear here after you ask a question.';
  $('results').replaceChildren(e);
}

function column(title, note, hits, chunks, scoreText, rel) {
  const col = document.createElement('div'); col.className = 'col';
  const h = document.createElement('h3'); h.append(title); const sm = document.createElement('small'); sm.textContent = note; h.append(sm); col.append(h);
  if (!hits.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No chunk contains any of the question’s words, so keyword search returns nothing.'; col.append(e); return col; }
  hits.forEach((hit, rank) => {
    const c = chunks[hit.index], n = S.notes[c.ni], card = document.createElement('div');
    card.className = 'hitcard'; card.dataset.g = hit.index; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.style.borderLeftColor = `hsl(${hue(hit.index)} 65% 55%)`;
    const meta = document.createElement('div'); meta.className = 'meta';
    const l = document.createElement('span'); l.className = 'path'; l.textContent = `#${rank + 1} · ${label(c)}`;
    const r = document.createElement('span'); r.textContent = scoreText(hit.score); meta.append(l, r);
    const file = document.createElement('div'); file.className = 'tags'; file.textContent = n.path + (n.tags.length ? ' · #' + n.tags.join(' #') : '');
    const sc = document.createElement('div'); sc.className = 'score'; const f = document.createElement('i'); f.style.width = Math.max(2, rel(hit.score) * 100) + '%'; sc.append(f);
    const p = document.createElement('p'); p.textContent = c.text;
    card.append(meta, file, sc, p);
    const go = () => select(hit.index, true);
    card.onclick = go; card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    col.append(card);
  });
  return col;
}

async function ask(e) {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q || !S.chunks.length || S.busy) return;
  const chunks = S.chunks, doc = S.vault, texts = chunks.map(embedText);
  setBusy(true); say('');
  const cols = [];
  try {
    say(`Embedding ${texts.length} chunks (chunks seen before are cached)…`, true);
    const [vecs, [qv]] = await Promise.all([embed(texts, bar), embed([q])]);
    cols.push(column('Semantic', 'cosine similarity', topK(vecs.map((v) => dot(v, qv)), 3), chunks, (s) => s.toFixed(3), (s) => Math.max(0, s)));
    const kw = topK(bm25(texts, q), 3).filter((t) => t.score > 0), max = kw[0]?.score || 1;
    cols.push(column('Keyword', 'BM25 score', kw, chunks, (s) => s.toFixed(2), (s) => s / max));
  } catch (err) { bar(null); setBusy(false); return say('Search failed: ' + (err.message || err)); }
  bar(null); say('');
  setBusy(false);
  if (doc !== S.vault || chunks !== S.chunks) return; // vault or chunking changed mid-search
  $('results').replaceChildren(...cols);
  const first = cols[0].querySelector('.hitcard');
  if (first) select(+first.dataset.g, false);
}

// ---- wiring ----------------------------------------------------------------
const fromInput = (files, folder) => [...files].map((f) => ({ path: folder ? f.webkitRelativePath || f.name : f.name, file: async () => f }));
$('folder').onchange = (e) => { const f = e.target.files; if (f.length) { $('dropname').textContent = (f[0].webkitRelativePath.split('/')[0] || 'Vault') + ' (' + f.length + ' files)'; ingest(fromInput(f, true), true).catch((x) => say(x.message)); } };
$('pick').onclick = () => $('files').click();
$('files').onchange = (e) => { const f = e.target.files; if (f.length) { $('dropname').textContent = f.length + ' selected notes'; ingest(fromInput(f, false), false).catch((x) => say(x.message)); } };
$('sample').onclick = () => {
  $('dropname').textContent = 'Sample vault (built in)';
  $('folder').value = '';
  const items = Object.entries(SAMPLE_VAULT).map(([path, text]) => ({ path, file: async () => new File([text], path.split('/').pop()) }));
  ingest(items, false).catch((x) => say(x.message));
  $('sugg').hidden = false;
};

const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  // DataTransfer is only valid synchronously, so grab entries and files before the first await.
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const loose = [...e.dataTransfer.files];
  try {
    if (entries.length) {
      const items = [];
      for (const en of entries) await walk(en, items);
      const dirs = entries.some((en) => en.isDirectory);
      $('dropname').textContent = entries.map((en) => en.name).join(', ');
      await ingest(items, dirs);
    } else if (loose.length) await ingest(fromInput(loose, false), false);
  } catch (x) { bar(null); say(x.message || 'Could not read that drop.'); }
});
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault()); // a miss must not navigate away

$('ask').onsubmit = ask;
$('notesel').onchange = () => { S.ni = +$('notesel').value; S.sel = -1; renderNote(); };
$('prefix').onchange = () => { S.prefix = $('prefix').checked; clearResults(); };
document.querySelectorAll('input[name=mode]').forEach((r) => r.onchange = () => { S.mode = r.value; if (S.notes.length) rechunk(); });
$('sugg').replaceChildren(...SAMPLE_QUESTIONS.map((s) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
  b.onclick = () => { $('q').value = s; $('ask').requestSubmit(); };
  return b;
}));
