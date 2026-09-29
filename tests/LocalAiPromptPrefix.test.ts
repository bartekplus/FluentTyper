import { describe, expect, jest, test } from "bun:test";
import type {
  DynamicCache,
  Tensor,
  PreTrainedModel,
  PreTrainedTokenizer,
} from "../src/adapters/chrome/background/localAi/engineRuntime";
import { withPromptPrefix } from "../src/adapters/chrome/background/localAi/promptPrefix";

// Only the injected surface used by the prefix wrapper; no engine/runtime startup.
class TestOrtTensor {
  readonly location = "gpu-buffer";
  readonly type = "float16";
  constructor(
    readonly gpuBuffer: { size: number; destroyed: boolean },
    readonly dims: number[],
    private readonly ownsBuffer: boolean,
  ) {}
  static fromGpuBuffer(buffer: { size: number; destroyed: boolean }, options: { dims: number[] }) {
    return new TestOrtTensor(buffer, options.dims, false);
  }
  dispose() {
    if (this.ownsBuffer) this.gpuBuffer.destroyed = true;
  }
}
class TestTensor {
  readonly ort_tensor: TestOrtTensor | { getData: (_release?: boolean) => Promise<BigInt64Array> };
  readonly type: string;
  readonly data: BigInt64Array;
  readonly dims: number[];
  constructor(type: string, data: BigInt64Array, dims: number[]);
  constructor(ort: TestOrtTensor);
  constructor(typeOrOrt: string | TestOrtTensor, data?: BigInt64Array, dims?: number[]) {
    this.type = typeof typeOrOrt === "string" ? typeOrOrt : typeOrOrt.type;
    this.data = data ?? new BigInt64Array();
    this.dims = dims ?? (typeOrOrt as TestOrtTensor).dims;
    this.ort_tensor =
      typeof typeOrOrt === "string" ? { getData: async () => this.data } : typeOrOrt;
  }
  get location() {
    return this.ort_tensor instanceof TestOrtTensor ? "gpu-buffer" : "cpu";
  }
  dispose() {
    if (this.ort_tensor instanceof TestOrtTensor) this.ort_tensor.dispose();
  }
  slice(_axis: null, range: [number, number]) {
    return new TestTensor(this.type, this.data.slice(...range), [1, range[1] - range[0]]);
  }
}
class TestCache {
  [key: string]: unknown;
  constructor(entries: Record<string, unknown> = {}) {
    Object.assign(this, entries);
  }
  update(entries: Record<string, unknown>) {
    for (const [name, value] of Object.entries(entries)) {
      const old = this[name] as { location?: string; dispose?: () => void } | undefined;
      if (old && old !== value && old.location === "gpu-buffer") old.dispose?.();
    }
    Object.assign(this, entries);
  }
  async dispose() {
    for (const tensor of Object.values(this)) {
      const item = tensor as { location: string; dispose(): void };
      if (item.location === "gpu-buffer") item.dispose();
    }
  }
}

function harness(templateMismatchAt?: number, prefixBytes = 480 * 2) {
  const input = () => new TestTensor("int64", new BigInt64Array(500).fill(1n), [1, 500]);
  let templates = 0;
  const tokenizer = {
    apply_chat_template: () => {
      const input_ids = input();
      if (++templates === 2 && templateMismatchAt !== undefined) {
        (input_ids.data as BigInt64Array)[templateMismatchAt] = 2n;
      }
      return { input_ids, attention_mask: input() };
    },
  };
  const prefixBuffer = { size: prefixBytes, destroyed: false };
  const prefix = new TestTensor(new TestOrtTensor(prefixBuffer, [1, 1, 480, 1], true));
  const prefixCache = new TestCache({ "past_key_values.0.key": prefix });
  const prefixDispose = jest.spyOn(prefixCache, "dispose");
  const generatedDispose = jest.fn(() => {});
  const generated = { location: "gpu-buffer", dispose: generatedDispose } as unknown as Tensor;
  const seeds: Tensor[] = [];
  let fail = false;
  let duringPrefix: () => void | Promise<void> = () => {};
  let blocked: Promise<void> | null = null;
  const generate = jest.fn(async (options: Record<string, unknown>) => {
    if (options.return_dict_in_generate) {
      await duringPrefix();
      return { past_key_values: prefixCache };
    }
    const cache = options.past_key_values as TestCache | undefined;
    if (cache) {
      const seed = cache["past_key_values.0.key"] as Tensor;
      expect(seed.location).toBe("gpu-buffer");
      expect(seed).not.toBe(prefix);
      expect(seed.ort_tensor.gpuBuffer).toBe(prefixBuffer);
      seeds.push(seed);
    }
    cache?.update({ "past_key_values.0.key": generated });
    if (blocked) await blocked;
    if (fail) throw new Error("lost device");
    return input();
  });
  const dispose = jest.fn(async () => {});
  const wrapped = withPromptPrefix(
    { generate, dispose } as unknown as PreTrainedModel,
    tokenizer as unknown as PreTrainedTokenizer,
    {
      DynamicCache: TestCache as unknown as typeof DynamicCache,
      Tensor: TestTensor as unknown as typeof Tensor,
    },
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
    seeds,
    generate,
    dispose,
    prefixDispose,
    prefixBuffer,
    generatedDispose,
    stopper,
    options,
    fail: () => {
      fail = true;
    },
    duringPrefix: (fn: () => void | Promise<void>) => {
      duringPrefix = fn;
    },
    blockGeneration: (wait: Promise<void>) => {
      blocked = wait;
    },
  };
}

describe("Gemma instruction prefix", () => {
  test("rejects a candidate when synthetic context enters its last token", async () => {
    const h = harness(479);
    await h.wrapped.generate(h.options());
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.prefixDispose).not.toHaveBeenCalled();
  });

  test("reuses only matching instruction tokens, with a separate disposable cache per request", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    await h.wrapped.generate(h.options());
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(4);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    const first = h.generate.mock.calls[2][0].past_key_values;
    const second = h.generate.mock.calls[3][0].past_key_values;
    expect(first).not.toBe(second);
    expect(h.generatedDispose).toHaveBeenCalledTimes(2);
    expect(h.seeds[0]).not.toBe(h.seeds[1]);
    expect(h.prefixBuffer.destroyed).toBe(false);
    const different = h.options();
    (different.input_ids.data as BigInt64Array)[0] = 2n;
    await h.wrapped.generate(different);
    expect(h.generate.mock.calls[4][0].past_key_values).toBeUndefined();
    await h.wrapped.dispose();
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    expect(h.prefixBuffer.destroyed).toBe(true);
    expect(h.dispose).toHaveBeenCalledTimes(1);
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("disposed");
  });

  test("unload during prefix preparation prevents a late cache or generation", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.prefixDispose).not.toHaveBeenCalled();
    let unloading: Promise<void>;
    h.duringPrefix(() => {
      unloading = h.wrapped.dispose();
    });
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("cancelled");
    await unloading!;
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
    expect(h.prefixDispose).not.toHaveBeenCalled();
    await h.wrapped.dispose();
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
  });

  test("rejects a GPU prefix that exceeds the memory budget", async () => {
    const h = harness(undefined, 32 * 1024 * 1024 + 1);
    await h.wrapped.generate(h.options());
    await expect(h.wrapped.generate(h.options())).rejects.toThrow("budget");
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    expect(h.prefixBuffer.destroyed).toBe(true);
  });

  test("concurrent requests prepare one master and borrow separate caches", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    h.duringPrefix(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          entered();
        }),
    );
    const second = h.wrapped.generate(h.options());
    await started;
    const third = h.wrapped.generate(h.options());
    release();
    await Promise.all([second, third]);
    expect(
      h.generate.mock.calls.filter(([options]) => options.return_dict_in_generate),
    ).toHaveLength(1);
    expect(h.seeds[0]).not.toBe(h.seeds[1]);
    expect(h.prefixBuffer.destroyed).toBe(false);
    await h.wrapped.dispose();
    expect(h.prefixBuffer.destroyed).toBe(true);
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
    expect(h.prefixDispose).toHaveBeenCalledTimes(1);
    await h.wrapped.dispose();
    expect(h.prefixDispose).toHaveBeenCalledTimes(2);
  });

  test("unload waits for a borrowing request before freeing the GPU prefix", async () => {
    const h = harness();
    await h.wrapped.generate(h.options());
    await h.wrapped.generate(h.options());
    let release!: () => void;
    h.blockGeneration(new Promise<void>((resolve) => (release = resolve)));
    const request = h.wrapped.generate(h.options());
    const unloading = h.wrapped.dispose();
    expect(h.dispose).toHaveBeenCalledTimes(1);
    expect(h.prefixBuffer.destroyed).toBe(false);
    release();
    await request;
    await unloading;
    expect(h.prefixBuffer.destroyed).toBe(true);
  });
});
