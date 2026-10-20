export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
  IP_SALT: string;
  // Comma-separated hostnames Turnstile tokens may come from.
  ALLOWED_HOSTNAMES?: string;
}

// Side effects the handlers depend on, injectable so tests control time and network.
export interface Deps {
  now: () => Date;
  fetch: typeof fetch;
}

export const defaultDeps: Deps = {
  now: () => new Date(),
  fetch: (input, init) => fetch(input, init),
};
