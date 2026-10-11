import { splitSentences, fixedChunks, neighbourSims, semanticChunks, dot, bm25, topK } from '/chunker.js';
import { embed, getExtractor, setHooks } from '/embed.js';

const MAX_CHARS = 60000, MAX_BYTES = 10 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const hue = (i) => (i * 47) % 360;

const SAMPLE = `Returns and refunds

You can return any unused item within 30 days of delivery. Once the warehouse inspects the parcel, the full amount is credited to the original payment method. Credits usually appear in five to ten business days, depending on your bank. Items marked final sale cannot be returned.

Shipping

Standard shipping takes five to seven business days within Singapore and Malaysia. Express shipping takes two business days and costs an extra eight dollars. If the tracking page has not moved in five days, contact support and we will send a replacement at no charge. We do not ship to PO boxes.

Account and sign-in

To reset your password, choose Forgot password on the sign-in page and follow the link we email you. The link expires after one hour. If you no longer have access to your email address, support can verify your identity with the last four digits of a past order and change it for you.

Privacy and data retention

We keep order records for seven years because tax rules require it. Accounts with no activity for 24 months are deleted along with saved addresses and wishlists. You can request a copy of your data or ask us to erase it at any time from the privacy page.

Warranty and repairs

Backpacks and tents carry a lifetime repair guarantee. If a zipper fails or a tent pole snaps, send it in and we will fix it or swap it for the same model. Damage from fire or deliberate cutting is not covered. Footwear is covered for twelve months against defects in the sole and stitching.

Contacting support

Support is available from 9am to 6pm Singapore time, Monday to Friday. Chat replies arrive within a few minutes during those hours, and emails sent outside them are answered the next business day.`;

const SUGGESTIONS = ['How do I get my money back?', 'My parcel never showed up', "I can't log in", 'How long do you keep my data?', 'What if a tent pole snaps?'];

const S = { text: '', mode: 'fixed', chunks: [], sentences: [], sentVecs: null, sims: [], threshold: 0, sel: -1, doc: 0, busy: false, isSample: false };

// ---- messages and progress -------------------------------------------------
function say(t, info = false) { const m = $('msg'); m.textContent = t; m.className = info ? 'info' : ''; }
function bar(frac) { const b = $('bar'); b.classList.toggle('on', frac != null); if (frac != null) b.firstElementChild.style.width = Math.round(frac * 100) + '%'; }
function setModel(state, text) { $('model').dataset.s = state; $('modeltext').textContent = text; }

setHooks({ status: setModel, progress: bar });

// ---- reading files ---------------------------------------------------------
function normalise(t) {
  const bad = (t.match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length;
  if (bad > t.length * 0.02 + 5) throw new Error("This looks like a binary file, not text.");
  return t.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfText(file) {
  const pdfjs = await import('/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages && out.length < MAX_CHARS; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    out += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n\n';
    bar(p / pdf.numPages);
  }
  bar(null);
  return out;
}

async function handleFile(file) {
  if (!file) return;
  say('');
  if (file.size > MAX_BYTES) return say('That file is over 10 MB.');
  const pdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (!pdf && !/\.(txt|md|markdown|csv|log)$/i.test(file.name) && !file.type.startsWith('text/')) return say('Use a .txt, .md, .csv or .pdf file.');
  try {
    say('Reading file…', true);
    const raw = pdf ? await pdfText(file) : await file.text();
    $('dropname').textContent = file.name;
    await loadDocument(raw, false);
  } catch (e) {
    bar(null);
    say(e.message || 'Could not read that file.');
  }
}

// ---- document lifecycle ----------------------------------------------------
async function loadDocument(raw, isSample) {
  const text = normalise(raw);
  if (text.length < 40) return say("Couldn't find readable text. A scanned PDF has no text layer, and this page does not do OCR.");
  const doc = ++S.doc;
  const clipped = text.length > MAX_CHARS;
  Object.assign(S, { text: text.slice(0, MAX_CHARS), sel: -1, sentences: [], sentVecs: null, sims: [], isSample });
  say(clipped ? `Long document: using the first ${MAX_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters.` : '', true);
  $('sugg').hidden = !isSample;
  $('q').disabled = $('how').disabled = $('go').disabled = false;
  $('q').placeholder = isSample ? 'e.g. How do I get my money back?' : 'Ask something your document answers';
  clearResults();
  getExtractor().catch(() => {}); // start the download now; failures surface when it is needed
  await rechunk(doc);
}

async function rechunk(doc = S.doc) {
  clearResults();
  if (S.mode === 'fixed') {
    S.chunks = fixedChunks(S.text, +$('size').value, +$('ov').value);
  } else {
    S.sentences = S.sentences.length ? S.sentences : splitSentences(S.text);
    if (S.sentences.length < 3) { S.chunks = fixedChunks(S.text, 500, 80); say('Too few sentences for semantic chunking; showing fixed-size chunks.', true); }
    else {
      if (!S.sentVecs) {
        setBusy(true);
        try {
          say('Embedding every sentence to find where the topic changes…', true);
          S.sentVecs = await embed(S.sentences.map((s) => S.text.slice(s.start, s.end)), bar);
          bar(null); say('', true);
        } catch (e) { bar(null); setBusy(false); say('The embedding model failed to load: ' + (e.message || e)); return; }
        setBusy(false);
        if (doc !== S.doc) return;
      }
      S.sims = neighbourSims(S.sentVecs);
      const r = semanticChunks(S.sentences, S.sims, { breakPct: +$('pct').value });
      S.chunks = r.chunks; S.threshold = r.threshold;
    }
  }
  render();
}

function setBusy(b) {
  S.busy = b;
  for (const el of document.querySelectorAll('#size,#ov,#pct,input[name=mode],#go,#sample,#file')) el.disabled = b || (el.id === 'go' && !S.text);
}

// ---- visualisation ---------------------------------------------------------
function render() {
  const { text, chunks } = S;
  $('viz').hidden = false;
  const lens = chunks.map((c) => c.end - c.start);
  const total = lens.reduce((a, b) => a + b, 0);
  $('stats').innerHTML = '';
  for (const [k, v] of [['Chunks', chunks.length], ['Average', Math.round(total / chunks.length) + ' chars'], ['Shortest', Math.min(...lens) + ' chars'], ['Longest', Math.max(...lens) + ' chars'], ['Repeated text', Math.max(0, Math.round((total / text.length - 1) * 100)) + '%']]) {
    const s = document.createElement('span'); s.append(k + ': '); const b = document.createElement('b'); b.textContent = v; s.append(b); $('stats').append(s);
  }
  renderMap(); renderDoc(); renderChart();
  $('legend').replaceChildren(...(chunks.some((c, i) => i && c.start < chunks[i - 1].end) ? [Object.assign(document.createElement('i')), 'Striped text is shared by two chunks (the overlap).'] : ['Each coloured block is one chunk.']));
}

function renderMap() {
  const map = $('map'); map.replaceChildren();
  S.chunks.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.i = i;
    b.style.cssText = `left:${(c.start / S.text.length) * 100}%;width:${((c.end - c.start) / S.text.length) * 100}%;top:${(i % 2) * 21 + 1}px;background:hsl(${hue(i)} 65% 55%)`;
    b.title = `Chunk ${i + 1}: ${c.end - c.start} characters`;
    b.setAttribute('aria-label', b.title);
    b.onclick = () => select(i, true);
    map.append(b);
  });
}

function renderDoc() {
  const { text, chunks } = S;
  const pts = [...new Set([0, text.length, ...chunks.flatMap((c) => [c.start, c.end])])].sort((a, b) => a - b);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    chunks.forEach((c, i) => {
      if (c.start !== a) return;
      const t = document.createElement('span'); t.className = 'tag'; t.textContent = '#' + (i + 1); t.style.background = `hsl(${hue(i)} 70% 65%)`; frag.append(t);
    });
    const cover = [];
    chunks.forEach((c, i) => { if (c.start <= a && c.end >= b) cover.push(i); });
    if (!cover.length) { frag.append(text.slice(a, b)); continue; }
    const s = document.createElement('span');
    s.className = 'seg' + (cover.length > 1 ? ' ov' : '');
    s.dataset.c = ',' + cover.join(',') + ',';
    s.style.background = `hsl(${hue(cover.at(-1))} 45% 26%)`;
    s.textContent = text.slice(a, b);
    frag.append(s);
  }
  $('doc').replaceChildren(frag);
}

function renderChart() {
  const show = S.mode === 'semantic' && S.sims.length > 1;
  $('chartwrap').hidden = !show;
  if (!show) return;
  const n = S.sims.length, lo = Math.min(...S.sims), hi = Math.max(...S.sims), span = hi - lo || 1;
  const x = (i) => 10 + (i / (n - 1)) * 780, y = (v) => 118 - ((v - lo) / span) * 100;
  const cuts = S.chunks.slice(0, -1).map((c) => c.sentenceTo).filter((i) => i < n);
  $('chart').innerHTML =
    `<polyline fill="none" stroke="#42d4c4" stroke-width="1.5" points="${S.sims.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>` +
    `<line x1="10" x2="790" y1="${y(S.threshold)}" y2="${y(S.threshold)}" stroke="#f0b35a" stroke-dasharray="5 4"/>` +
    cuts.map((i) => `<line x1="${x(i)}" x2="${x(i)}" y1="4" y2="126" stroke="#f0b35a" stroke-opacity=".55"/><circle cx="${x(i)}" cy="${y(S.sims[i])}" r="3.5" fill="#f0b35a"/>`).join('');
}

function select(i, scroll) {
  S.sel = i;
  document.querySelectorAll('#map button').forEach((b) => b.classList.toggle('hit', +b.dataset.i === i));
  const hits = [];
  document.querySelectorAll('#doc .seg').forEach((s) => { const on = s.dataset.c.includes(',' + i + ','); s.classList.toggle('hit', on && !s.classList.contains('ov')); if (on) hits.push(s); });
  document.querySelectorAll('.hitcard').forEach((c) => c.classList.toggle('sel', +c.dataset.i === i));
  if (scroll && hits[0]) {
    const box = $('doc');
    box.scrollTo({ top: hits[0].offsetTop - box.offsetTop - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('viz').scrollIntoView({ block: 'nearest' });
  }
}

// ---- retrieval -------------------------------------------------------------
function clearResults() {
  const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Results appear here after you ask a question.';
  $('results').replaceChildren(e);
}

function column(title, note, hits, chunks, scoreText, rel) {
  const col = document.createElement('div'); col.className = 'col';
  const h = document.createElement('h3'); h.append(title); const sm = document.createElement('small'); sm.textContent = note; h.append(sm); col.append(h);
  if (!hits.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No chunk contains any of the question’s words, so keyword search returns nothing.'; col.append(e); return col; }
  hits.forEach((hit, rank) => {
    const c = chunks[hit.index], card = document.createElement('div');
    card.className = 'hitcard'; card.dataset.i = hit.index; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.style.borderLeftColor = `hsl(${hue(hit.index)} 65% 55%)`;
    const meta = document.createElement('div'); meta.className = 'meta';
    const l = document.createElement('span'); l.append(`#${rank + 1} · chunk `); const bb = document.createElement('b'); bb.textContent = hit.index + 1; l.append(bb);
    const r = document.createElement('span'); r.textContent = scoreText(hit.score); meta.append(l, r);
    const sc = document.createElement('div'); sc.className = 'score'; const f = document.createElement('i'); f.style.width = Math.max(2, rel(hit.score) * 100) + '%'; sc.append(f);
    const p = document.createElement('p'); p.textContent = S.text.slice(c.start, c.end);
    card.append(meta, sc, p);
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
  const how = $('how').value, doc = S.doc, chunks = S.chunks, texts = chunks.map((c) => S.text.slice(c.start, c.end));
  const cols = [];
  setBusy(true); say('');
  try {
    if (how !== 'kw') {
      say(`Embedding ${texts.length} chunks (cached after the first search)…`, true);
      const [vecs, [qv]] = await Promise.all([embed(texts, bar), embed([q])]);
      const scores = vecs.map((v) => dot(v, qv));
      const top = topK(scores, 3);
      cols.push(column('Semantic', 'cosine similarity', top, chunks, (s) => s.toFixed(3), (s) => Math.max(0, s)));
    }
    if (how !== 'sem') {
      const scores = bm25(texts, q);
      const top = topK(scores, 3).filter((t) => t.score > 0);
      const max = top[0]?.score || 1;
      cols.push(column('Keyword', 'BM25 score', top, chunks, (s) => s.toFixed(2), (s) => s / max));
    }
  } catch (err) { bar(null); setBusy(false); return say('Search failed: ' + (err.message || err)); }
  bar(null); say('');
  setBusy(false);
  if (doc !== S.doc || chunks !== S.chunks) return; // document or chunking changed mid-search
  $('results').replaceChildren(...cols);
  const first = cols[0].querySelector('.hitcard');
  if (first) select(+first.dataset.i, false);
}

// ---- wiring ----------------------------------------------------------------
$('file').onchange = (e) => handleFile(e.target.files[0]);
const drop = $('drop');
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => e.preventDefault()); // a miss must not navigate away to the file

$('sample').onclick = () => { $('dropname').textContent = 'Sample handbook (built in)'; $('file').value = ''; loadDocument(SAMPLE, true); };
$('ask').onsubmit = ask;

for (const id of ['size', 'ov', 'pct']) $(id).oninput = () => {
  $('o-size').textContent = $('size').value; $('o-ov').textContent = $('ov').value; $('o-pct').textContent = $('pct').value;
  if (S.text) rechunk();
};
document.querySelectorAll('input[name=mode]').forEach((r) => r.onchange = () => {
  S.mode = r.value;
  $('ctl-fixed').hidden = S.mode !== 'fixed'; $('ctl-sem').hidden = S.mode !== 'semantic';
  $('modehelp').textContent = S.mode === 'fixed'
    ? 'Cuts every N characters, with overlap so ideas on a boundary appear in both chunks.'
    : 'Embeds every sentence, then cuts where the meaning shifts the most between neighbours.';
  if (S.text) rechunk();
});

$('sugg').replaceChildren(...SUGGESTIONS.map((s) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
  b.onclick = () => { $('q').value = s; $('ask').requestSubmit(); };
  return b;
}));
