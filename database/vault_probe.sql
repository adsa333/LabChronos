CREATE TABLE app.vault_probe (
  id text PRIMARY KEY,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
