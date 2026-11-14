import { createHandler } from "./handler.ts";

let db: Parameters<typeof createHandler>[0]["db"];
try {
  const mod = await import("./_qoder/backend.mjs");
  db = mod.createDatabaseClient?.();
} catch {}

Deno.serve(createHandler({ db }));
