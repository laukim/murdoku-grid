import { handleLayoutsRequest } from "./layouts-api.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/layouts" || pathname.startsWith("/api/layouts/")) {
      return handleLayoutsRequest(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
