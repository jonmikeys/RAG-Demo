// Run: node test/chunker.test.mjs
import assert from 'node:assert/strict';
import { splitSentences, fixedChunks, semanticChunks, neighbourSims, bm25, topK } from '../site/chunker.js';

const text = 'Returns are accepted within 30 days. Refunds go to the original payment method! Shipping takes five days. ' +
  'Express shipping takes two days. ' + 'x'.repeat(900) + '. The end.';

// sentences: offsets slice back to real text, in order, nothing dropped, long run wrapped
const s = splitSentences(text, 400);
assert.equal(text.slice(s[0].start, s[0].end), 'Returns are accepted within 30 days.');
assert.ok(s.every((x, i) => x.end > x.start && (i === 0 || x.start >= s[i - 1].end)), 'ordered, non-empty');
assert.ok(s.every((x) => x.end - x.start <= 400), 'hard wrap respected');
assert.equal(text.slice(s.at(-1).start, s.at(-1).end), 'The end.');

// fixed: covers the whole text, respects size, overlaps neighbours, always advances
const doc = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
const f = fixedChunks(doc, 100, 30);
assert.equal(f[0].start, 0);
assert.equal(f.at(-1).end, doc.length);
assert.ok(f.every((c) => c.end - c.start <= 100), 'size respected');
assert.ok(f.every((c, i) => i === 0 || c.start < f[i - 1].end), 'neighbours overlap');
assert.ok(f.every((c, i) => i === 0 || c.start > f[i - 1].start), 'always advances');
assert.equal(fixedChunks(doc, 100, 0).every((c, i, a) => i === 0 || c.start >= a[i - 1].end), true, 'overlap 0 means no overlap');
assert.deepEqual(fixedChunks('', 100, 10), []);

// semantic: hand-made unit vectors, topic flips between sentence 2 and 3
const sents = Array.from({ length: 6 }, (_, i) => ({ start: i * 100, end: i * 100 + 90 }));
const A = [1, 0], B = [0, 1];
const sims = neighbourSims([A, A, A, B, B, B]);
assert.deepEqual(sims, [1, 1, 0, 1, 1]);
const { chunks } = semanticChunks(sents, sims, { breakPct: 20, minChars: 100, maxChars: 10000 });
assert.deepEqual(chunks.map((c) => [c.sentenceFrom, c.sentenceTo]), [[0, 2], [3, 5]]);
// maxChars forces extra cuts even without a topic shift
assert.ok(semanticChunks(sents, sims, { breakPct: 20, minChars: 100, maxChars: 200 }).chunks.length > 2);
assert.deepEqual(semanticChunks([], []).chunks, []);

// keyword: finds shared words, scores zero when the wording differs
const docs = ['Refunds are issued to the original payment method within 30 days.', 'Shipping takes five working days.'];
assert.equal(topK(bm25(docs, 'when do refunds arrive'), 1)[0].index, 0);
assert.ok(bm25(docs, 'how do I get my money back').every((x) => x === 0), 'no shared words, no score');

console.log('chunker tests passed');
