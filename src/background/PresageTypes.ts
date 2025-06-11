// Shared types for Presage-related managers
export type PresageInstance = {
  config: (key: string, value: string) => void;
};

export type PresageModule = {
  FS: { writeFile: (path: string, content: string) => void };
  PresageCallback: undefined;
  Presage: undefined;
};
