/**
 * Dedicated-worker feasibility check for the Transformers.js engine (the
 * product runs its engine in a dedicated worker inside the offscreen
 * document). Loads one model on WebGPU inside a Worker and runs one short
 * greedy generation. Benchmark-only.
 */
import { AutoModelForCausalLM, AutoTokenizer, env, type Tensor } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useWasmCache = false;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  onnxWasm.wasmPaths = {
    mjs: `${location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

self.onmessage = async (event: MessageEvent<{ repo: string; revision: string }>) => {
  const { repo, revision } = event.data;
  try {
    const hasGpu = "gpu" in navigator;
    const t0 = performance.now();
    const tokenizer = await AutoTokenizer.from_pretrained(repo, { revision });
    const model = await AutoModelForCausalLM.from_pretrained(repo, {
      revision,
      dtype: "q4f16",
      device: "webgpu",
    });
    const loadMs = performance.now() - t0;
    const inputs = tokenizer.apply_chat_template(
      [{ role: "user", content: "Correct the spelling: She dont know." }],
      { add_generation_prompt: true, return_dict: true },
    ) as { input_ids: Tensor; attention_mask: Tensor };
    const t1 = performance.now();
    const output = (await model.generate({
      ...inputs,
      max_new_tokens: 16,
      do_sample: false,
    })) as Tensor;
    const tokens = output.dims.at(-1)! - inputs.input_ids.dims.at(-1)!;
    await model.dispose();
    postMessage({ ok: true, hasGpu, loadMs, genMs: performance.now() - t1, tokens });
  } catch (error) {
    postMessage({ ok: false, error: String(error).slice(0, 300) });
  }
};
