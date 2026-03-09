export interface InitProgressReport {
  progress: number;
  text?: string;
  timeElapsed?: number;
}

export interface MLCEngineInterface {
  chat: {
    completions: {
      create: (...args: unknown[]) => Promise<unknown>;
    };
  };
  completions: {
    create: (...args: unknown[]) => Promise<unknown>;
  };
  interruptGenerate: () => void;
  getMessage: () => Promise<string>;
  unload: () => Promise<void>;
}

export function CreateMLCEngine(): Promise<MLCEngineInterface> {
  throw new Error("WebLLM runtime is disabled in this build");
}
