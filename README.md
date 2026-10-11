# RAG-Demo

Two single-page demos of the **retrieval** half of RAG, running entirely in the browser. Nothing is uploaded; there is no backend and no API key.

- `/` landing page
- `/demo/` drop a `.txt`, `.md`, `.csv` or `.pdf`, watch it get chunked (fixed size, or semantic by sentence similarity), ask a question, compare semantic search with keyword search (BM25)
- `/vault/` drop an Obsidian vault folder (or use the built-in sample). Notes are cleaned (frontmatter, wikilinks, embeds, comments, Dataview blocks), chunked along their headings, and every result shows its note and heading path. A side-by-side comparison against fixed-size chunking is shown.

Embeddings come from [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (quantized, 23 MB) via [transformers.js](https://github.com/huggingface/transformers.js). PDF text comes from [pdf.js](https://mozilla.github.io/pdf.js/). First load downloads about 50 MB (model plus the 27 MB ONNX WebAssembly runtime); the browser caches it afterwards. No LLM writes an answer; the pages show the retrieved chunks only.

Live: https://rag.jonmikeys.com

## Run it

```bash
scripts/fetch-assets.sh          # downloads ~65 MB of libraries and the model into site/vendor and site/models
python3 -m http.server 8099 --directory site
# open http://127.0.0.1:8099/
```

The site uses root-absolute paths (`/vendor/...`, `/models/...`), so serve `site/` as the root of a host. A subpath will not work.

Any static server works. Serving `/vendor/*` and `/models/*` with a long `Cache-Control` and gzip or zstd is worth it. See `deploy/Caddyfile.example`.

## Layout

```
site/
  index.html            landing page
  style.css             shared styles
  chunker.js            sentence splitting, fixed and semantic chunking, BM25 (pure functions)
  obsidian.js           note parsing, syntax cleanup, heading chunking (pure functions)
  embed.js              lazy model loader and embedding cache, shared by both pages
  demo/                 document demo
  vault/                vault demo (+ sample.js, a made-up vault)
scripts/fetch-assets.sh pinned downloads of the libraries and model
deploy/Caddyfile.example
test/                   unit tests (node) and browser tests (playwright)
```

## Tests

```bash
node test/chunker.test.mjs
node test/obsidian.test.mjs

# browser tests: serve site/ on :8099 first
PLAYWRIGHT_CORE=/path/to/playwright-core CHROME_PATH=/path/to/chrome node test/e2e-pages.mjs
```

The browser test loads each page, runs real embeddings, checks that semantic search finds the refunds paragraph and the sourdough note, checks folder upload skips hidden folders, checks no horizontal scroll at 390 px, and fails on any console error or any request that leaves the origin.

## Known limits

- Fixed-size defaults (300 characters, 50 overlap) were chosen by a small sweep on the sample document: 5 of 5 test questions answered correctly at 250 to 300 characters, 4 of 5 at 350 and above. That is five questions on one short document, so it is a demo default and not a benchmark.
- Scanned PDFs have no text layer, and there is no OCR.
- The embedder runs single-threaded in WebAssembly (multi-threading needs cross-origin isolation headers). A few hundred chunks take seconds; tens of thousands take minutes.
- The vault demo caps at 2,000 notes, 1 MB per note, and warns above 3,000 chunks. Embeddings are cached in memory only, so a reload re-embeds.
- The frontmatter parser reads `tags` only.
- Folder drop needs a desktop browser; `webkitdirectory` support on mobile is poor. "Choose .md files instead" works as a fallback.
