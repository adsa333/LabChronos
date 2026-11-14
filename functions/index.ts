import { createDatabaseClient } from "./_qoder/backend.mjs";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({ db: createDatabaseClient() }));
