/// <reference types="vite/client" />

interface LanguageModelApi {
  availability: () => Promise<string>;
  create: (options?: unknown) => Promise<unknown>;
  capabilities?: () => Promise<unknown>;
}

interface Window {
  LanguageModel?: LanguageModelApi;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
}
