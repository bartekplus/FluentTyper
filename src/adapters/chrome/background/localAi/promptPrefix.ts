import type {
  DynamicCache,
  Tensor,
  PreTrainedModel,
  PreTrainedTokenizer,
} from "@huggingface/transformers";
import { buildAiMessages } from "@core/domain/grammar/review/ai/prompts";
import type { ModelLike } from "./LocalAiEngine";

// Gemma's evaluated prefix: about 22 MiB on the CPU, never editor content.
const PREFIX_TOKENS = 400;
const MAX_PREFIX_BYTES = 32 * 1024 * 1024;

/** One immutable instruction prefix per loaded Gemma; each request owns its mutable KV cache. */
export function withPromptPrefix(
  model: PreTrainedModel,
  tokenizer: PreTrainedTokenizer,
  runtime: { DynamicCache: typeof DynamicCache; Tensor: typeof Tensor },
): ModelLike {
  const { DynamicCache, Tensor } = runtime;
  const template = (contextBefore: string) =>
    tokenizer.apply_chat_template(
      buildAiMessages({
        mode: "correct",
        style: null,
        lang: "en",
        contextBefore,
        contextAfter: "",
        segments: [{ id: "s0", text: "" }],
      }),
      { add_generation_prompt: true, return_dict: true, ...{ enable_thinking: false } },
    ) as { input_ids: Tensor; attention_mask: Tensor };
  const a = template("a");
  const b = template("b");
  const ids = Array.from(a.input_ids.data.slice(0, PREFIX_TOKENS));
  // Tokenization at a boundary can change: prove the prefix precedes editable/context data.
  if (ids.length !== PREFIX_TOKENS || ids.some((id, i) => id !== b.input_ids.data[i])) {
    return model as unknown as ModelLike;
  }
  let entries: Record<string, Tensor> | null = null;
  let disposed = false;
  let checkedOnce = false;
  const generate = model.generate.bind(model);
  return {
    async generate(options) {
      if (disposed) throw new Error("Instruction prefix model disposed");
      const input = options.input_ids as Tensor;
      const native = options as unknown as Parameters<PreTrainedModel["generate"]>[0];
      if (ids.some((id, i) => id !== input.data[i])) return generate(native);
      // A one-request review needs no reusable cache; show its result without setup.
      if (!checkedOnce) {
        const result = await generate(native);
        checkedOnce = !options.stopping_criteria.some((stopper) => stopper.interrupted);
        return result;
      }
      if (!entries) {
        const output = (await generate({
          input_ids: a.input_ids.slice(null, [0, PREFIX_TOKENS]),
          attention_mask: a.attention_mask.slice(null, [0, PREFIX_TOKENS]),
          max_new_tokens: 1,
          do_sample: false,
          return_dict_in_generate: true,
          stopping_criteria: native.stopping_criteria,
        })) as { past_key_values: DynamicCache };
        try {
          const saved: Record<string, Tensor> = {};
          let bytes = 0;
          for (const [name, tensor] of Object.entries(output.past_key_values)) {
            // getData changes the location to CPU; release here, before DynamicCache
            // would skip disposal of the former GPU buffer.
            const data = await tensor.ort_tensor.getData(true);
            if (Array.isArray(data)) throw new Error("Invalid instruction prefix tensor");
            bytes += data.byteLength;
            if (bytes > MAX_PREFIX_BYTES || tensor.dims.at(-2) !== PREFIX_TOKENS) {
              throw new Error("Invalid instruction prefix cache");
            }
            saved[name] = new Tensor(tensor.type, data.slice(), tensor.dims.slice());
          }
          if (bytes === 0) throw new Error("Empty instruction prefix cache");
          if (!disposed && !options.stopping_criteria.some((stopper) => stopper.interrupted)) {
            entries = saved;
          }
        } finally {
          await output.past_key_values.dispose();
        }
      }
      if (disposed || options.stopping_criteria.some((stopper) => stopper.interrupted)) {
        throw new Error("Instruction prefix generation cancelled");
      }
      const cache = new DynamicCache(entries!);
      try {
        return await generate({ ...native, past_key_values: cache });
      } finally {
        await cache.dispose();
      }
    },
    async dispose() {
      disposed = true;
      entries = null;
      await model.dispose();
    },
  };
}
