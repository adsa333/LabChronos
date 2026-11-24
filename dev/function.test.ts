import { parseDiagnosisContent, repairDiagnosis, validateDiagnosis } from "../functions/diagnosis.ts";
import {
  hasPositiveAndNegativeDelta,
  parseDiagnosisContent as parseCoreDiagnosisContent,
  repairDiagnosis as repairCoreDiagnosis,
  validateDiagnosis as validateCoreDiagnosis,
} from "../functions/diagnosis-core.mjs";
import { createHandler } from "../functions/handler.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = "values differ") {
  if (Object.is(actual, expected)) return;
  throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const validDiagnosis = {
  caseTitle: "训练损失发散",
  domain: "AI/ML",
  observedSymptoms: [
    { id: "s1", label: "Loss 跳变", detail: "第 14 轮后出现 NaN", severity: "critical", source: "log" },
    { id: "s2", label: "梯度异常", detail: "梯度范数快速升高", severity: "warning", source: "log" },
    { id: "s3", label: "曲线发散", detail: "截图中的曲线向上发散", severity: "critical", source: "image" },
  ],
  hypotheses: [
    {
      id: "h1",
      title: "学习率过大",
      mechanism: "更新步长过大导致优化发散",
      priorScore: 34,
      evidenceFor: ["s1"],
      subCauses: ["缺少 warmup", "学习率超过稳定区间"],
      minimalControl: {
        action: "仅降低学习率重跑",
        paramDiff: [{ key: "lr", before: "0.1", after: "0.001" }],
        expectedOutcome: "损失不再出现 NaN",
      },
    },
    {
      id: "h2",
      title: "输入含异常值",
      mechanism: "异常输入破坏梯度计算",
      priorScore: 33,
      evidenceFor: ["s2"],
      subCauses: ["归一化错误", "脏样本"],
      minimalControl: {
        action: "仅替换为已校验批次",
        paramDiff: [{ key: "batch", before: "原批次", "after": "校验批次" }],
        expectedOutcome: "梯度范数恢复稳定",
      },
    },
    {
      id: "h3",
      title: "数值精度不足",
      mechanism: "低精度运算上溢产生非有限值",
      priorScore: 33,
      evidenceFor: ["s3"],
      subCauses: ["FP16 上溢", "缺少损失缩放"],
      minimalControl: {
        action: "仅切换 FP32",
        paramDiff: [{ key: "precision", before: "fp16", after: "fp32" }],
        expectedOutcome: "相同批次可正常反向传播",
      },
    },
  ],
  questions: [
    {
      id: "q1",
      prompt: "单批次前向是否正常？",
      howToCheck: "固定一个批次检查输出有限性",
      options: [
        { label: "正常", scoreDelta: { h1: 30, h2: -25, h3: 0 } },
        { label: "异常", scoreDelta: { h1: -20, h2: 30, h3: 25 } },
        { label: "不确定", scoreDelta: { h1: 0, h2: 0, h3: 0 } },
      ],
    },
    {
      id: "q2",
      prompt: "FP32 是否稳定？",
      howToCheck: "保持其他参数不变切换精度",
      options: [
        { label: "稳定", scoreDelta: { h1: 25, h2: 0, h3: -30 } },
        { label: "仍发散", scoreDelta: { h1: 0, h2: 25, h3: -20 } },
        { label: "不确定", scoreDelta: { h1: 0, h2: 0, h3: 0 } },
      ],
    },
  ],
};

const configuredEnv = (name: string) => ({
  VISION_API_KEY: "test-key",
  VISION_BASE_URL: "https://example.test/v1",
  VISION_MODEL: "test-vision",
}[name]);

Deno.test("repairDiagnosis normalizes a fenced model result", () => {
  const damaged = JSON.parse(JSON.stringify(validDiagnosis));
  damaged.hypotheses.forEach((hypothesis: { priorScore: number }) => { hypothesis.priorScore = 2; });
  damaged.hypotheses[0].evidenceFor = ["missing", "s1"];
  damaged.observedSymptoms[0].bbox = [0, 0, 1, 1];
  damaged.questions[0].options[0].scoreDelta = { h1: 100, h2: -100 };
  damaged.questions[0].options[2] = { label: "其他", scoreDelta: { h1: 15, h2: -10 } };

  const parsed = parseDiagnosisContent(`\`\`\`json\n${JSON.stringify(damaged)}\n\`\`\``);
  assert(parsed.ok, "repaired result should validate");
  assertEquals(parsed.data.hypotheses.reduce((total, hypothesis) => total + hypothesis.priorScore, 0), 100);
  assertEquals(parsed.data.hypotheses[0].evidenceFor.join(","), "s1");
  assertEquals(parsed.data.observedSymptoms[0].bbox, undefined);
  assertEquals(parsed.data.questions[0].options[0].scoreDelta.h1, 40);
  assertEquals(parsed.data.questions[0].options[0].scoreDelta.h2, -40);
  assertEquals(parsed.data.questions[0].options[0].scoreDelta.h3, 0);
  assertEquals(parsed.data.questions[0].options.length, 4);
  assertEquals(parsed.data.questions[0].options[2].label, "其他");
  assertEquals(parsed.data.questions[0].options[3].label, "不确定");
  assert(Object.values(parsed.data.questions[0].options[3].scoreDelta).every((delta) => delta === 0));
});

Deno.test("diagnosis core and TS wrapper stay consistent", () => {
  const damaged = JSON.parse(JSON.stringify(validDiagnosis));
  damaged.hypotheses[0].priorScore = 2;
  damaged.hypotheses[0].evidenceFor = ["missing", "s1"];
  damaged.observedSymptoms[0].bbox = [0, 0, 1, 1];
  damaged.questions[0].options[0].scoreDelta = { h1: 100, h2: -100 };
  const content = `\`\`\`json\n${JSON.stringify(damaged)}\n\`\`\``;

  assertEquals(JSON.stringify(validateDiagnosis(damaged)), JSON.stringify(validateCoreDiagnosis(damaged)));
  assertEquals(JSON.stringify(repairDiagnosis(damaged)), JSON.stringify(repairCoreDiagnosis(damaged)));
  assertEquals(JSON.stringify(parseDiagnosisContent(content)), JSON.stringify(parseCoreDiagnosisContent(content)));
});

Deno.test("repair preserves one-sided nonzero scoreDelta semantics", () => {
  const damaged = JSON.parse(JSON.stringify(validDiagnosis));
  const originalScores = { h1: 1, h2: 2, h3: 3 };
  damaged.questions[0].options[0].scoreDelta = originalScores;
  const repaired = repairCoreDiagnosis(damaged);

  assertEquals(JSON.stringify(repaired.questions[0].options[0].scoreDelta), JSON.stringify(originalScores));
  assert(validateCoreDiagnosis(repaired).success, "nonzero one-sided deltas should satisfy the contract");
  assertEquals(hasPositiveAndNegativeDelta(repaired), false);
});

Deno.test("repair stringifies paramDiff values without hiding raw schema issues", () => {
  const damaged = JSON.parse(JSON.stringify(validDiagnosis));
  damaged.hypotheses[0].minimalControl.paramDiff[0].before = 50;
  damaged.hypotheses[0].minimalControl.paramDiff[0].after = false;

  const rawValidation = validateCoreDiagnosis(damaged);
  assertEquals(rawValidation.success, false);
  assert(rawValidation.issues.some((issue) => issue.path === "hypotheses.0.minimalControl.paramDiff"));

  const repairsApplied: string[] = [];
  const repaired = repairCoreDiagnosis(damaged, repairsApplied);
  assertEquals(repaired.hypotheses[0].minimalControl.paramDiff[0].before, "50");
  assertEquals(repaired.hypotheses[0].minimalControl.paramDiff[0].after, "false");
  assert(repairsApplied.includes("paramDiff_stringified"));
  assert(validateCoreDiagnosis(repaired).success, "stringified paramDiff should satisfy the contract");
});

Deno.test("parseDiagnosisContent extracts JSON surrounded by prose", () => {
  const parsed = parseDiagnosisContent(`模型输出如下：\n${JSON.stringify(validDiagnosis)}\n以上。`);
  assert(parsed.ok, "braced JSON fallback should validate");
  assertEquals(parsed.data.caseTitle, validDiagnosis.caseTitle);
});

Deno.test("health checks configuration without exposing secrets", async () => {
  const handler = createHandler({ env: configuredEnv });
  const response = await handler(new Request("http://local/functions/v1/app/api/health"));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.ok, true);
  assertEquals(body.configured, true);
  assertEquals(body.model, "test-vision");
  assertEquals(body.timeoutBudgetMs, 30_000);
  assertEquals("VISION_API_KEY" in body, false);
  assertEquals("VISION_BASE_URL" in body, false);
});

Deno.test("diagnose returns 503 before parsing when configuration is missing", async () => {
  const handler = createHandler({ env: () => undefined });
  const response = await handler(new Request("http://local/api/diagnose", { method: "POST" }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "service_not_configured");
});

Deno.test("diagnose limits each IP to ten requests per minute", async () => {
  const handler = createHandler({ env: configuredEnv });
  for (let index = 0; index < 10; index += 1) {
    const response = await handler(new Request("http://local/api/diagnose", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
      body: JSON.stringify({ logText: "" }),
    }));
    assertEquals(response.status, 400);
  }
  const limited = await handler(new Request("http://local/api/diagnose", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ logText: "loss=nan" }),
  }));
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, "rate_limit_exceeded");
});

Deno.test("diagnose disables thinking only for Qwen3 or Aliyun endpoints", async () => {
  const cases = [
    { name: "Qwen3 model", model: "qwen3.7-flash", baseUrl: "https://example.test/v1", disableThinking: true },
    { name: "Aliyun endpoint", model: "test-vision", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", disableThinking: true },
    { name: "generic OpenAI endpoint", model: "test-vision", baseUrl: "https://example.test/v1", disableThinking: false },
  ];

  for (const testCase of cases) {
    let hasEnableThinking = false;
    let enableThinking: boolean | undefined;
    const handler = createHandler({
      env: (name) => ({
        VISION_API_KEY: "test-key",
        VISION_BASE_URL: testCase.baseUrl,
        VISION_MODEL: testCase.model,
      }[name]),
      fetch: async (_input, init) => {
        const requestBody = JSON.parse(String(init?.body));
        hasEnableThinking = "enable_thinking" in requestBody;
        enableThinking = requestBody.enable_thinking;
        return Response.json({ choices: [{ message: { content: JSON.stringify(validDiagnosis) } }] });
      },
    });
    const response = await handler(new Request("http://local/api/diagnose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logText: "loss=nan", domainHint: "AI/ML" }),
    }));

    assertEquals(response.status, 200, testCase.name);
    assertEquals(hasEnableThinking, testCase.disableThinking, testCase.name);
    if (testCase.disableThinking) assertEquals(enableThinking, false, testCase.name);
  }
});

Deno.test("diagnose retries once with validation feedback", async () => {
  let calls = 0;
  const temperatures: number[] = [];
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  const handler = createHandler({
    env: configuredEnv,
    fetch: async (_input, init) => {
      calls += 1;
      const requestBody = JSON.parse(String(init?.body));
      temperatures.push(requestBody.temperature);
      assertEquals(requestBody.response_format.type, "json_object");
      if (calls === 2) retryMessages = requestBody.messages;
      const content = calls === 1 ? "{}" : JSON.stringify(validDiagnosis);
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  const response = await handler(new Request("http://local/functions/v1/app/api/diagnose", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.20" },
    body: JSON.stringify({ logText: "Epoch 14 loss=nan", domainHint: "AI/ML" }),
  }));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("x-diagnosis-model"), "test-vision");
  assertEquals(calls, 2);
  assertEquals(temperatures.join(","), "0.2,0.35");
  assertEquals(retryMessages.length, 2);
  assertEquals(retryMessages.map((message) => message.role).join(","), "system,user");
  assertEquals(retryMessages.some((message) => message.role === "assistant"), false);
  assert(JSON.stringify(retryMessages[1]?.content).includes("【契约纠偏重生成】"));
  assert(JSON.stringify(retryMessages[1]?.content).includes("Epoch 14 loss=nan"));
  assertEquals((await response.json()).caseTitle, "训练损失发散");
});

Deno.test("diagnose rounds fractional retry timeouts", async () => {
  const originalNow = Date.now;
  let now = 1000;
  let calls = 0;
  Date.now = () => now;
  try {
    const handler = createHandler({
      env: configuredEnv,
      fetch: async () => {
        calls += 1;
        if (calls === 1) now = 1000.5;
        const content = calls === 1 ? "{}" : JSON.stringify(validDiagnosis);
        return Response.json({ choices: [{ message: { content } }] });
      },
    });
    const response = await handler(new Request("http://local/api/diagnose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logText: "loss=nan", domainHint: "AI/ML" }),
    }));

    assertEquals(response.status, 200);
    assertEquals(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("diagnose returns a sanitized parse error after two invalid results", async () => {
  const handler = createHandler({
    env: configuredEnv,
    fetch: async () => Response.json({ choices: [{ message: { content: "not json" } }] }),
  });
  const response = await handler(new Request("http://local/api/diagnose", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.30" },
    body: JSON.stringify({ logText: "loss=nan" }),
  }));
  assertEquals(response.status, 502);
  const body = await response.json();
  assertEquals(body.error, "diagnosis_parse_failed");
  assertEquals(JSON.stringify(body).includes("test-key"), false);
});

Deno.test("vault-test performs a bounded read with the injected database", async () => {
  const handler = createHandler({
    db: {
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    },
  });
  const response = await handler(new Request("http://local/api/vault-test"));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).read, true);
});
