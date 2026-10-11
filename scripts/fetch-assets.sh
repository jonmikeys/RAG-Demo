#!/usr/bin/env bash
# Downloads the browser libraries and the embedding model into site/vendor and site/models (about 65 MB).
# Everything is self-hosted so the page makes no third-party requests at runtime.
set -euo pipefail
cd "$(dirname "$0")/../site"

TRANSFORMERS=4.3.1
PDFJS=6.4.299
ORT=1.31.0-dev.20260914-8d85527a0   # the onnxruntime-web version transformers $TRANSFORMERS depends on
JSD=https://cdn.jsdelivr.net/npm
HF=https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main

mkdir -p vendor/ort models/Xenova/all-MiniLM-L6-v2/onnx
get() { [ -s "$2" ] || { echo "fetch $2"; curl -fsSL -o "$2" "$1"; }; }

get $JSD/@huggingface/transformers@$TRANSFORMERS/dist/transformers.web.min.js vendor/transformers.web.min.js
get $JSD/pdfjs-dist@$PDFJS/build/pdf.min.mjs vendor/pdf.min.mjs
get $JSD/pdfjs-dist@$PDFJS/build/pdf.worker.min.mjs vendor/pdf.worker.min.mjs
for f in ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm ort.webgpu.min.mjs ort.webgpu.bundle.min.mjs; do
  get $JSD/onnxruntime-web@$ORT/dist/$f vendor/ort/$f
done
for f in config.json tokenizer.json tokenizer_config.json; do get $HF/$f models/Xenova/all-MiniLM-L6-v2/$f; done
get $HF/onnx/model_quantized.onnx models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
echo done
