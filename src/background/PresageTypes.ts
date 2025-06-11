// Shared types for Presage-related managers
export type PresageInstance = {
  config: (key: string, value: string) => void;
};

// Define minimal types for Module and Presage if not available
export interface PresageCallback {
  pastStream: string;
  get_past_stream: () => string;
  get_future_stream: () => string;
}

export interface Presage {
  predictWithProbability: () => {
    size: () => number;
    get: (i: number) => { prediction: string };
  };
  config: (key: string, value: string) => void;
}

export interface PresageModule {
  PresageCallback: { implement: (cb: PresageCallback) => unknown };
  Presage: new (cbImpl: unknown, path: string) => Presage;
  FS: { writeFile: (path: string, content: string) => void };
}
