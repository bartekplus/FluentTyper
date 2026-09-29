import type { DynamicCache, Tensor, PreTrainedModel, PreTrainedTokenizer } from "./engineRuntime";
import { buildAiMessages } from "@core/domain/grammar/review/ai/prompts";
import type { ModelLike } from "./LocalAiEngine";

// Verified against a text-free prompt; the GPU buffer allocation is below 32 MiB.
const PREFIX_TOKENS = 480;
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
  let prefix: DynamicCache | null = null;
  let preparing: Promise<void> | null = null;
  let disposed = false;
  let checkedOnce = false;
  const running = new Set<Promise<unknown>>();
  const generate = model.generate.bind(model);
  const run: ModelLike["generate"] = async (options) => {
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
    while (!prefix) {
      const own = !preparing;
      if (!preparing)
        preparing = (async () => {
          const output = (await generate({
            input_ids: a.input_ids.slice(null, [0, PREFIX_TOKENS]),
            attention_mask: a.attention_mask.slice(null, [0, PREFIX_TOKENS]),
            max_new_tokens: 1,
            do_sample: false,
            return_dict_in_generate: true,
            stopping_criteria: native.stopping_criteria,
          })) as { past_key_values: DynamicCache };
          let keep = false;
          try {
            let bytes = 0;
            for (const tensor of Object.values(output.past_key_values)) {
              if (tensor.location !== "gpu-buffer" || tensor.dims.at(-2) !== PREFIX_TOKENS) {
                throw new Error("Invalid GPU instruction prefix tensor");
              }
              bytes += tensor.ort_tensor.gpuBuffer.size;
              if (bytes > MAX_PREFIX_BYTES)
                throw new Error("Instruction prefix exceeds GPU budget");
            }
            if (bytes === 0) throw new Error("Empty instruction prefix cache");
            if (!disposed && !options.stopping_criteria.some((stopper) => stopper.interrupted)) {
              prefix = output.past_key_values;
              keep = true;
            }
          } finally {
            if (!keep) await output.past_key_values.dispose();
          }
        })();
      const task = preparing;
      try {
        await task;
      } catch (error) {
        if (own || disposed || options.stopping_criteria.some((stopper) => stopper.interrupted)) {
          throw error;
        }
      } finally {
        if (preparing === task) preparing = null;
      }
      if (disposed || options.stopping_criteria.some((stopper) => stopper.interrupted)) {
        throw new Error("Instruction prefix generation cancelled");
      }
    }
    if (disposed || options.stopping_criteria.some((stopper) => stopper.interrupted)) {
      throw new Error("Instruction prefix generation cancelled");
    }
    // Borrow each GPU buffer through a separate ORT tensor. Disposing the mutable
    // request cache invalidates its wrappers, while the master owns the buffers.
    const borrowed: Record<string, Tensor> = {};
    for (const [name, tensor] of Object.entries(prefix)) {
      const ort = tensor.ort_tensor;
      const OrtTensor = ort.constructor as unknown as {
        fromGpuBuffer: (
          buffer: typeof ort.gpuBuffer,
          options: { dataType: typeof tensor.type; dims: number[] },
        ) => typeof ort;
      };
      borrowed[name] = new Tensor(
        OrtTensor.fromGpuBuffer(ort.gpuBuffer, {
          dataType: tensor.type,
          dims: tensor.dims.slice(),
        }),
      );
    }
    const cache = new DynamicCache(borrowed);
    try {
      return await generate({ ...native, past_key_values: cache });
    } finally {
      await cache.dispose();
    }
  };
  return {
    generate(options) {
      const task = run(options);
      running.add(task);
      void task.then(
        () => running.delete(task),
        () => running.delete(task),
      );
      return task;
    },
    async dispose() {
      disposed = true;
      // A hung generation must not prevent the model's own disposal from starting.
      const [modelDisposal] = await Promise.allSettled([model.dispose(), ...running]);
      const master = prefix;
      prefix = null;
      if (master) await master.dispose();
      if (modelDisposal.status === "rejected") throw modelDisposal.reason;
    },
  };
}
