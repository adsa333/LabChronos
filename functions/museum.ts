import { validateDiagnosis } from "./diagnosis-core.mjs";

const SAMPLE_ROOM = "LAB-2826";
const MAX_BODY_BYTES = 64 * 1024;
const USER_ID_PATTERN = /^[A-Za-z0-9._-]{4,64}$/;
const ROOM_CODE_PATTERN = /^LAB-[A-Z0-9]{4}$/;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Row = Record<string, unknown>;

type MuseumDbResult = {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

export interface MuseumQuery extends PromiseLike<MuseumDbResult> {
  select: (columns?: string, options?: Record<string, unknown>) => MuseumQuery;
  insert: (values: unknown) => MuseumQuery;
  update: (values: Record<string, unknown>) => MuseumQuery;
  delete: () => MuseumQuery;
  eq: (column: string, value: unknown) => MuseumQuery;
  in: (column: string, values: unknown[]) => MuseumQuery;
  order: (column: string, options?: { ascending?: boolean }) => MuseumQuery;
  limit: (count: number) => MuseumQuery;
}

export interface MuseumDatabase {
  from: (table: string) => MuseumQuery;
}

class MuseumError extends Error {
  status: number;
  code: string;
  retryAfter?: number;

  constructor(status: number, code: string, retryAfter?: number) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function textLength(value: string): number {
  return [...value].length;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new MuseumError(400, `invalid_${field}`);
  const text = value.trim();
  if (!text || textLength(text) > max) throw new MuseumError(400, `invalid_${field}`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new MuseumError(400, `invalid_${field}`);
  const text = value.trim();
  if (textLength(text) > max) throw new MuseumError(400, `invalid_${field}`);
  return text;
}

function parseTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const timestamp = typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function userIdFrom(request: Request): string {
  const userId = request.headers.get("x-museum-user-id")?.trim() ?? "";
  if (!USER_ID_PATTERN.test(userId)) throw new MuseumError(400, "invalid_user_id");
  return userId;
}

function nicknameFrom(request: Request, body: Row): string {
  const fromBody = typeof body.nickname === "string";
  let raw = fromBody ? body.nickname as string : request.headers.get("x-museum-nickname");
  if (!fromBody && typeof raw === "string") {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Keep the original header when it is not URI-encoded.
    }
  }
  if (typeof raw !== "string" || !raw.trim()) return "匿名研究员";
  const nickname = raw.trim();
  if (textLength(nickname) > 16) throw new MuseumError(400, "invalid_nickname");
  return nickname;
}

function containsImagePayload(value: unknown, depth = 0): boolean {
  if (depth > 10) return true;
  if (typeof value === "string") return value.toLowerCase().includes("data:image/");
  if (Array.isArray(value)) return value.some((item) => containsImagePayload(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    key.toLowerCase() === "imagebase64" || containsImagePayload(item, depth + 1)
  );
}

async function readBody(request: Request): Promise<Row> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new MuseumError(413, "payload_too_large");
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MuseumError(413, "payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) return {};
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new MuseumError(400, "invalid_json");
  }
  if (!isRecord(body)) throw new MuseumError(400, "invalid_json");
  if (containsImagePayload(body)) throw new MuseumError(400, "image_payload_not_allowed");
  return body;
}

async function execute(query: MuseumQuery): Promise<MuseumDbResult> {
  try {
    return await query;
  } catch {
    throw new MuseumError(503, "museum_unavailable");
  }
}

async function rowsFrom(query: MuseumQuery): Promise<Row[]> {
  const result = await execute(query);
  if (result.error) throw new MuseumError(503, "museum_unavailable");
  return Array.isArray(result.data) ? result.data.filter(isRecord) : [];
}

async function writeFrom(query: MuseumQuery): Promise<void> {
  const result = await execute(query);
  if (result.error) throw new MuseumError(503, "museum_unavailable");
}

async function rowFrom(query: MuseumQuery): Promise<Row | null> {
  const rows = await rowsFrom(query.limit(1));
  return rows[0] ?? null;
}

function generateCode(): string {
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return `LAB-${suffix}`;
}

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function findRoom(db: MuseumDatabase, code: string): Promise<Row | null> {
  return rowFrom(db.from("museum_rooms").select("code,name,owner_id,pinned,created_at").eq("code", code));
}

async function roomDto(
  db: MuseumDatabase,
  row: Row,
  userId: string,
  joinedAt?: unknown,
  memberRows?: Row[],
  entryRows?: Row[],
): Promise<Record<string, unknown>> {
  const code = String(row.code);
  const members = memberRows ?? await rowsFrom(db.from("museum_members").select("room_code,user_id").eq("room_code", code));
  const entries = entryRows ?? await rowsFrom(db.from("museum_entries").select("id").eq("room_code", code));
  return {
    code,
    name: String(row.name ?? ""),
    joinedAt: parseTimestamp(joinedAt ?? row.created_at),
    isOwner: row.owner_id === userId,
    memberCount: members.length,
    entryCount: entries.length,
    pinned: Boolean(row.pinned),
  };
}

function entryDto(row: Row, comments: Row[], traps: Row[], userId: string): Record<string, unknown> {
  return {
    id: String(row.id),
    roomCode: String(row.room_code),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    createdAt: parseTimestamp(row.created_at),
    title: String(row.title),
    domain: String(row.domain),
    truthTitle: String(row.truth_title),
    probability: Number(row.probability),
    lockedId: row.locked_id === null || row.locked_id === undefined ? null : String(row.locked_id),
    action: String(row.action),
    paramDiff: parseJson(row.param_diff, []),
    symptomSummary: String(row.symptom_summary),
    log: String(row.log ?? ""),
    answers: parseJson(row.answers, {}),
    diagnosis: parseJson(row.diagnosis, null),
    sameTrap: Number(row.base_same_trap ?? 0) + traps.length,
    trappedByMe: traps.some((trap) => trap.user_id === userId),
    comments: comments.map((comment) => ({
      id: String(comment.id),
      authorName: String(comment.author_name),
      text: String(comment.text),
      createdAt: parseTimestamp(comment.created_at),
    })),
  };
}

async function loadEntries(db: MuseumDatabase, code: string, userId: string): Promise<Record<string, unknown>[]> {
  const entries = await rowsFrom(
    db.from("museum_entries")
      .select("id,room_code,author_id,author_name,title,domain,truth_title,probability,locked_id,action,param_diff,symptom_summary,log,answers,diagnosis,base_same_trap,created_at")
      .eq("room_code", code)
      .order("created_at", { ascending: false }),
  );
  if (entries.length === 0) return [];

  const entryIds = entries.map((entry) => String(entry.id));
  const comments = await rowsFrom(
    db.from("museum_comments")
      .select("id,entry_id,author_id,author_name,text,created_at")
      .in("entry_id", entryIds)
      .order("created_at", { ascending: true }),
  );
  const traps = await rowsFrom(db.from("museum_traps").select("entry_id,user_id").in("entry_id", entryIds));

  return entries.map((entry) => entryDto(
    entry,
    comments.filter((comment) => comment.entry_id === entry.id),
    traps.filter((trap) => trap.entry_id === entry.id),
    userId,
  ));
}

function validateParamDiff(value: unknown): { key: string; before: string; after: string }[] {
  if (!Array.isArray(value) || value.length > 5) throw new MuseumError(400, "invalid_param_diff");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.before !== "string" || typeof item.after !== "string") {
      throw new MuseumError(400, "invalid_param_diff");
    }
    return { key: item.key.slice(0, 120), before: item.before.slice(0, 120), after: item.after.slice(0, 120) };
  });
}

function validateAnswers(value: unknown): Record<string, number> {
  if (!isRecord(value)) throw new MuseumError(400, "invalid_answers");
  const answers: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Number.isInteger(item) || Number(item) < 0) throw new MuseumError(400, "invalid_answers");
    answers[key] = Number(item);
  }
  return answers;
}

function validateEntryDraft(body: Row) {
  const title = requireText(body.title, "title", 100);
  const truthTitle = requireText(body.truthTitle, "truthTitle", 160);
  const action = requireText(body.action, "action", 400);
  const symptomSummary = requireText(body.symptomSummary, "symptomSummary", 400);
  const log = optionalText(body.log, "log", 6000);
  const domain = requireText(body.domain, "domain", 32);
  const probability = body.probability;
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new MuseumError(400, "invalid_probability");
  }
  if (body.lockedId !== null && (typeof body.lockedId !== "string" || textLength(body.lockedId) > 64)) {
    throw new MuseumError(400, "invalid_locked_id");
  }
  const diagnosisValidation = validateDiagnosis(body.diagnosis);
  if (!diagnosisValidation.success) throw new MuseumError(400, "invalid_diagnosis");
  const diagnosis = diagnosisValidation.data;
  if (!isRecord(diagnosis) || diagnosis.domain !== domain) throw new MuseumError(400, "invalid_domain");
  return {
    title,
    truthTitle,
    action,
    symptomSummary,
    log,
    domain,
    probability,
    lockedId: body.lockedId === null ? null : String(body.lockedId),
    paramDiff: validateParamDiff(body.paramDiff),
    answers: validateAnswers(body.answers),
    diagnosis,
  };
}

export function createMuseumHandler(db: unknown): (request: Request, path: string) => Promise<Response> {
  const client = db as MuseumDatabase | undefined;
  const writeRates = new Map<string, { count: number; resetAt: number }>();

  function checkWriteRate(request: Request): void {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
    const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
    const now = Date.now();
    const current = writeRates.get(ip);
    if (!current || current.resetAt <= now) {
      writeRates.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return;
    }
    if (current.count >= RATE_LIMIT) {
      throw new MuseumError(429, "rate_limit_exceeded", Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
    }
    current.count += 1;
  }

  async function ensureMember(roomCode: string, userId: string, nickname: string): Promise<void> {
    if (!client) return;
    const existing = await rowFrom(
      client.from("museum_members").select("room_code").eq("room_code", roomCode).eq("user_id", userId),
    );
    if (existing) return;
    try {
      await writeFrom(client.from("museum_members").insert({ room_code: roomCode, user_id: userId, nickname }));
    } catch (error) {
      const raced = await rowFrom(
        client.from("museum_members").select("room_code").eq("room_code", roomCode).eq("user_id", userId),
      );
      if (!raced) throw error;
    }
  }

  return async (request: Request, path: string): Promise<Response> => {
    try {
      if (!client) return jsonResponse({ error: "database_not_configured" }, 503);
      const userId = userIdFrom(request);
      const parts = path.split("/").filter(Boolean);
      const resource = parts[2] ?? "";
      const method = request.method;
      const isWrite = method === "POST";
      if (isWrite) checkWriteRate(request);

      if (resource === "identity" && parts.length === 3) {
        if (method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
        const body = await readBody(request);
        const nickname = nicknameFrom(request, body);
        await writeFrom(client.from("museum_members").update({ nickname }).eq("user_id", userId));
        return jsonResponse({ id: userId, nickname });
      }

      if (resource === "rooms" && parts.length === 3) {
        if (method === "GET") {
          const memberships = await rowsFrom(client.from("museum_members").select("room_code,joined_at").eq("user_id", userId));
          const codes = [...new Set([SAMPLE_ROOM, ...memberships.map((member) => String(member.room_code))])];
          const rooms = await rowsFrom(client.from("museum_rooms").select("code,name,owner_id,pinned,created_at").in("code", codes));
          const members = await rowsFrom(client.from("museum_members").select("room_code,user_id").in("room_code", codes));
          const entries = await rowsFrom(client.from("museum_entries").select("id,room_code").in("room_code", codes));
          const joinedByCode = new Map(memberships.map((member) => [String(member.room_code), member.joined_at]));
          const result = await Promise.all(rooms.map((room) => {
            const code = String(room.code);
            return roomDto(
              client,
              room,
              userId,
              joinedByCode.get(code),
              members.filter((member) => member.room_code === code),
              entries.filter((entry) => entry.room_code === code),
            );
          }));
          result.sort((left, right) =>
            Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
            Number(right.joinedAt) - Number(left.joinedAt)
          );
          return jsonResponse(result);
        }

        if (method === "POST") {
          const body = await readBody(request);
          const name = requireText(body.name, "room_name", 24);
          const nickname = nicknameFrom(request, body);
          let code = "";
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const candidate = generateCode();
            if (!await findRoom(client, candidate)) {
              code = candidate;
              break;
            }
          }
          if (!code) throw new MuseumError(503, "room_code_unavailable");
          await writeFrom(client.from("museum_rooms").insert({
            code, name, description: "", owner_id: userId, pinned: false,
          }));
          await writeFrom(client.from("museum_members").insert({
            room_code: code, user_id: userId, nickname,
          }));
          const room = await findRoom(client, code);
          if (!room) throw new MuseumError(503, "museum_unavailable");
          return jsonResponse(await roomDto(client, room, userId, new Date().toISOString()));
        }

        return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
      }

      if (resource === "rooms" && parts[3] === "join" && parts.length === 4) {
        if (method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
        const body = await readBody(request);
        const code = String(body.code ?? "").trim().toUpperCase();
        if (!ROOM_CODE_PATTERN.test(code)) throw new MuseumError(400, "invalid_room_code");
        const nickname = nicknameFrom(request, body);
        const room = await findRoom(client, code);
        if (!room) return jsonResponse({ error: "room_not_found" }, 404);
        await ensureMember(code, userId, nickname);
        const member = await rowFrom(client.from("museum_members").select("room_code,joined_at").eq("room_code", code).eq("user_id", userId));
        return jsonResponse(await roomDto(client, room, userId, member?.joined_at ?? room.created_at));
      }

      if (resource === "rooms" && parts[3] && parts[4] === "leave" && parts.length === 5) {
        if (method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
        const code = parts[3].toUpperCase();
        const room = await findRoom(client, code);
        if (!room) return jsonResponse({ error: "room_not_found" }, 404);
        if (room.pinned) throw new MuseumError(400, "sample_room_pinned");
        await writeFrom(client.from("museum_members").delete().eq("room_code", code).eq("user_id", userId));
        return jsonResponse({ ok: true });
      }

      if (resource === "rooms" && parts[3] && parts[4] === "entries" && parts.length === 5) {
        const code = parts[3].toUpperCase();
        const room = await findRoom(client, code);
        if (!room) return jsonResponse({ error: "room_not_found" }, 404);

        if (method === "GET") {
          return jsonResponse(await loadEntries(client, code, userId));
        }

        if (method === "POST") {
          const body = await readBody(request);
          const nickname = nicknameFrom(request, body);
          const draft = validateEntryDraft(body);
          await ensureMember(code, userId, nickname);
          const entryId = generateId("entry");
          await writeFrom(client.from("museum_entries").insert({
            id: entryId,
            room_code: code,
            author_id: userId,
            author_name: nickname,
            title: draft.title,
            domain: draft.domain,
            truth_title: draft.truthTitle,
            probability: draft.probability,
            locked_id: draft.lockedId,
            action: draft.action,
            param_diff: draft.paramDiff,
            symptom_summary: draft.symptomSummary,
            log: draft.log,
            answers: draft.answers,
            diagnosis: draft.diagnosis,
            base_same_trap: 0,
          }));
          return jsonResponse({
            id: entryId,
            roomCode: code,
            authorId: userId,
            authorName: nickname,
            createdAt: Date.now(),
            title: draft.title,
            domain: draft.domain,
            truthTitle: draft.truthTitle,
            probability: draft.probability,
            lockedId: draft.lockedId,
            action: draft.action,
            paramDiff: draft.paramDiff,
            symptomSummary: draft.symptomSummary,
            log: draft.log,
            answers: draft.answers,
            diagnosis: draft.diagnosis,
            sameTrap: 0,
            trappedByMe: false,
            comments: [],
          });
        }

        return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
      }

      if (resource === "rooms" && parts[3] && parts[4] === "entries" && parts[5] && parts.length === 7) {
        if (method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
        const code = parts[3].toUpperCase();
        const entryId = parts[5];
        if (!ENTRY_ID_PATTERN.test(entryId)) throw new MuseumError(400, "invalid_entry_id");
        const entry = await rowFrom(
          client.from("museum_entries").select("id,base_same_trap").eq("id", entryId).eq("room_code", code),
        );
        if (!entry) return jsonResponse({ error: "entry_not_found" }, 404);
        const body = await readBody(request);

        if (parts[6] === "trap") {
          const existing = await rowFrom(
            client.from("museum_traps").select("entry_id").eq("entry_id", entryId).eq("user_id", userId),
          );
          if (!existing) {
            try {
              await writeFrom(client.from("museum_traps").insert({ entry_id: entryId, user_id: userId }));
            } catch (error) {
              const raced = await rowFrom(
                client.from("museum_traps").select("entry_id").eq("entry_id", entryId).eq("user_id", userId),
              );
              if (!raced) throw error;
            }
          }
          const traps = await rowsFrom(client.from("museum_traps").select("entry_id,user_id").eq("entry_id", entryId));
          return jsonResponse({
            sameTrap: Number(entry.base_same_trap ?? 0) + traps.length,
            trappedByMe: true,
          });
        }

        if (parts[6] === "comments") {
          const text = requireText(body.text, "comment", 140);
          const nickname = nicknameFrom(request, body);
          const commentId = generateId("comment");
          await writeFrom(client.from("museum_comments").insert({
            id: commentId,
            entry_id: entryId,
            author_id: userId,
            author_name: nickname,
            text,
          }));
          return jsonResponse({
            id: commentId,
            authorName: nickname,
            text,
            createdAt: Date.now(),
          });
        }
      }

      return jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof MuseumError) {
        const headers = error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined;
        return jsonResponse({ error: error.code }, error.status, headers);
      }
      return jsonResponse({ error: "internal_error" }, 500);
    }
  };
}