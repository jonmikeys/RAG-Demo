// Shared by /demo/ and /vault/. One model download per browser, cached by the HTTP cache.
const BATCH = 16;
const hooks = { status() {}, progress() {} };
export const setHooks = (h) => Object.assign(hooks, h);

const vecCache = new Map();
let extractorP = null;

export function getExtractor() {
  if (extractorP) return extractorP;
  hooks.status('loading', 'Embedding model: loading…');
  const files = new Map();
  extractorP = import('/vendor/transformers.web.min.js').then(async ({ pipeline, env }) => {
    env.allowRemoteModels = false; // everything is served from this origin
    env.allowLocalModels = true;
    env.localModelPath = '/models/';
    env.backends.onnx.wasm.numThreads = 1; // multi-thread needs cross-origin isolation headers
    env.backends.onnx.wasm.wasmPaths = {
      mjs: location.origin + '/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: location.origin + '/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
    };
    const ex = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0;
        for (const [a, b] of files.values()) { l += a; t += b; }
        hooks.status('loading', `Embedding model: downloading ${Math.round((l / t) * 100)}%`);
        hooks.progress(l / t);
      },
    });
    hooks.status('ready', 'Embedding model: ready (runs in your browser)');
    hooks.progress(null);
    return ex;
  }).catch((e) => {
    extractorP = null;
    hooks.status('error', 'Embedding model: failed to load');
    hooks.progress(null);
    throw e;
  });
  return extractorP;
}

// Returns one unit-length vector per input text. Identical texts are embedded once and cached.
export async function embed(texts, onProgress) {
  const ex = await getExtractor();
  const need = [...new Set(texts)].filter((t) => !vecCache.has(t));
  for (let i = 0; i < need.length; i += BATCH) {
    const batch = need.slice(i, i + BATCH);
    const out = await ex(batch, { pooling: 'mean', normalize: true });
    const dim = out.dims[1];
    batch.forEach((t, j) => vecCache.set(t, out.data.slice(j * dim, (j + 1) * dim)));
    onProgress?.(Math.min(1, (i + BATCH) / need.length));
    await new Promise((r) => setTimeout(r)); // let the progress bar paint
  }
  return texts.map((t) => vecCache.get(t));
}
