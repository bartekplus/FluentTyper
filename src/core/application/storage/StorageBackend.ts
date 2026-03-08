export interface StorageBackend {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getAll(prefix: string): Promise<Record<string, string>>;
}
