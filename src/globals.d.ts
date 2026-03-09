declare global {
  const __FT_DEV_BUILD__: boolean | undefined;

  interface Window {
    browser?: typeof chrome;
  }
}

export {};
