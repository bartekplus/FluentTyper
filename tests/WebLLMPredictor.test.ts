import { jest, mock } from "bun:test";

const createMLCEngineMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: createMLCEngineMock,
}));

function setWebGPUAvailability(enabled: boolean) {
  Object.defineProperty(globalThis.navigator, "gpu", {
    value: enabled ? {} : undefined,
    configurable: true,
  });
}

function createAsyncStream<T>(chunks: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createMockEngine(options?: {
  completionImpl?: () => Promise<unknown>;
  chatCompletionImpl?: () => Promise<unknown>;
}) {
  const completionCreate = jest.fn(
    options?.completionImpl ??
      (async () => ({
        choices: [{ text: "alpha\nbeta\ngamma" }],
      })),
  );
  const chatCreate = jest.fn(
    options?.chatCompletionImpl ??
      (async () => ({
        choices: [{ message: { content: "alpha\nbeta\ngamma" } }],
      })),
  );
  return {
    chat: { completions: { create: chatCreate } },
    completions: { create: completionCreate },
    interruptGenerate: jest.fn(),
    getMessage: jest.fn(async () => ""),
    unload: jest.fn(async () => undefined),
  };
}

describe("WebLLMPredictor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWebGPUAvailability(true);
  });

  afterAll(() => {
    mock.restore();
  });

  test("returns empty predictions when WebGPU is unavailable", async () => {
    setWebGPUAvailability(false);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();
    predictor.setConfig({ enabled: true });

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "hello",
      numSuggestions: 3,
    });

    expect(result).toEqual([]);
    expect(createMLCEngineMock).not.toHaveBeenCalled();
  });

  test("initializes engine once and keeps concurrent requests safe", async () => {
    const engine = createMockEngine();
    let initResolve: ((value: unknown) => void) | undefined;
    createMLCEngineMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          initResolve = resolve;
        }),
    );

    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const first = predictor.predict({
      lang: "en_US",
      predictionInput: "hel",
      numSuggestions: 2,
    });
    const second = predictor.predict({
      lang: "en_US",
      predictionInput: "wor",
      numSuggestions: 2,
    });

    while (!initResolve) {
      await Promise.resolve();
    }
    if (initResolve) {
      initResolve(engine);
    }
    const [, secondResult] = await Promise.all([first, second]);

    expect(createMLCEngineMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(secondResult)).toBe(true);
  });

  test("falls back to empty predictions on generation error", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () => {
        throw new Error("chat generation failed");
      },
      completionImpl: async () => {
        throw new Error("generation failed");
      },
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "abc",
      numSuggestions: 3,
    });

    expect(result).toEqual([]);
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(engine.completions.create).toHaveBeenCalledTimes(1);
  });

  test("parses streamed chat chunks from async iterable responses", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () =>
        createAsyncStream([
          { choices: [{ delta: { content: "alpha\n" } }] },
          { choices: [{ delta: { content: "beta\n" } }] },
          { choices: [{ delta: { content: "gamma" } }] },
        ]),
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "hello ",
      numSuggestions: 3,
    });

    expect(result).toEqual(["alpha", "beta", "gamma"]);
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(engine.completions.create).toHaveBeenCalledTimes(0);
  });

  test("parses streamed completion chunks when chat returns no tokens", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () => ({ choices: [] }),
      completionImpl: async () =>
        createAsyncStream([
          { choices: [{ text: "delta\n" }] },
          { choices: [{ text: "epsilon\n" }] },
          { choices: [{ text: "zeta" }] },
        ]),
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "hello ",
      numSuggestions: 3,
    });

    expect(result).toEqual(["delta", "epsilon", "zeta"]);
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(engine.completions.create).toHaveBeenCalledTimes(1);
  });

  test("uses completion mode mid-word and filters unrelated next-word outputs", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () => ({
        choices: [
          {
            message: {
              content: "great\nsuper\nsupport",
            },
          },
        ],
      }),
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "this is sup",
      numSuggestions: 3,
    });

    expect(result).toEqual(["super", "support"]);
    expect(engine.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(engine.completions.create).toHaveBeenCalledTimes(0);
  });

  test("corrects typo fragments in completion mode", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () => ({
        choices: [
          {
            message: {
              content: "amazing\namazon\nagain",
            },
          },
        ],
      }),
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "this is amazgi",
      numSuggestions: 3,
    });

    expect(result[0]).toBe("amazing");
    expect(result).not.toContain("again");
  });

  test("falls back to raw completion candidates when strict completion filter rejects all", async () => {
    const engine = createMockEngine({
      chatCompletionImpl: async () => ({
        choices: [
          {
            message: {
              content: "banana\norange\nkiwi",
            },
          },
        ],
      }),
    });
    createMLCEngineMock.mockResolvedValue(engine);
    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const result = await predictor.predict({
      lang: "en_US",
      predictionInput: "this is amazgi",
      numSuggestions: 3,
    });

    expect(result).toEqual(["banana", "orange", "kiwi"]);
  });

  test("cancels stale generation and returns only newest request output", async () => {
    let resolveFirst:
      ((value: { choices: Array<{ message: { content: string } }> }) => void) | undefined;
    const firstPromise = new Promise<{
      choices: Array<{ message: { content: string } }>;
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const engine = createMockEngine();
    const chatCreateMock = engine.chat.completions.create as jest.Mock;
    chatCreateMock
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(async () => ({
        choices: [{ message: { content: "newword" } }],
      }));
    createMLCEngineMock.mockResolvedValue(engine);

    const { WebLLMPredictor } = await import("../src/adapters/chrome/background/WebLLMPredictor");
    const predictor = new WebLLMPredictor();

    const firstRequest = predictor.predict({
      lang: "en_US",
      predictionInput: "abc ",
      numSuggestions: 2,
    });
    while (chatCreateMock.mock.calls.length === 0) {
      await Promise.resolve();
    }
    const secondRequest = predictor.predict({
      lang: "en_US",
      predictionInput: "abcd ",
      numSuggestions: 2,
    });

    if (resolveFirst) {
      resolveFirst({ choices: [{ message: { content: "oldword" } }] });
    }
    const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);
    const firstCallArgs = chatCreateMock.mock.calls[0]?.[0] as
      { messages?: Array<{ content?: string }> } | undefined;
    const secondCallArgs = chatCreateMock.mock.calls[1]?.[0] as
      { messages?: Array<{ content?: string }> } | undefined;

    expect(chatCreateMock).toHaveBeenCalledTimes(2);
    expect(firstCallArgs?.messages?.[1]?.content).toContain("Context: abc");
    expect(secondCallArgs?.messages?.[1]?.content).toContain("Context: abcd");
    expect(engine.interruptGenerate).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual([]);
    expect(secondResult).toEqual(["newword"]);
    expect(secondResult).not.toContain("oldword");
  });
});
