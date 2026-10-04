export interface PresageCallback {
  pastStream: string;
  get_past_stream: () => string;
  get_future_stream: () => string;
}

export interface Presage {
  predictWithProbability: () => {
    size: () => number;
    get: (i: number) => { prediction: string };
    delete?: () => void;
  };
  config(key: string, value: string): void;
  /** The current value of a setting. */
  config(key: string): string;
  /** Frees the native instance; Embind objects are not garbage collected. */
  delete?: () => void;
}

export interface PresageModule {
  PresageCallback: { implement: (cb: PresageCallback) => unknown };
  Presage: new (cbImpl: unknown, path: string) => Presage;
  FS: {
    writeFile: (path: string, content: string) => void;
    readFile: (path: string, options: { encoding: "utf8" }) => string;
    stat: (path: string) => { size: number };
  };
}
