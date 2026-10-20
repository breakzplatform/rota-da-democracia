import { handleApi } from "./app";
import { cleanup } from "./cleanup";
import { defaultDeps, type Env } from "./env";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) return handleApi(request, env, defaultDeps);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env): Promise<void> {
    await cleanup(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
