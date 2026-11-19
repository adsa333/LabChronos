const DOMAINS = new Set(["AI/ML", "Bio/Chem", "Physics/EE", "General"]);

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

function recordRepair(repairsApplied, name) {
  if (!repairsApplied.includes(name)) repairsApplied.push(name);
}

export function trimDiagnosisStrings(value) {
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

function normalizePriorScores(hypotheses) {
  if (hypotheses.length === 0) return hypotheses;
  const weights = hypotheses.map((hypothesis) => {
    if (!isRecord(hypothesis)) return 0;
    const score = hypothesis.priorScore;
    return isFiniteNumber(score) && score > 0 ? score : 0;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const normalized = weights.map((weight) => weightTotal > 0 ? weight / weightTotal * 100 : 100 / hypotheses.length);
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

export function repairDiagnosis(value, repairsApplied = []) {
  if (!isRecord(value)) return value;
  const trimmedValue = trimDiagnosisStrings(value);
  if (JSON.stringify(trimmedValue) !== JSON.stringify(value)) recordRepair(repairsApplied, "strings_trimmed");
  value = trimmedValue;

  if (Array.isArray(value.observedSymptoms) && value.observedSymptoms.length > 5) {
    recordRepair(repairsApplied, "observedSymptoms_truncated");
  }
  const observedSymptoms = Array.isArray(value.observedSymptoms)
    ? value.observedSymptoms.slice(0, 5).map((symptom) => {
        if (!isRecord(symptom)) return symptom;
        const repaired = { ...symptom };
        const bbox = symptom.bbox;
        const validBbox = Array.isArray(bbox) && bbox.length === 4 && bbox.every((part) =>
          isFiniteNumber(part) && part >= 0 && part <= 1
        ) && bbox[0] + bbox[2] <= 1 && bbox[1] + bbox[3] <= 1 && bbox[2] > 0 && bbox[3] > 0 && bbox[2] * bbox[3] < 0.85;
        if (validBbox) repaired.bbox = [...bbox];
        else if (bbox !== undefined) {
          delete repaired.bbox;
          recordRepair(repairsApplied, "bbox_removed");
        }
        return repaired;
      })
    : value.observedSymptoms;

  const symptomIds = new Set(
    Array.isArray(observedSymptoms) ? observedSymptoms.flatMap((symptom) => isRecord(symptom) && typeof symptom.id === "string" ? [symptom.id] : []) : [],
  );

  if (Array.isArray(value.hypotheses) && value.hypotheses.length > 4) {
    recordRepair(repairsApplied, "hypotheses_truncated");
  }
  let hypotheses = Array.isArray(value.hypotheses)
    ? value.hypotheses.slice(0, 4).map((hypothesis) => {
        if (!isRecord(hypothesis)) return hypothesis;
        let subCauses = Array.isArray(hypothesis.subCauses) ? hypothesis.subCauses : [];
        if (!Array.isArray(hypothesis.subCauses) || subCauses.length !== 2) {
          recordRepair(repairsApplied, "subCauses_normalized");
        }
        if (subCauses.length > 2) subCauses = subCauses.slice(0, 2);
        else if (subCauses.length === 1) subCauses = [subCauses[0], "待结合对照实验进一步确认"];
        else if (subCauses.length === 0) subCauses = ["待结合现有证据进一步确认", "待结合对照实验进一步确认"];
        const evidenceFor = Array.isArray(hypothesis.evidenceFor)
          ? [...new Set(hypothesis.evidenceFor.filter((id) => typeof id === "string" && symptomIds.has(id)))]
          : hypothesis.evidenceFor;
        if (JSON.stringify(evidenceFor) !== JSON.stringify(hypothesis.evidenceFor)) {
          recordRepair(repairsApplied, "evidenceFor_filtered");
        }
        const minimalControl = isRecord(hypothesis.minimalControl) && Array.isArray(hypothesis.minimalControl.paramDiff) ? {
          ...hypothesis.minimalControl,
          paramDiff: hypothesis.minimalControl.paramDiff.map((part) => {
            if (!isRecord(part)) return part;
            const normalized = { ...part };
            let modified = false;
            for (const key of ["before", "after"]) {
              const value = part[key];
              if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") {
                normalized[key] = String(value);
                modified = true;
              }
            }
            if (modified) recordRepair(repairsApplied, "paramDiff_stringified");
            return normalized;
          }),
        } : hypothesis.minimalControl;
        return { ...hypothesis, subCauses, evidenceFor, minimalControl };
      })
    : value.hypotheses;
  if (Array.isArray(hypotheses)) {
    const normalized = normalizePriorScores(hypotheses);
    if (normalized.some((hypothesis, index) => isRecord(hypothesis) && isRecord(hypotheses[index]) && hypothesis.priorScore !== hypotheses[index].priorScore)) {
      recordRepair(repairsApplied, "priorScore_normalized");
    }
    hypotheses = normalized;
  }

  const hypothesisIds = Array.isArray(hypotheses)
    ? hypotheses.flatMap((hypothesis) => isRecord(hypothesis) && typeof hypothesis.id === "string" ? [hypothesis.id] : [])
    : [];

  if (Array.isArray(value.questions) && value.questions.length > 3) {
    recordRepair(repairsApplied, "questions_truncated");
  }
  const questions = Array.isArray(value.questions)
    ? value.questions.slice(0, 3).map((question) => {
        if (!isRecord(question) || !Array.isArray(question.options)) return question;
        const zeroScores = () => Object.fromEntries(hypothesisIds.map((id) => [id, 0]));
        const options = question.options.map((option) => {
          if (!isRecord(option)) return option;
          const originalScores = isRecord(option.scoreDelta) ? option.scoreDelta : {};
          const scoreDelta = Object.fromEntries(hypothesisIds.map((id) => {
            const hasKey = Object.prototype.hasOwnProperty.call(originalScores, id);
            if (!hasKey) recordRepair(repairsApplied, "scoreDelta_keys_completed");
            const original = originalScores[id];
            const clamped = clampDelta(original);
            if (hasKey && original !== clamped) recordRepair(repairsApplied, "scoreDelta_clamped");
            return [id, clamped];
          }));
          return { ...option, scoreDelta };
        });
        if (options.length > 0) {
          const lastIndex = options.length - 1;
          const lastOption = options[lastIndex];
          const needsUncertainRepair = !isRecord(lastOption) || lastOption.label !== "不确定" ||
            !isRecord(lastOption.scoreDelta) || Object.values(lastOption.scoreDelta).some((delta) => delta !== 0);
          if (isRecord(lastOption) && lastOption.label === "不确定") {
            if (!isRecord(lastOption.scoreDelta) || Object.values(lastOption.scoreDelta).some((delta) => delta !== 0)) {
              options[lastIndex] = { ...lastOption, scoreDelta: zeroScores() };
              recordRepair(repairsApplied, "uncertain_option_normalized");
            }
          } else if (options.length < 4) {
            options.push({ label: "不确定", scoreDelta: zeroScores() });
            if (needsUncertainRepair) recordRepair(repairsApplied, "uncertain_option_normalized");
          } else {
            options[lastIndex] = { label: "不确定", scoreDelta: zeroScores() };
            recordRepair(repairsApplied, "uncertain_option_normalized");
          }
        }
        return { ...question, options };
      })
    : value.questions;

  return { ...value, observedSymptoms, hypotheses, questions };
}

export function validateDiagnosis(value) {
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
        } else if (!Object.values(option.scoreDelta).some((delta) => delta !== 0)) {
          add(`questions.${questionIndex}.options.${optionIndex}.scoreDelta`, "实质性选项 scoreDelta 不能全为 0");
        }
      });
    });
  }

  return { success: issues.length === 0, data, issues };
}

export function hasPositiveAndNegativeDelta(diagnosis) {
  if (!isRecord(diagnosis) || !Array.isArray(diagnosis.questions) || diagnosis.questions.length === 0) return false;
  return diagnosis.questions.every((question) => {
    if (!isRecord(question) || !Array.isArray(question.options) || question.options.length < 2) return false;
    return question.options.slice(0, -1).every((option) => {
      if (!isRecord(option) || !isRecord(option.scoreDelta)) return false;
      const deltas = Object.values(option.scoreDelta);
      return deltas.some((delta) => isFiniteNumber(delta) && delta > 0) && deltas.some((delta) => isFiniteNumber(delta) && delta < 0);
    });
  });
}

export function extractJsonValue(content) {
  const trimmedContent = content.trim();
  const fenced = trimmedContent.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmedContent;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const fallback = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(fallback) };
    } catch {
      return { ok: false };
    }
  }
}

export function parseDiagnosisContent(content, repairsApplied = []) {
  const extracted = extractJsonValue(content);
  if (!extracted.ok) {
    return { ok: false, feedback: "上次输出不是合法 JSON，请只返回完整 JSON 对象。" };
  }
  const parsed = validateDiagnosis(repairDiagnosis(extracted.value, repairsApplied));
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    feedback: parsed.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("；"),
  };
}
