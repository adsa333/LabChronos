import { createHandler } from "../functions/handler.ts";

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, createHandler());
