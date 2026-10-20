import { handleApi } from "./app";
import { cleanup } from "./cleanup";
import { defaultDeps, type Deps, type Env } from "./env";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const deps: Deps = { ...defaultDeps, defer: (task) => ctx.waitUntil(task) };
      return handleApi(request, env, deps);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env): Promise<void> {
    await cleanup(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
