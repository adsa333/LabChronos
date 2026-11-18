import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = resolve(ROOT, "eval/report.json");
const DOMAINS = new Set(["AI/ML", "Bio/Chem", "Physics/EE", "General"]);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSystemPrompt() {
  const source = readFileSync(resolve(ROOT, "functions/prompts/diagnose.ts"), "utf8");
  const match = source.match(/export\s+const\s+SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;\s*$/);
  if (!match) throw new Error("无法从 functions/prompts/diagnose.ts 提取 SYSTEM_PROMPT。");
  return match[1];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : value;
}

function clampDelta(value) {
  return isFiniteNumber(value) ? Math.max(-40, Math.min(40, value)) : 0;
}

function normalizePriorScores(hypotheses) {
  if (hypotheses.length === 0) return hypotheses;
  const weights = hypotheses.map((hypothesis) => {
    if (!isRecord(hypothesis)) return 0;
    const score = hypothesis.priorScore;
    return isFiniteNumber(score) && score > 0 ? score : 0;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const normalized = weights.map((weight) => weight > 0 ? weight / weightTotal * 100 : 100 / hypotheses.length);
  const scores = normalized.map(Math.floor);
  let remainder = 100 - scores.reduce((sum, score) => sum + score, 0);
  const byFraction = normalized.map((score, index) => ({ index, fraction: score - Math.floor(score) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; remainder > 0; index = (index + 1) % byFraction.length) {
    scores[byFraction[index].index] += 1;
    remainder -= 1;
  }
  return hypotheses.map((hypothesis, index) =>
    isRecord(hypothesis) ? { ...hypothesis, priorScore: scores[index] } : hypothesis
  );
}

function repairDiagnosis(value) {
  if (!isRecord(value)) return value;
  const observedSymptoms = Array.isArray(value.observedSymptoms)
    ? value.observedSymptoms.slice(0, 5).map((symptom) => {
        if (!isRecord(symptom)) return symptom;
        const repaired = { ...symptom };
        const bbox = symptom.bbox;
        const validBbox = Array.isArray(bbox) && bbox.length === 4 && bbox.every((part) =>
          isFiniteNumber(part) && part >= 0 && part <= 1
        ) && bbox[0] + bbox[2] <= 1 && bbox[1] + bbox[3] <= 1 && bbox[2] > 0 && bbox[3] > 0 && bbox[2] * bbox[3] < 0.85;
        if (validBbox) repaired.bbox = [...bbox];
        else delete repaired.bbox;
        return repaired;
      })
    : value.observedSymptoms;

  const symptomIds = new Set(
    Array.isArray(observedSymptoms) ? observedSymptoms.flatMap((symptom) => isRecord(symptom) && typeof symptom.id === "string" ? [symptom.id] : []) : [],
  );

  let hypotheses = Array.isArray(value.hypotheses)
    ? value.hypotheses.slice(0, 4).map((hypothesis) => {
        if (!isRecord(hypothesis)) return hypothesis;
        let subCauses = Array.isArray(hypothesis.subCauses) ? hypothesis.subCauses : [];
        if (subCauses.length > 2) subCauses = subCauses.slice(0, 2);
        else if (subCauses.length === 1) subCauses = [subCauses[0], "待结合对照实验进一步确认"];
        else if (subCauses.length === 0) subCauses = ["待结合现有证据进一步确认", "待结合对照实验进一步确认"];
        return {
          ...hypothesis,
          subCauses,
          evidenceFor: Array.isArray(hypothesis.evidenceFor)
            ? [...new Set(hypothesis.evidenceFor.filter((id) => typeof id === "string" && symptomIds.has(id)))]
            : hypothesis.evidenceFor,
        };
      })
    : value.hypotheses;
  if (Array.isArray(hypotheses)) hypotheses = normalizePriorScores(hypotheses);

  const hypothesisIds = Array.isArray(hypotheses)
    ? hypotheses.flatMap((hypothesis) => isRecord(hypothesis) && typeof hypothesis.id === "string" ? [hypothesis.id] : [])
    : [];

  const questions = Array.isArray(value.questions)
    ? value.questions.slice(0, 3).map((question) => {
        if (!isRecord(question) || !Array.isArray(question.options)) return question;
        const zeroScores = () => Object.fromEntries(hypothesisIds.map((id) => [id, 0]));
        const options = question.options.map((option) => {
          if (!isRecord(option)) return option;
          const originalScores = isRecord(option.scoreDelta) ? option.scoreDelta : {};
          return {
            ...option,
            scoreDelta: Object.fromEntries(hypothesisIds.map((id) => [id, clampDelta(originalScores[id])])),
          };
        });
        if (options.length > 0) {
          const lastIndex = options.length - 1;
          const lastOption = options[lastIndex];
          if (isRecord(lastOption) && lastOption.label === "不确定") {
            options[lastIndex] = { ...lastOption, scoreDelta: zeroScores() };
          } else if (options.length < 4) {
            options.push({ label: "不确定", scoreDelta: zeroScores() });
          } else {
            options[lastIndex] = { label: "不确定", scoreDelta: zeroScores() };
          }
        }
        options.forEach((option, optionIndex) => {
          if (optionIndex === options.length - 1 || !isRecord(option) || !isRecord(option.scoreDelta)) return;
          const scoreDelta = option.scoreDelta;
          let positiveId = hypothesisIds.find((id) => scoreDelta[id] > 0);
          if (!positiveId && hypothesisIds.length > 0) {
            const bestId = hypothesisIds.reduce((best, id) => scoreDelta[id] > scoreDelta[best] ? id : best, hypothesisIds[0]);
            positiveId = bestId;
            scoreDelta[bestId] = 25;
          }
          if (!hypothesisIds.some((id) => scoreDelta[id] < 0)) {
            const candidates = hypothesisIds.filter((id) => id !== positiveId);
            if (candidates.length > 0) {
              const negativeId = candidates.reduce((lowest, id) => scoreDelta[id] < scoreDelta[lowest] ? id : lowest, candidates[0]);
              scoreDelta[negativeId] = -20;
            }
          }
        });
        return { ...question, options };
      })
    : value.questions;

  return { ...value, observedSymptoms, hypotheses, questions };
}

function trimDiagnosisStrings(value) {
  if (!isRecord(value)) return value;
  const result = { ...value, caseTitle: trimmed(value.caseTitle), confidenceNote: trimmed(value.confidenceNote) };
  if (Array.isArray(value.observedSymptoms)) {
    result.observedSymptoms = value.observedSymptoms.map((symptom) => isRecord(symptom) ? {
      ...symptom,
      id: trimmed(symptom.id),
      label: trimmed(symptom.label),
      detail: trimmed(symptom.detail),
    } : symptom);
  }
  if (Array.isArray(value.hypotheses)) {
    result.hypotheses = value.hypotheses.map((hypothesis) => {
      if (!isRecord(hypothesis)) return hypothesis;
      const control = isRecord(hypothesis.minimalControl) ? {
        ...hypothesis.minimalControl,
        action: trimmed(hypothesis.minimalControl.action),
        expectedOutcome: trimmed(hypothesis.minimalControl.expectedOutcome),
        paramDiff: Array.isArray(hypothesis.minimalControl.paramDiff)
          ? hypothesis.minimalControl.paramDiff.map((part) => isRecord(part) ? { ...part, key: trimmed(part.key) } : part)
          : hypothesis.minimalControl.paramDiff,
      } : hypothesis.minimalControl;
      return {
        ...hypothesis,
        id: trimmed(hypothesis.id),
        title: trimmed(hypothesis.title),
        mechanism: trimmed(hypothesis.mechanism),
        evidenceFor: Array.isArray(hypothesis.evidenceFor) ? hypothesis.evidenceFor.map(trimmed) : hypothesis.evidenceFor,
        subCauses: Array.isArray(hypothesis.subCauses) ? hypothesis.subCauses.map(trimmed) : hypothesis.subCauses,
        minimalControl: control,
      };
    });
  }
  if (Array.isArray(value.questions)) {
    result.questions = value.questions.map((question) => isRecord(question) ? {
      ...question,
      id: trimmed(question.id),
      prompt: trimmed(question.prompt),
      howToCheck: trimmed(question.howToCheck),
      options: Array.isArray(question.options) ? question.options.map((option) => isRecord(option) ? {
        ...option,
        label: trimmed(option.label),
      } : option) : question.options,
    } : question);
  }
  return result;
}

function validateDiagnosis(value) {
  const data = trimDiagnosisStrings(value);
  const issues = [];
  const add = (path, message) => issues.push({ path, message });

  if (!isRecord(data)) {
    return { success: false, issues: [{ path: "(root)", message: "结果必须是 JSON 对象" }] };
  }
  if (!isNonEmptyString(data.caseTitle)) add("caseTitle", "必须为非空字符串");
  if (!DOMAINS.has(data.domain)) add("domain", "必须为 AI/ML、Bio/Chem、Physics/EE 或 General");
  if (data.confidenceNote !== undefined && !isNonEmptyString(data.confidenceNote)) add("confidenceNote", "必须为非空字符串");

  if (!Array.isArray(data.observedSymptoms) || data.observedSymptoms.length < 3 || data.observedSymptoms.length > 5) {
    add("observedSymptoms", "必须包含 3~5 条症状");
  } else {
    data.observedSymptoms.forEach((symptom, index) => {
      const path = `observedSymptoms.${index}`;
      if (!isRecord(symptom)) {
        add(path, "必须为对象");
        return;
      }
      for (const key of ["id", "label", "detail"]) {
        if (!isNonEmptyString(symptom[key])) add(`${path}.${key}`, "必须为非空字符串");
      }
      if (!["critical", "warning"].includes(symptom.severity)) add(`${path}.severity`, "必须为 critical 或 warning");
      if (!["image", "log"].includes(symptom.source)) add(`${path}.source`, "必须为 image 或 log");
      const bbox = symptom.bbox;
      if (bbox !== undefined && !(Array.isArray(bbox) && bbox.length === 4 && bbox.every((part) =>
        isFiniteNumber(part) && part >= 0 && part <= 1
      ) && bbox[2] > 0 && bbox[3] > 0 && bbox[0] + bbox[2] <= 1 && bbox[1] + bbox[3] <= 1 && bbox[2] * bbox[3] < 0.85)) {
        add(`${path}.bbox`, "必须为有效的归一化 [x, y, width, height]");
      }
    });
  }

  if (!Array.isArray(data.hypotheses) || data.hypotheses.length < 3 || data.hypotheses.length > 4) {
    add("hypotheses", "必须包含 3~4 个假设");
  } else {
    data.hypotheses.forEach((hypothesis, index) => {
      const path = `hypotheses.${index}`;
      if (!isRecord(hypothesis)) {
        add(path, "必须为对象");
        return;
      }
      for (const key of ["id", "title", "mechanism"]) {
        if (!isNonEmptyString(hypothesis[key])) add(`${path}.${key}`, "必须为非空字符串");
      }
      if (!isFiniteNumber(hypothesis.priorScore) || hypothesis.priorScore < 0 || hypothesis.priorScore > 100) {
        add(`${path}.priorScore`, "必须为 0~100 的有限数值");
      }
      if (!Array.isArray(hypothesis.evidenceFor) || !hypothesis.evidenceFor.every(isNonEmptyString)) {
        add(`${path}.evidenceFor`, "必须为非空字符串数组");
      }
      if (!Array.isArray(hypothesis.subCauses) || hypothesis.subCauses.length !== 2 || !hypothesis.subCauses.every(isNonEmptyString)) {
        add(`${path}.subCauses`, "必须恰好包含 2 条非空字符串");
      }
      const control = hypothesis.minimalControl;
      if (!isRecord(control)) {
        add(`${path}.minimalControl`, "必须为对象");
        return;
      }
      if (!isNonEmptyString(control.action)) add(`${path}.minimalControl.action`, "必须为非空字符串");
      if (!Array.isArray(control.paramDiff) || !control.paramDiff.every((part) =>
        isRecord(part) && isNonEmptyString(part.key) && typeof part.before === "string" && typeof part.after === "string"
      )) {
        add(`${path}.minimalControl.paramDiff`, "必须包含有效的 key/before/after");
      }
      if (!isNonEmptyString(control.expectedOutcome)) add(`${path}.minimalControl.expectedOutcome`, "必须为非空字符串");
      if (control.expectedCurve !== undefined && !(Array.isArray(control.expectedCurve) && control.expectedCurve.every((point) =>
        isRecord(point) && isFiniteNumber(point.x) && (point.before === null || isFiniteNumber(point.before)) && isFiniteNumber(point.after)
      ))) {
        add(`${path}.minimalControl.expectedCurve`, "必须包含有效的 x/before/after 数值");
      }
    });
  }

  if (!Array.isArray(data.questions) || data.questions.length < 2 || data.questions.length > 3) {
    add("questions", "必须包含 2~3 道问题");
  } else {
    data.questions.forEach((question, index) => {
      const path = `questions.${index}`;
      if (!isRecord(question)) {
        add(path, "必须为对象");
        return;
      }
      for (const key of ["id", "prompt", "howToCheck"]) {
        if (!isNonEmptyString(question[key])) add(`${path}.${key}`, "必须为非空字符串");
      }
      if (!Array.isArray(question.options) || question.options.length < 3 || question.options.length > 4) {
        add(`${path}.options`, "必须包含 3~4 个选项");
        return;
      }
      question.options.forEach((option, optionIndex) => {
        const optionPath = `${path}.options.${optionIndex}`;
        if (!isRecord(option) || !isNonEmptyString(option.label)) add(`${optionPath}.label`, "必须为非空字符串");
        if (!isRecord(option) || !isRecord(option.scoreDelta)) {
          add(`${optionPath}.scoreDelta`, "必须为数值记录");
          return;
        }
        for (const [id, delta] of Object.entries(option.scoreDelta)) {
          if (!isFiniteNumber(delta) || delta < -40 || delta > 40) add(`${optionPath}.scoreDelta.${id}`, "必须为 -40~40 的有限数值");
        }
      });
    });
  }

  if (issues.length === 0) {
    const symptomIds = new Set(data.observedSymptoms.map((symptom) => symptom.id));
    const hypothesisIds = data.hypotheses.map((hypothesis) => hypothesis.id);
    const sortedHypothesisIds = [...hypothesisIds].sort();
    const priorTotal = data.hypotheses.reduce((total, hypothesis) => total + hypothesis.priorScore, 0);
    if (Math.abs(priorTotal - 100) > 0.0001) add("hypotheses", "priorScore 合计必须为 100");

    data.hypotheses.forEach((hypothesis, hypothesisIndex) => {
      hypothesis.evidenceFor.forEach((symptomId, evidenceIndex) => {
        if (!symptomIds.has(symptomId)) {
          add(`hypotheses.${hypothesisIndex}.evidenceFor.${evidenceIndex}`, `evidenceFor 引用了不存在的 symptom id: ${symptomId}`);
        }
      });
    });

    data.questions.forEach((question, questionIndex) => {
      question.options.forEach((option, optionIndex) => {
        const scoreIds = Object.keys(option.scoreDelta).sort();
        const isLast = optionIndex === question.options.length - 1;
        if (scoreIds.length !== sortedHypothesisIds.length || scoreIds.some((id, index) => id !== sortedHypothesisIds[index])) {
          add(`questions.${questionIndex}.options.${optionIndex}.scoreDelta`, "scoreDelta 必须精确覆盖全部 hypothesis id");
        }
        if (isLast) {
          if (option.label !== "不确定" || Object.values(option.scoreDelta).some((delta) => delta !== 0)) {
            add(`questions.${questionIndex}.options.${optionIndex}`, "末选项必须为全 0 的「不确定」");
          }
        } else {
          const deltas = Object.values(option.scoreDelta);
          if (!deltas.some((delta) => delta > 0) || !deltas.some((delta) => delta < 0)) {
            add(`questions.${questionIndex}.options.${optionIndex}`, "实质性选项必须包含 >0 与 <0 的正负加减分");
          }
        }
      });
    });
  }

  return { success: issues.length === 0, data, issues };
}

function parseDiagnosisContent(content) {
  const trimmedContent = content.trim();
  const fenced = trimmedContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmedContent;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const fallback = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  let value;
  try {
    value = JSON.parse(candidate);
  } catch {
    try {
      value = JSON.parse(fallback);
    } catch {
      return { ok: false, feedback: "上次输出不是合法 JSON，请只返回完整 JSON 对象。" };
    }
  }

  const parsed = validateDiagnosis(repairDiagnosis(value));
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    feedback: parsed.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("；"),
  };
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

async function callModel(messages) {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
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

  async function timedCall(messages, field) {
    const attemptStarted = performance.now();
    try {
      return await callModel(messages);
    } finally {
      result[field] = elapsed(attemptStarted);
    }
  }

  try {
    const messages = buildMessages(testCase.input, systemPrompt);
    let content = await timedCall(messages, "firstAttemptMs");
    let parsed = parseDiagnosisContent(content);
    result.firstPass = parsed.ok;
    if (!parsed.ok) {
      result.firstParseFeedback = parsed.feedback;
      result.retried = true;
      attempt = 2;
      const retryMessages = [
        ...messages,
        { role: "assistant", content },
        {
          role: "user",
          content: `上次结果未通过契约校验：${parsed.feedback}\n请修复全部问题并只返回合法 JSON，不要解释。`,
        },
      ];
      content = await timedCall(retryMessages, "retryAttemptMs");
      parsed = parseDiagnosisContent(content);
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
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function summarizeGroup(results) {
  const firstPassCount = results.filter((result) => result.firstPass).length;
  const finalValidCount = results.filter((result) => result.finalValid).length;
  const initialTop1Hits = results.filter((result) => result.initialTop1?.hit === true).length;
  const finalTop1Hits = results.filter((result) => result.finalTop1?.hit === true).length;
  return {
    totalCases: results.length,
    firstPassCount,
    finalValidCount,
    finalLegalRate: ratio(finalValidCount, results.length),
    initialTop1Hits,
    finalTop1Hits,
    initialTop1HitRate: ratio(initialTop1Hits, results.length),
    finalTop1HitRate: ratio(finalTop1Hits, results.length),
    over30SecondsCount: results.filter((result) => result.durationMs > 30_000).length,
  };
}

function printGroupSummary(label, summary) {
  console.log(`${label}：合法率 ${summary.finalValidCount}/${summary.totalCases} = ${percent(summary.finalLegalRate)}；初始 Top-1 ${summary.initialTop1Hits}/${summary.totalCases} = ${percent(summary.initialTop1HitRate)}；最终 Top-1 ${summary.finalTop1Hits}/${summary.totalCases} = ${percent(summary.finalTop1HitRate)}；超过 30 秒 ${summary.over30SecondsCount} 例`);
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
      privacy: "不保存输入、图片、expected、distractors、模型原文、上游响应或密钥。",
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
    首次通过: result.firstPass ? "是" : "否",
    最终合法: result.finalValid ? "是" : "否",
    初始Top1: result.initialTop1 ? (result.initialTop1.hit ? "命中" : "未中") : "—",
    理想Top1: result.finalTop1 ? (result.finalTop1.hit ? "命中" : "未中") : "—",
    错误: result.error?.code ?? "",
  })));
  console.log(`首次一次通过率：${overall.firstPassCount}/${results.length} = ${percent(summary.firstPassRate)}；二次重试：${retriedCount}/${results.length} 例`);
  printGroupSummary("标准 15 例", standard15);
  printGroupSummary("全部 18 例", overall);
  console.log("报告已写入 eval/report.json。");
}

main().catch((error) => {
  console.error(`评测初始化失败：${error.message}`);
  process.exitCode = 1;
});
