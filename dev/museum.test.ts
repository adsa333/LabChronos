import { createHandler } from "../functions/handler.ts";

type Row = Record<string, unknown>;

type FakeResult = { data: Row[]; error: null };

class FakeQuery implements PromiseLike<FakeResult> {
  private db: FakeDb;
  private table: string;
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private payload: unknown;
  private filters: Array<{ column: string; operator: "eq" | "in"; value: unknown }> = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(): this {
    this.operation = "select";
    return this;
  }

  insert(values: unknown): this {
    this.operation = "insert";
    this.payload = values;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = "update";
    this.payload = values;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, operator: "in", value: values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderSpec = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => filter.operator === "eq"
      ? row[filter.column] === filter.value
      : Array.isArray(filter.value) && filter.value.includes(row[filter.column]));
  }

  private async execute(): Promise<FakeResult> {
    const table = this.db.tables[this.table];
    if (!table) throw new Error(`unknown_table:${this.table}`);

    if (this.operation === "insert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = values.filter(isRecord).map((value) => ({
        created_at: new Date().toISOString(),
        joined_at: new Date().toISOString(),
        ...value,
      }));
      table.push(...inserted);
      return { data: inserted, error: null };
    }

    if (this.operation === "update") {
      const updated: Row[] = [];
      for (const row of table) {
        if (!this.matches(row)) continue;
        Object.assign(row, this.payload);
        updated.push({ ...row });
      }
      return { data: updated, error: null };
    }

    if (this.operation === "delete") {
      const removed = table.filter((row) => this.matches(row));
      this.db.tables[this.table] = table.filter((row) => !this.matches(row));
      return { data: removed, error: null };
    }

    let selected = table.filter((row) => this.matches(row));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      selected = [...selected].sort((left, right) => {
        const a = left[column];
        const b = right[column];
        const comparison = typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.limitCount !== null) selected = selected.slice(0, this.limitCount);
    return { data: selected.map((row) => ({ ...row })), error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]>;

  constructor() {
    this.tables = {
      museum_rooms: [{
        code: "LAB-2826",
        name: "示例馆",
        description: "",
        owner_id: "user-a",
        pinned: true,
        created_at: "2026-11-20T08:00:00Z",
      }],
      museum_members: [{
        room_code: "LAB-2826",
        user_id: "user-a",
        nickname: "Alice",
        joined_at: "2026-11-20T08:01:00Z",
      }],
      museum_entries: [],
      museum_traps: [],
      museum_comments: [],
    };
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = "values differ") {
  if (Object.is(actual, expected)) return;
  throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

function museumRequest(
  path: string,
  options: {
    method?: string;
    userId?: string;
    nickname?: string;
    body?: unknown;
    ip?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {
    "x-museum-user-id": options.userId ?? "user-a",
    "x-museum-nickname": options.nickname ?? "Alice",
    "x-forwarded-for": options.ip ?? "198.51.100.1",
  };
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  return new Request(`http://local${path}`, init);
}

const validDiagnosis = {
  caseTitle: "梯度未裁剪导致 NaN",
  domain: "AI/ML",
  observedSymptoms: [
    { id: "s1", label: "Loss 变 NaN", detail: "梯度峰值后 Loss 失效", severity: "critical", source: "log" },
    { id: "s2", label: "梯度出现异常峰值", detail: "grad_norm 明显升高", severity: "critical", source: "log" },
    { id: "s3", label: "未启用梯度裁剪", detail: "配置显示裁剪关闭", severity: "warning", source: "log" },
  ],
  hypotheses: [
    {
      id: "h1",
      title: "未裁剪梯度导致溢出",
      mechanism: "大梯度直接更新参数引发非有限值",
      priorScore: 50,
      evidenceFor: ["s1", "s2", "s3"],
      subCauses: ["梯度未裁剪", "参数更新溢出"],
      minimalControl: {
        action: "只增加梯度裁剪",
        paramDiff: [{ key: "max_norm", before: "未启用", after: "1.0" }],
        expectedOutcome: "Loss 保持有限",
      },
    },
    {
      id: "h2",
      title: "学习率过大",
      mechanism: "过大更新步长引发振荡",
      priorScore: 30,
      evidenceFor: ["s2"],
      subCauses: ["学习率偏高", "缺少 Warmup"],
      minimalControl: {
        action: "只降低学习率",
        paramDiff: [{ key: "lr", before: "0.05", after: "0.005" }],
        expectedOutcome: "振荡消失",
      },
    },
    {
      id: "h3",
      title: "输入包含异常值",
      mechanism: "非有限输入污染前向计算",
      priorScore: 20,
      evidenceFor: ["s1"],
      subCauses: ["异常特征", "异常标签"],
      minimalControl: {
        action: "只扫描异常输入",
        paramDiff: [{ key: "检查范围", before: "未检查", after: "全批次" }],
        expectedOutcome: "定位异常样本",
      },
    },
  ],
  questions: [
    {
      id: "q1",
      prompt: "启用裁剪后是否仍 NaN？",
      howToCheck: "仅增加裁剪重跑",
      options: [
        { label: "不再 NaN", scoreDelta: { h1: 25, h2: -20, h3: -5 } },
        { label: "仍然 NaN", scoreDelta: { h1: -20, h2: 25, h3: 20 } },
        { label: "不确定", scoreDelta: { h1: 0, h2: 0, h3: 0 } },
      ],
    },
    {
      id: "q2",
      prompt: "异常是否总在梯度峰值后？",
      howToCheck: "对齐时间顺序检查",
      options: [
        { label: "总在峰值后", scoreDelta: { h1: 20, h2: -10, h3: -15 } },
        { label: "与峰值无关", scoreDelta: { h1: -15, h2: 20, h3: 20 } },
        { label: "不确定", scoreDelta: { h1: 0, h2: 0, h3: 0 } },
      ],
    },
  ],
};

function entryDraft() {
  return {
    title: "测试存证",
    domain: "AI/ML",
    truthTitle: "未裁剪梯度导致溢出",
    probability: 0.7,
    lockedId: "h1",
    action: "只增加梯度裁剪",
    paramDiff: [{ key: "max_norm", before: "未启用", after: "1.0" }],
    symptomSummary: "Loss NaN 且梯度峰值异常",
    log: "EPOCH 14 loss=nan",
    answers: { q1: 0 },
    diagnosis: validDiagnosis,
  };
}

Deno.test("museum returns 503 when database is not configured", async () => {
  const handler = createHandler();
  const response = await handler(museumRequest("/api/museum/rooms", { userId: "user-a" }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "database_not_configured");
});

Deno.test("museum creates, joins, lists and leaves rooms", async () => {
  const db = new FakeDb();
  const handler = createHandler({ db: db as never });

  const createdResponse = await handler(museumRequest("/api/museum/rooms", {
    method: "POST",
    userId: "user-a",
    nickname: "Alice",
    body: { name: "测试课题组" },
  }));
  assertEquals(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert(/^LAB-[A-Z0-9]{4}$/.test(created.code));
  assertEquals(created.isOwner, true);
  assertEquals(created.memberCount, 1);

  const joinedResponse = await handler(museumRequest("/api/museum/rooms/join", {
    method: "POST",
    userId: "user-b",
    nickname: "Bob",
    body: { code: created.code },
  }));
  assertEquals(joinedResponse.status, 200);
  assertEquals((await joinedResponse.json()).memberCount, 2);

  const roomsResponse = await handler(museumRequest("/api/museum/rooms", { userId: "user-b" }));
  const rooms = await roomsResponse.json();
  assertEquals(rooms[0].code, "LAB-2826");
  assertEquals(rooms[0].pinned, true);
  assert(rooms.some((room: { code: string }) => room.code === created.code));

  const pinnedLeave = await handler(museumRequest("/api/museum/rooms/LAB-2826/leave", {
    method: "POST",
    userId: "user-b",
    body: {},
  }));
  assertEquals(pinnedLeave.status, 400);

  const leaveResponse = await handler(museumRequest(`/api/museum/rooms/${created.code}/leave`, {
    method: "POST",
    userId: "user-b",
    body: {},
  }));
  assertEquals(leaveResponse.status, 200);
  assertEquals((await leaveResponse.json()).ok, true);
});

Deno.test("museum pushes entries, deduplicates traps and appends comments", async () => {
  const db = new FakeDb();
  const handler = createHandler({ db: db as never });

  const imageResponse = await handler(museumRequest("/api/museum/rooms/LAB-2826/entries", {
    method: "POST",
    userId: "user-a",
    body: { ...entryDraft(), imageBase64: "AAAA" },
  }));
  assertEquals(imageResponse.status, 400);
  assertEquals((await imageResponse.json()).error, "image_payload_not_allowed");

  const dataImageResponse = await handler(museumRequest("/api/museum/rooms/LAB-2826/entries", {
    method: "POST",
    userId: "user-a",
    body: { ...entryDraft(), log: "screenshot=data:image/png;base64,AAAA" },
  }));
  assertEquals(dataImageResponse.status, 400);

  const pushResponse = await handler(museumRequest("/api/museum/rooms/LAB-2826/entries", {
    method: "POST",
    userId: "user-a",
    nickname: "Alice",
    body: entryDraft(),
  }));
  assertEquals(pushResponse.status, 200);
  const entry = await pushResponse.json();
  assertEquals(entry.authorName, "Alice");
  assertEquals(entry.sameTrap, 0);

  const firstTrap = await handler(museumRequest(`/api/museum/rooms/LAB-2826/entries/${entry.id}/trap`, {
    method: "POST",
    userId: "user-a",
    body: {},
  }));
  assertEquals((await firstTrap.json()).sameTrap, 1);

  const duplicateTrap = await handler(museumRequest(`/api/museum/rooms/LAB-2826/entries/${entry.id}/trap`, {
    method: "POST",
    userId: "user-a",
    body: {},
  }));
  assertEquals((await duplicateTrap.json()).sameTrap, 1);

  const otherTrap = await handler(museumRequest(`/api/museum/rooms/LAB-2826/entries/${entry.id}/trap`, {
    method: "POST",
    userId: "user-b",
    body: {},
  }));
  const otherTrapBody = await otherTrap.json();
  assertEquals(otherTrapBody.sameTrap, 2);
  assertEquals(otherTrapBody.trappedByMe, true);

  const commentResponse = await handler(museumRequest(`/api/museum/rooms/LAB-2826/entries/${entry.id}/comments`, {
    method: "POST",
    userId: "user-b",
    nickname: "Bob",
    body: { text: "同款坑，已按处方复现。" },
  }));
  assertEquals(commentResponse.status, 200);
  const comment = await commentResponse.json();
  assertEquals(comment.authorName, "Bob");

  const listResponse = await handler(museumRequest("/api/museum/rooms/LAB-2826/entries", { userId: "user-a" }));
  const entries = await listResponse.json();
  assertEquals(entries.length, 1);
  assertEquals(entries[0].sameTrap, 2);
  assertEquals(entries[0].trappedByMe, true);
  assertEquals(entries[0].comments.length, 1);

  const roomsResponse = await handler(museumRequest("/api/museum/rooms", { userId: "user-a" }));
  const sampleRoom = (await roomsResponse.json()).find((room: { code: string }) => room.code === "LAB-2826");
  assertEquals(sampleRoom.memberCount, 1);
  assertEquals(sampleRoom.entryCount, 1);
});

Deno.test("museum rate limits writes per IP", async () => {
  const db = new FakeDb();
  const handler = createHandler({ db: db as never });
  for (let index = 0; index < 30; index += 1) {
    const response = await handler(museumRequest("/api/museum/identity", {
      method: "POST",
      userId: "user-a",
      ip: "203.0.113.9",
      body: { nickname: `Alice${index}` },
    }));
    assertEquals(response.status, 200);
  }
  const limited = await handler(museumRequest("/api/museum/identity", {
    method: "POST",
    userId: "user-a",
    ip: "203.0.113.9",
    body: { nickname: "Alice" },
  }));
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, "rate_limit_exceeded");
  assert(Number(limited.headers.get("retry-after")) >= 1);
});