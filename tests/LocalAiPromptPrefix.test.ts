import { describe, expect, jest, test } from "bun:test";
import {
  DynamicCache,
  Tensor,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { withPromptPrefix } from "../src/adapters/chrome/background/localAi/promptPrefix";

function harness() {
  const input = () => new Tensor("int64", new BigInt64Array(500).fill(1n), [1, 500]);
  const tokenizer = {
    apply_chat_template: () => ({ input_ids: input(), attention_mask: input() }),
  };
  const prefix = new Tensor("float16", new Uint16Array(400), [1, 1, 400, 1]);
  const prefixRead = jest.spyOn(prefix.ort_tensor, "getData");
  const prefixCache = new DynamicCache({ "past_key_values.0.key": prefix });
  const prefixDispose = jest.spyOn(prefixCache, "dispose");
  const generatedDispose = jest.fn(() => {});
  const generated = { location: "gpu-buffer", dispose: generatedDispose } as unknown as Tensor;
  let fail = false;
  let duringPrefix = () => {};
  const generate = jest.fn(async (options: Record<string, unknown>) => {
    if (options.return_dict_in_generate) {
      duringPrefix();
      return { past_key_values: prefixCache };
    }
    const cache = options.past_key_values as DynamicCache | undefined;
    cache?.update({ "past_key_values.0.key": generated });
    if (fail) throw new Error("lost device");
    return input();
  });
  const dispose = jest.fn(async () => {});
  const wrapped = withPromptPrefix(
    { generate, dispose } as unknown as PreTrainedModel,
    tokenizer as unknown as PreTrainedTokenizer,
    { DynamicCache, Tensor },
  );
  const stopper = {
    interrupted: false,
    interrupt() {
      this.interrupted = true;
    },
  };
  const options = () => ({
    input_ids: input(),
    attention_mask: input(),
    max_new_tokens: 50,
    do_sample: false as const,
    stopping_criteria: [stopper],
  });
  return {
    wrapped,
    generate,
    dispose,
    prefixDispose,
    prefixRead,
    generatedDispose,
    stopper,
    options,
    fail: () => {
      fail = true;
    },
    duringPrefix: (fn: () => void) => {
      duringPrefix = fn;
    },
  };
}

describe("Gemma instruction prefix", () => {
  test("reuses only matching instruction tokens, with a separate disposable cache per request", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    await h.wrapped.generate(h.options());
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(4);
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    expect(h.prefixRead).toHaveBeenCalledWith(true);
    const first = h.generate.mock.calls[2][0].past_key_values;
    const second = h.generate.mock.calls[3][0].past_key_values;
    expect(first).not.toBe(second);
    expect(h.generatedDispose).toHaveBeenCalledTimes(2);
    const different = h.options();
    (different.input_ids.data as BigInt64Array)[0] = 2n;
    await h.wrapped.generate(different);
    expect(h.generate.mock.calls[4][0].past_key_values).toBeUndefined();
    await h.wrapped.dispose();
    expect(h.dispose).toHaveBeenCalledTimes(1);
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("disposed");
  });

  test("unload during prefix preparation prevents a late cache or generation", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    h.duringPrefix(() => {
      void h.wrapped.dispose();
    });
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("cancelled");
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    expect(h.dispose).toHaveBeenCalledTimes(1);
  });

  test("failed generations dispose request tensors", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    h.fail();
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("lost device");
    expect(h.generatedDispose).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
  });

  test("cancellation during prefix preparation releases its cache and does not generate text", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    h.duringPrefix(() => h.stopper.interrupt());
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("cancelled");
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    h.stopper.interrupted = false;
    h.duringPrefix(() => {});
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(4);
    expect(h.prefixDispose).toHaveBeenCalledTimes(2);
  });
});
