import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { serveSite } from "./adapter.mjs";
import { createHandler } from "./handler.ts";

const direct = createHandler({});
const museum = serveSite(
  ({ request, supabase }) => createHandler({ db: supabase })(request),
  {
    createClient,
    env: (name) => Deno.env.get(name),
  },
);

Deno.serve((request) => {
  const path = new URL(request.url).pathname;
  return path.includes("/api/museum/") ? museum(request) : direct(request);
});