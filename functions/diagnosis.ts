import { z } from "npm:zod@3.25.76";

const nonEmptyString = z.string().trim().min(1);
const deltaSchema = z.number().finite().min(-40).max(40);

const bboxSchema = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
]).refine(([x, y, width, height]) =>
  width > 0 && height > 0 && x + width <= 1 && y + height <= 1 && width * height < 0.85
);

const symptomSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  detail: nonEmptyString,
  severity: z.enum(["critical", "warning"]),
  source: z.enum(["image", "log"]),
  bbox: bboxSchema.optional(),
});

const hypothesisSchema = z.object({
  id: nonEmptyString,
  title: nonEmptyString,
  mechanism: nonEmptyString,
  priorScore: z.number().finite().min(0).max(100),
  evidenceFor: z.array(nonEmptyString),
  subCauses: z.array(nonEmptyString).length(2),
  minimalControl: z.object({
    action: nonEmptyString,
    paramDiff: z.array(z.object({
      key: nonEmptyString,
      before: z.string(),
      after: z.string(),
    })),
    expectedOutcome: nonEmptyString,
    expectedCurve: z.array(z.object({
      x: z.number().finite(),
      before: z.number().finite().nullable(),
      after: z.number().finite(),
    })).optional(),
  }),
});

const questionSchema = z.object({
  id: nonEmptyString,
  prompt: nonEmptyString,
  howToCheck: nonEmptyString,
  options: z.array(z.object({
    label: nonEmptyString,
    scoreDelta: z.record(deltaSchema),
  })).min(3).max(4),
});

const diagnosisSchema = z.object({
  caseTitle: nonEmptyString,
  domain: z.enum(["AI/ML", "Bio/Chem", "Physics/EE", "General"]),
  confidenceNote: nonEmptyString.optional(),
  observedSymptoms: z.array(symptomSchema).min(3).max(5),
  hypotheses: z.array(hypothesisSchema).min(3).max(4),
  questions: z.array(questionSchema).min(2).max(3),
}).superRefine((result, context) => {
  const symptomIds = new Set(result.observedSymptoms.map((symptom) => symptom.id));
  const hypothesisIds = result.hypotheses.map((hypothesis) => hypothesis.id);
  const sortedHypothesisIds = [...hypothesisIds].sort();

  const priorTotal = result.hypotheses.reduce((total, hypothesis) => total + hypothesis.priorScore, 0);
  if (Math.abs(priorTotal - 100) > 0.0001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["hypotheses"], message: "priorScore 合计必须为 100" });
  }

  result.hypotheses.forEach((hypothesis, hypothesisIndex) => {
    hypothesis.evidenceFor.forEach((symptomId, evidenceIndex) => {
      if (!symptomIds.has(symptomId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hypotheses", hypothesisIndex, "evidenceFor", evidenceIndex],
          message: "evidenceFor 引用了不存在的 symptom id",
        });
      }
    });
  });

  result.questions.forEach((question, questionIndex) => {
    question.options.forEach((option, optionIndex) => {
      const scoreIds = Object.keys(option.scoreDelta).sort();
      const isLast = optionIndex === question.options.length - 1;
      if (scoreIds.length !== sortedHypothesisIds.length || scoreIds.some((id, index) => id !== sortedHypothesisIds[index])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", questionIndex, "options", optionIndex, "scoreDelta"],
          message: "scoreDelta 必须精确覆盖全部 hypothesis id",
        });
      }
      if (isLast) {
        if (option.label !== "不确定" || Object.values(option.scoreDelta).some((delta) => delta !== 0)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["questions", questionIndex, "options", optionIndex],
            message: "末选项必须为全 0 的「不确定」",
          });
        }
      } else {
        const deltas = Object.values(option.scoreDelta);
        if (!deltas.some((delta) => delta > 0) || !deltas.some((delta) => delta < 0)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["questions", questionIndex, "options", optionIndex, "scoreDelta"],
            message: "实质性选项必须包含 >0 与 <0 的正负加减分",
          });
        }
      }
    });
  });
});

export type FunctionDiagnosisResult = z.infer<typeof diagnosisSchema>;

type ParseResult =
  | { ok: true; data: FunctionDiagnosisResult }
  | { ok: false; feedback: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampDelta(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(-40, Math.min(40, value)) : 0;
}

function normalizePriorScores(hypotheses: unknown[]): unknown[] {
  if (hypotheses.length === 0) return hypotheses;

  const weights = hypotheses.map((hypothesis) => {
    if (!isRecord(hypothesis)) return 0;
    const score = hypothesis.priorScore;
    return typeof score === "number" && Number.isFinite(score) && score > 0 ? score : 0;
  });
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);
  const normalized = weights.map((weight) => weightTotal > 0 ? weight / weightTotal * 100 : 100 / hypotheses.length);
  const scores = normalized.map(Math.floor);
  let remainder = 100 - scores.reduce((total, score) => total + score, 0);
  const byFraction = normalized
    .map((score, index) => ({ index, fraction: score - Math.floor(score) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (let index = 0; remainder > 0; index = (index + 1) % byFraction.length) {
    scores[byFraction[index].index] += 1;
    remainder -= 1;
  }

  return hypotheses.map((hypothesis, index) =>
    isRecord(hypothesis) ? { ...hypothesis, priorScore: scores[index] } : hypothesis
  );
}

export function repairDiagnosis(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const observedSymptoms = Array.isArray(value.observedSymptoms)
    ? value.observedSymptoms.slice(0, 5).map((symptom) => {
        if (!isRecord(symptom)) return symptom;
        const repaired = { ...symptom };
        const bbox = symptom.bbox;
        const validBbox = Array.isArray(bbox) && bbox.length === 4 && bbox.every((part) =>
          typeof part === "number" && Number.isFinite(part) && part >= 0 && part <= 1
        ) && bbox[0] + bbox[2] <= 1 && bbox[1] + bbox[3] <= 1 && bbox[2] > 0 && bbox[3] > 0 && bbox[2] * bbox[3] < 0.85;
        if (validBbox) repaired.bbox = [...bbox];
        else delete repaired.bbox;
        return repaired;
      })
    : value.observedSymptoms;

  const symptomIds = new Set(
    Array.isArray(observedSymptoms)
      ? observedSymptoms.flatMap((symptom) => isRecord(symptom) && typeof symptom.id === "string" ? [symptom.id] : [])
      : [],
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
            ? [...new Set(hypothesis.evidenceFor.filter((id): id is string => typeof id === "string" && symptomIds.has(id)))]
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
          const scoreDelta = option.scoreDelta as Record<string, number>;
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

export function parseDiagnosisContent(content: string): ParseResult {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const fallback = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    try {
      value = JSON.parse(fallback);
    } catch {
      return { ok: false, feedback: "上次输出不是合法 JSON，请只返回完整 JSON 对象。" };
    }
  }

  const parsed = diagnosisSchema.safeParse(repairDiagnosis(value));
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    feedback: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；"),
  };
}
