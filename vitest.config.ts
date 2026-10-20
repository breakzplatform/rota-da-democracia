import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          IP_SALT: "test-salt",
        },
      },
    }),
  ],
});
