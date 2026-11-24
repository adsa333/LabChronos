import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  extractJsonValue,
  hasPositiveAndNegativeDelta,
  parseDiagnosisContent,
  validateDiagnosis,
} from "../functions/diagnosis-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = resolve(ROOT, "eval/report.json");
const SCORE_DELTA_REPAIRS = new Set(["scoreDelta_keys_completed", "scoreDelta_clamped", "uncertain_option_normalized"]);
const missing = ["VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL"].filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`缺少环境变量：${missing.join("、")}。请先在当前终端注入，再运行 node eval/run-eval.mjs。`);
  process.exit(1);
}

const config = {
  apiKey: process.env.VISION_API_KEY,
  baseUrl: process.env.VISION_BASE_URL,
  model: process.env.VISION_MODEL,
};

try {
  const parsedBase = new URL(config.baseUrl);
  if (!["https:", "http:"].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    throw new Error();
  }
} catch {
  console.error("VISION_BASE_URL 无效：应为不带账号、查询参数或片段的 HTTP(S) 基础地址。");
  process.exit(1);
}

const PRESET_REFERENCES = [
  {
    id: "ai-training-nan",
    domainHint: "AI/ML",
    expected: { trueCause: "AMP 下梯度溢出且未执行梯度裁剪", keywords: ["AMP", "梯度裁剪"] },
  },
  {
    id: "gel-electrophoresis-smearing",
    domainHint: "Bio/Chem",
    expected: { trueCause: "DNA 上样量过大导致过载", keywords: ["上样量", "过载"] },
  },
  {
    id: "oscilloscope-ringing",
    domainHint: "Physics/EE",
    expected: { trueCause: "探头接地线过长形成谐振回路", keywords: ["接地", "谐振"] },
  },
];

class ModelError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSystemPrompt() {
  const source = readFileSync(resolve(ROOT, "functions/prompts/diagnose.ts"), "utf8");
  const match = source.match(/export\s+const\s+SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;\s*$/);
  if (!match) throw new Error("无法从 functions/prompts/diagnose.ts 提取 SYSTEM_PROMPT。");
  return match[1];
}

function buildMessages(input, systemPrompt) {
  const text = [
    input.domainHint ? `实验领域提示：${input.domainHint}` : "实验领域提示：未提供，请依据材料判断。",
    input.logText?.trim() ? `实验日志：\n${input.logText}` : "实验日志：未提供。",
    input.imageBase64 ? "已提供实验图像，请结合图像与上述材料取证。" : "未提供实验图像，请仅依据日志取证。",
  ].join("\n\n");
  const userContent = [
    { type: "text", text },
    ...(input.imageBase64 ? [{ type: "image_url", image_url: { url: input.imageBase64 } }] : []),
  ];
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

async function callModel(messages, timeoutMs, temperature = 0.2) {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const disableThinking = endpoint.includes("aliyuncs.com") || /qwen3/i.test(config.model);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      response_format: { type: "json_object" },
      ...(disableThinking ? { enable_thinking: false } : {}),
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ModelError("upstream_http_error", response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ModelError("upstream_invalid_response");
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new ModelError("upstream_invalid_response");
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new ModelError("upstream_invalid_response");
  }
  return choice.message.content;
}

function inspectRawDiagnosis(content) {
  let rawJsonSyntaxValid = true;
  let directValue;
  try {
    directValue = JSON.parse(content);
  } catch {
    rawJsonSyntaxValid = false;
  }
  const extracted = rawJsonSyntaxValid ? { ok: true, value: directValue } : extractJsonValue(content);
  const rawValidation = extracted.ok
    ? validateDiagnosis(extracted.value)
    : { success: false, issues: [{ path: "(root)", message: "输出不是合法 JSON" }] };
  return {
    rawJsonSyntaxValid,
    rawSchemaValid: rawValidation.success,
    rawSchemaIssues: rawValidation.success ? [] : rawValidation.issues,
    rawStrictDeltaValid: extracted.ok ? hasPositiveAndNegativeDelta(extracted.value) : false,
  };
}

function summarizeHypotheses(content) {
  const extracted = extractJsonValue(content);
  if (!extracted.ok || !isRecord(extracted.value) || !Array.isArray(extracted.value.hypotheses)) return [];
  return extracted.value.hypotheses.map((hypothesis) => isRecord(hypothesis) ? {
    id: typeof hypothesis.id === "string" ? hypothesis.id : null,
    title: typeof hypothesis.title === "string" ? hypothesis.title : null,
    priorScore: typeof hypothesis.priorScore === "number" && Number.isFinite(hypothesis.priorScore) ? hypothesis.priorScore : null,
  } : { id: null, title: null, priorScore: null });
}

function normalizeMatchText(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function matchesExpected(hypothesis, expected) {
  if (!hypothesis) return false;
  const text = normalizeMatchText(JSON.stringify(hypothesis));
  const trueCause = normalizeMatchText(expected.trueCause);
  if (trueCause && text.includes(trueCause)) return true;
  return expected.keywords.some((keyword) => {
    const normalized = normalizeMatchText(keyword);
    return normalized && text.includes(normalized);
  });
}

function scoreHypotheses(diagnosis, answerIndices) {
  const weights = diagnosis.hypotheses.map((hypothesis) => {
    const delta = diagnosis.questions.reduce((total, question, questionIndex) => {
      const optionIndex = answerIndices[questionIndex];
      if (optionIndex === undefined) return total;
      return total + (question.options[optionIndex]?.scoreDelta[hypothesis.id] ?? 0);
    }, 0);
    return { hypothesis, weight: Math.max(5, hypothesis.priorScore + delta) };
  });
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  return weights.map((item) => ({ ...item, probability: item.weight / total }));
}

function getLeading(scores) {
  return scores.reduce((leading, item) => item.probability > leading.probability ? item : leading, scores[0]);
}

function evaluateTop1(diagnosis, expected) {
  const initial = getLeading(scoreHypotheses(diagnosis, []));
  const choices = diagnosis.questions.map((question) => question.options.slice(0, -1).map((_, index) => index));
  let best = null;

  function visit(questionIndex, answers) {
    if (questionIndex === choices.length) {
      const scores = scoreHypotheses(diagnosis, answers);
      const leading = getLeading(scores);
      const expectedProbability = Math.max(0, ...scores.filter((item) => matchesExpected(item.hypothesis, expected))
        .map((item) => item.probability));
      const candidate = {
        answers: [...answers],
        leading,
        hit: matchesExpected(leading.hypothesis, expected),
        expectedProbability,
      };
      if (!best || (candidate.hit && !best.hit) ||
        (candidate.hit === best.hit && candidate.expectedProbability > best.expectedProbability) ||
        (candidate.hit === best.hit && candidate.expectedProbability === best.expectedProbability && candidate.leading.probability > best.leading.probability)) {
        best = candidate;
      }
      return;
    }
    for (const optionIndex of choices[questionIndex]) {
      answers.push(optionIndex);
      visit(questionIndex + 1, answers);
      answers.pop();
    }
  }
  visit(0, []);

  return {
    initialTop1: {
      hypothesisId: initial.hypothesis.id,
      title: initial.hypothesis.title,
      priorScore: initial.hypothesis.priorScore,
      hit: matchesExpected(initial.hypothesis, expected),
    },
    finalTop1: {
      hypothesisId: best.leading.hypothesis.id,
      title: best.leading.hypothesis.title,
      probability: Number(best.leading.probability.toFixed(4)),
      hit: best.hit,
    },
    idealAnswers: best.answers.map((optionIndex, questionIndex) => ({
      questionId: diagnosis.questions[questionIndex].id,
      optionIndex,
    })),
  };
}

function elapsed(started) {
  return Math.round(performance.now() - started);
}

function safeModelError(error, attempt) {
  const phase = attempt === 1 ? "first_upstream" : "retry_upstream";
  if (error instanceof ModelError) return { phase, code: error.code, status: error.status };
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return { phase, code: "upstream_timeout", status: null };
  return { phase, code: "upstream_failed", status: null };
}

async function runCase(testCase, systemPrompt) {
  const started = performance.now();
  const result = {
    id: testCase.id,
    source: testCase.source,
    multimodal: Boolean(testCase.input.imageBase64),
    durationMs: 0,
    firstAttemptMs: null,
    retryAttemptMs: null,
    rawJsonSyntaxValid: false,
    rawSchemaValid: false,
    rawSchemaIssues: [],
    rawStrictDeltaValid: false,
    repairedFirstPass: false,
    repairsApplied: [],
    scoreDeltaModified: false,
    diagnosedHypotheses: [],
    firstPass: false,
    retried: false,
    finalValid: false,
    initialTop1: null,
    finalTop1: null,
    idealAnswers: [],
    firstParseFeedback: null,
    finalParseFeedback: null,
    error: null,
  };
  let attempt = 1;

  async function timedCall(messages, field, timeoutMs, temperature = 0.2) {
    const attemptStarted = performance.now();
    try {
      return await callModel(messages, timeoutMs, temperature);
    } finally {
      result[field] = elapsed(attemptStarted);
    }
  }

  try {
    const messages = buildMessages(testCase.input, systemPrompt);
    let content = await timedCall(messages, "firstAttemptMs", 28_500);
    Object.assign(result, inspectRawDiagnosis(content));
    result.diagnosedHypotheses = summarizeHypotheses(content);
    const repairsApplied = [];
    let parsed = parseDiagnosisContent(content, repairsApplied);
    result.repairsApplied = result.rawSchemaValid ? [] : repairsApplied;
    result.repairedFirstPass = parsed.ok;
    result.firstPass = parsed.ok;
    const elapsedMs = performance.now() - started;

    if (!parsed.ok && elapsedMs < 18_000) {
      result.firstParseFeedback = parsed.feedback;
      result.retried = true;
      attempt = 2;
      const retryMessages = [
        messages[0],
        {
          role: "user",
          content: [
            ...messages[1].content,
            {
              type: "text",
              text: `【契约纠偏重生成】上次输出未通过校验：${parsed.feedback}。请重新完整生成单行紧凑 JSON，必须包含 3 条 observedSymptoms（s1~s3）、3 个完整 hypotheses（h1~h3，minimalControl 为对象）和 2 道 questions（q1~q2，末选项全 0「不确定」）。`,
            },
          ],
        },
      ];
      content = await timedCall(retryMessages, "retryAttemptMs", Math.max(5_000, Math.round(29_500 - elapsedMs)), 0.35);
      result.diagnosedHypotheses = summarizeHypotheses(content);
      const retryRepairsApplied = [];
      parsed = parseDiagnosisContent(content, retryRepairsApplied);
      if (parsed.ok) result.repairsApplied = [...new Set([...result.repairsApplied, ...retryRepairsApplied])];
    }

    if (!parsed.ok) {
      result.finalParseFeedback = parsed.feedback;
      result.error = { phase: "parse", code: "diagnosis_parse_failed", status: null };
      return result;
    }

    result.finalValid = true;
    Object.assign(result, evaluateTop1(parsed.data, testCase.expected));
    return result;
  } catch (error) {
    result.error = safeModelError(error, attempt);
    return result;
  } finally {
    result.durationMs = elapsed(started);
    result.scoreDeltaModified = result.repairsApplied.some((name) => SCORE_DELTA_REPAIRS.has(name));
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function percentileMs(results, percentile) {
  if (results.length === 0) return 0;
  const durations = results.map((result) => result.durationMs).sort((left, right) => left - right);
  return durations[Math.max(0, Math.ceil(durations.length * percentile) - 1)];
}

function summarizeGroup(results) {
  const rawJsonSyntaxPassCount = results.filter((result) => result.rawJsonSyntaxValid).length;
  const rawSchemaPassCount = results.filter((result) => result.rawSchemaValid).length;
  const rawStrictDeltaPassCount = results.filter((result) => result.rawStrictDeltaValid).length;
  const firstPassCount = results.filter((result) => result.firstPass).length;
  const finalValidCount = results.filter((result) => result.finalValid).length;
  const initialTop1Hits = results.filter((result) => result.initialTop1?.hit === true).length;
  const finalTop1Hits = results.filter((result) => result.finalTop1?.hit === true).length;
  return {
    totalCases: results.length,
    rawJsonSyntaxPassCount,
    rawJsonSyntaxPassRate: ratio(rawJsonSyntaxPassCount, results.length),
    rawSchemaPassCount,
    rawSchemaPassRate: ratio(rawSchemaPassCount, results.length),
    rawStrictDeltaPassCount,
    rawStrictDeltaPassRate: ratio(rawStrictDeltaPassCount, results.length),
    firstPassCount,
    finalValidCount,
    finalLegalRate: ratio(finalValidCount, results.length),
    scoreDeltaModifiedCount: results.filter((result) => result.scoreDeltaModified).length,
    initialTop1Hits,
    initialTop1HitRate: ratio(initialTop1Hits, results.length),
    finalTop1Hits,
    finalTop1HitRate: ratio(finalTop1Hits, results.length),
    p50Ms: percentileMs(results, 0.5),
    p95Ms: percentileMs(results, 0.95),
    over30SecondsCount: results.filter((result) => result.durationMs > 30_000).length,
  };
}

function printGroupSummary(label, summary) {
  console.log(`${label}：原始 JSON ${summary.rawJsonSyntaxPassCount}/${summary.totalCases} = ${percent(summary.rawJsonSyntaxPassRate)}；原始 Schema ${summary.rawSchemaPassCount}/${summary.totalCases} = ${percent(summary.rawSchemaPassRate)}；原始正负分 ${summary.rawStrictDeltaPassCount}/${summary.totalCases} = ${percent(summary.rawStrictDeltaPassRate)}`);
  console.log(`${label}：修复后合法率 ${summary.finalValidCount}/${summary.totalCases} = ${percent(summary.finalLegalRate)}；初始 Top-1 ${summary.initialTop1Hits}/${summary.totalCases} = ${percent(summary.initialTop1HitRate)}；最终 Top-1 ${summary.finalTop1Hits}/${summary.totalCases} = ${percent(summary.finalTop1HitRate)}；p50 ${summary.p50Ms}ms；p95 ${summary.p95Ms}ms；超过 30 秒 ${summary.over30SecondsCount} 例`);
}

async function main() {
  const systemPrompt = readSystemPrompt();
  const manifest = readJson(resolve(ROOT, "eval/cases/manifest.json"));
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 15) {
    throw new Error("eval/cases/manifest.json 必须列出 15 个病例。");
  }

  const standardCases = manifest.cases.map((entry) => {
    const testCase = readJson(resolve(ROOT, "eval/cases", entry.file));
    return {
      id: testCase.id,
      source: "cases",
      input: testCase.input,
      expected: testCase.expected,
    };
  });
  const presetCases = PRESET_REFERENCES.map((preset) => ({
    id: preset.id,
    source: "presets",
    input: {
      logText: readFileSync(resolve(ROOT, "src/data/presets/assets", `${preset.id}.log`), "utf8"),
      domainHint: preset.domainHint,
      imageBase64: `data:image/png;base64,${readFileSync(resolve(ROOT, "src/data/presets/assets", `${preset.id}.png`)).toString("base64")}`,
    },
    expected: preset.expected,
  }));
  const testCases = [...standardCases, ...presetCases];

  const results = [];
  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    console.log(`[${index + 1}/${testCases.length}] ${testCase.id}`);
    results.push(await runCase(testCase, systemPrompt));
  }

  const standard15 = summarizeGroup(results.filter((result) => result.source === "cases"));
  const presets3 = summarizeGroup(results.filter((result) => result.source === "presets"));
  const overall = summarizeGroup(results);
  const retriedCount = results.filter((result) => result.retried).length;
  const summary = {
    ...overall,
    multimodalCases: results.filter((result) => result.multimodal).length,
    totalDurationMs: results.reduce((total, result) => total + result.durationMs, 0),
    retriedCount,
    firstPassRate: ratio(overall.firstPassCount, results.length),
    standard15,
    presets3,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: config.model,
    prompt: {
      source: "functions/prompts/diagnose.ts",
      sha256: createHash("sha256").update(systemPrompt).digest("hex"),
    },
    methodology: {
      top1Denominator: "各组全部用例数（standard15=15、presets3=3、总体=18）；解析失败计为 Top-1 未命中。",
      match: "NFKC 规范化后，假设内容包含 expected.trueCause，或包含任一 expected.keywords，即判为命中。",
      idealAnswers: "枚举每题全部实质性选项（排除末位不确定），按 weight=max(5, priorScore+sum(scoreDelta)) 推演，选择正确假设夺冠且概率最高的路径。",
      privacy: "不保存输入、图片、expected、distractors、模型原文、上游响应或密钥；仅保存假设 id/title/priorScore 摘要。",
    },
    summary,
    results,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.table(results.map((result) => ({
    病例: result.id,
    来源: result.source,
    总耗时ms: result.durationMs,
    首次ms: result.firstAttemptMs,
    重试ms: result.retryAttemptMs,
    二次重试: result.retried ? "是" : "否",
    原始JSON: result.rawJsonSyntaxValid ? "是" : "否",
    原始Schema: result.rawSchemaValid ? "是" : "否",
    修复后通过: result.repairedFirstPass ? "是" : "否",
    最终合法: result.finalValid ? "是" : "否",
    初始Top1: result.initialTop1 ? (result.initialTop1.hit ? "命中" : "未中") : "—",
    理想Top1: result.finalTop1 ? (result.finalTop1.hit ? "命中" : "未中") : "—",
    错误: result.error?.code ?? "",
  })));
  console.log(`首次修复后通过率：${overall.firstPassCount}/${results.length} = ${percent(summary.firstPassRate)}；二次重试：${retriedCount}/${results.length} 例；语义改分：${overall.scoreDeltaModifiedCount} 例`);
  printGroupSummary("标准 15 例", standard15);
  printGroupSummary("全部 18 例", overall);
  console.log("报告已写入 eval/report.json。");
}

main().catch((error) => {
  console.error(`评测初始化失败：${error.message}`);
  process.exitCode = 1;
});
