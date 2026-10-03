declare global {
  const __FT_DEV_BUILD__: boolean | undefined;
  const __FT_LOG_LEVEL__: string | undefined;

  interface Window {
    browser?: typeof chrome;
  }
}

export {};
