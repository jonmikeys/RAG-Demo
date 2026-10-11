// Run: node test/obsidian.test.mjs
import assert from 'node:assert/strict';
import { parseNote, cleanBody, sections, headingChunks, fixedNoteChunks } from '../site/obsidian.js';

// frontmatter: three tag shapes, body excludes frontmatter
const inline = parseNote('A/Note.md', '---\ntags: [cooking, "bread"]\n---\nHello');
assert.deepEqual(inline.tags, ['cooking', 'bread']);
assert.equal(inline.body, 'Hello');
assert.equal(inline.title, 'Note');
assert.deepEqual(parseNote('x.md', '---\ntags: a, #b\n---\nx').tags, ['a', 'b']);
assert.deepEqual(parseNote('x.md', '---\ntitle: T\ntags:\n  - one\n  - two\nother: 1\n---\nx').tags, ['one', 'two']);
assert.equal(parseNote('x.md', 'no frontmatter\n---\nstill body').body, 'no frontmatter\n---\nstill body');
assert.equal(parseNote('x.md', '---\r\ntags: [a]\r\n---\r\nwin').body, 'win');

// cleaning
const dirty = [
  'See [[Flour Notes]] and [[Flour Notes|the flour page]] or [[Tomatoes#Watering]].',
  '![[diagram.png]] ![alt](pic.png)',
  '%% hidden\ncomment %% kept',
  '```dataview\nTABLE file.name\n```',
  '> [!warning]+ Careful',
  '> text under callout',
  'A line with a block id ^abc123',
  'This is ==important==.',
].join('\n');
const clean = cleanBody(dirty);
assert.ok(clean.includes('See Flour Notes and the flour page or Tomatoes Watering.'), clean);
assert.ok(!/\[\[|!\[|%%|dataview|TABLE|\^abc|==|\[!/.test(clean), 'syntax removed: ' + clean);
assert.ok(clean.includes('> Careful') && clean.includes('kept') && clean.includes('important.'));

// sections: nesting, parent heading-only section, code fence ignored
const md = '# Top\nintro\n## A\naaa\n### A1\nnested\n## B\nbbb\n```\n# not a heading\n```\n';
const s = sections(md);
assert.deepEqual(s.map((x) => x.path), [['Top'], ['Top', 'A'], ['Top', 'A', 'A1'], ['Top', 'B']]);
assert.ok(s[3].text.includes('# not a heading'));
assert.deepEqual(sections('just text, no headings').map((x) => x.path), [[]]);

// heading chunks: small sections merge, path survives, long section splits within max
const long = 'Sentence about tomatoes growing tall. '.repeat(80); // ~3000 chars
const note = { title: 'Garden', body: `# Garden\n## Tiny\nshort\n## Watering\n${'Water deeply twice a week in the morning. '.repeat(6)}\n## Long\n${long}\n## Tail\nx` };
const chunks = headingChunks(note, { min: 150, max: 1200 });
assert.ok(chunks.every((c) => c.text.length <= 1200), 'max respected: ' + chunks.map((c) => c.text.length));
assert.ok(chunks.every((c) => c.path[0] === 'Garden'));
const water = chunks.find((c) => c.text.includes('Water deeply'));
assert.deepEqual(water.path, ['Garden', 'Garden', 'Watering'], 'merged chunk takes the path of its larger part');
assert.ok(water.text.includes('short'), 'tiny section merged into neighbour');
assert.ok(chunks.filter((c) => c.path.at(-1) === 'Long').length >= 3, 'long section split');
assert.ok(chunks.some((c) => c.text.includes('x')), 'tail kept');
assert.ok(chunks.every((c) => c.text.trim().length), 'no empty chunks');
assert.deepEqual(headingChunks({ title: 'T', body: '' }), []);
assert.ok(chunks.every((c) => note.body.slice(c.start, c.end) === c.text), 'offsets slice back to the chunk text');
assert.ok(chunks.every((c, i) => i === 0 || c.start >= chunks[i - 1].start), 'chunks stay in document order');

// fixed alternative ignores headings entirely
const f = fixedNoteChunks(note, 500, 80);
assert.ok(f.every((c) => c.path.length === 1 && c.text.length <= 500));
assert.ok(f.some((c) => /^## |\n## /.test(c.text)), 'fixed chunks can straddle headings');

console.log('obsidian tests passed');
