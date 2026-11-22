# all-MiniLM-L6-v2 (int8 ONNX)

The small sentence-embedding model Open Historia runs on the player's device to
find related past events for a time skip (`src/runtime/embeddingModels.js`). It
ships with the game and is read from the game's own files; nothing is downloaded.

- Model: all-MiniLM-L6-v2 by the sentence-transformers project
  (https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), built on
  Microsoft's MiniLM.
- ONNX conversion: Xenova, for Transformers.js
  (https://huggingface.co/Xenova/all-MiniLM-L6-v2), revision
  `751bff37182d3f1213fa05d7196b954e230abad9`.
- Files, unchanged from that revision: `config.json` (650 bytes),
  `tokenizer.json` (711,661), `tokenizer_config.json` (366),
  `onnx/model_quantized.onnx` (22,972,370; sha256
  `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`).
  23,685,047 bytes in all.
- Licence: Apache License 2.0 (`LICENSE` beside this file).
