import type { DiagnosisResult, Domain, Hypothesis, Question, QuestionOption, Symptom } from "../types/diagnosis";

const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024;
const MAX_LOG_LENGTH = 15_000;
const MAX_IMAGE_EDGE = 1600;
const DOMAINS: Domain[] = ["AI/ML", "Bio/Chem", "Physics/EE", "General"];

export type DiagnoseExperimentInput = {
  imageFile?: File;
  logText?: string;
  domainHint?: Domain;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSymptom(value: unknown): value is Symptom {
  if (!isRecord(value)) return false;
  const bbox = value.bbox;
  const validBbox = bbox === undefined || (
    Array.isArray(bbox) && bbox.length === 4 && bbox.every((part) => isFiniteNumber(part) && part >= 0 && part <= 1) &&
    bbox[0] + bbox[2] <= 1 && bbox[1] + bbox[3] <= 1 && bbox[2] > 0 && bbox[3] > 0 && bbox[2] * bbox[3] < 0.85
  );
  return isNonEmptyString(value.id) && isNonEmptyString(value.label) && isNonEmptyString(value.detail) &&
    (value.severity === "critical" || value.severity === "warning") &&
    (value.source === "image" || value.source === "log") && validBbox;
}

function isHypothesis(value: unknown): value is Hypothesis {
  if (!isRecord(value) || !isRecord(value.minimalControl)) return false;
  const control = value.minimalControl;
  const expectedCurve = control.expectedCurve;
  return isNonEmptyString(value.id) && isNonEmptyString(value.title) && isNonEmptyString(value.mechanism) &&
    isFiniteNumber(value.priorScore) && value.priorScore >= 0 && value.priorScore <= 100 &&
    Array.isArray(value.evidenceFor) && value.evidenceFor.every(isNonEmptyString) &&
    Array.isArray(value.subCauses) && value.subCauses.length === 2 && value.subCauses.every(isNonEmptyString) &&
    isNonEmptyString(control.action) && Array.isArray(control.paramDiff) && control.paramDiff.every((part) =>
      isRecord(part) && isNonEmptyString(part.key) && typeof part.before === "string" && typeof part.after === "string"
    ) && isNonEmptyString(control.expectedOutcome) &&
    (expectedCurve === undefined || (Array.isArray(expectedCurve) && expectedCurve.every((point) =>
      isRecord(point) && isFiniteNumber(point.x) &&
      (point.before === null || isFiniteNumber(point.before)) && isFiniteNumber(point.after)
    )));
}

function isQuestionOption(value: unknown, hypothesisIds: string[]): value is QuestionOption {
  if (!isRecord(value) || !isNonEmptyString(value.label) || !isRecord(value.scoreDelta)) return false;
  const scores = value.scoreDelta;
  const scoreIds = Object.keys(scores);
  return scoreIds.length === hypothesisIds.length && hypothesisIds.every((id) => {
    const delta = scores[id];
    return isFiniteNumber(delta) && delta >= -40 && delta <= 40;
  });
}

function isQuestion(value: unknown, hypothesisIds: string[]): value is Question {
  if (!isRecord(value) || !Array.isArray(value.options) || value.options.length < 3 || value.options.length > 4) return false;
  const options = value.options;
  if (!options.every((option) => isQuestionOption(option, hypothesisIds))) return false;

  const uncertain = options[options.length - 1];
  if (!isRecord(uncertain) || uncertain.label !== "不确定" || !isRecord(uncertain.scoreDelta) ||
    Object.values(uncertain.scoreDelta).some((delta) => delta !== 0)) return false;

  return isNonEmptyString(value.id) && isNonEmptyString(value.prompt) && isNonEmptyString(value.howToCheck) &&
    options.slice(0, -1).every((option) => {
      const deltas = Object.values((option as QuestionOption).scoreDelta);
      return deltas.some((delta) => delta !== 0);
    });
}

function isDiagnosisResult(value: unknown): value is DiagnosisResult {
  if (!isRecord(value) || !isNonEmptyString(value.caseTitle) || !DOMAINS.includes(value.domain as Domain)) return false;
  if (value.confidenceNote !== undefined && !isNonEmptyString(value.confidenceNote)) return false;
  if (!Array.isArray(value.observedSymptoms) || value.observedSymptoms.length < 3 || value.observedSymptoms.length > 5 ||
    !value.observedSymptoms.every(isSymptom)) return false;
  if (!Array.isArray(value.hypotheses) || value.hypotheses.length < 3 || value.hypotheses.length > 4 ||
    !value.hypotheses.every(isHypothesis)) return false;

  const symptomIds = new Set(value.observedSymptoms.map((symptom) => symptom.id));
  const hypothesisIds = value.hypotheses.map((hypothesis) => hypothesis.id);
  if (symptomIds.size !== value.observedSymptoms.length || new Set(hypothesisIds).size !== hypothesisIds.length) return false;
  if (Math.abs(value.hypotheses.reduce((total, hypothesis) => total + hypothesis.priorScore, 0) - 100) > 0.0001) return false;
  if (!value.hypotheses.every((hypothesis) => hypothesis.evidenceFor.every((id) => symptomIds.has(id)))) return false;

  return Array.isArray(value.questions) && value.questions.length >= 2 && value.questions.length <= 3 &&
    value.questions.every((question) => isQuestion(question, hypothesisIds));
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片压缩失败，请换一张图片重试。"));
    }, "image/jpeg", 0.85);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片编码失败，请重试。"));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("图片编码失败，请重试。"));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size === 0) throw new Error("请选择有效的图片文件。");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取这张图片，请换用 PNG、JPG 或 WebP 图片。");
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法压缩图片，请换用新版浏览器。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const base64 = await blobToBase64(await canvasToBlob(canvas));
    if (base64.length > MAX_IMAGE_BASE64_LENGTH) throw new Error("图片压缩后仍超过 4MB，请换用更简单的图片。");
    return base64;
  } finally {
    bitmap.close();
  }
}

function requestErrorMessage(status: number, payload: unknown): string {
  const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : "";
  if (status === 429) return "诊断请求过于频繁，请一分钟后再试。";
  if (status === 503 && code === "service_not_configured") return "诊断服务尚未完成模型配置，请联系管理员。";
  if (status === 502 && code === "diagnosis_parse_failed") return "模型两次返回的结果均未通过校验，请稍后重试。";
  if (status === 502) return "诊断模型暂时不可用，请稍后重试。";
  if (status === 413) return "图片或日志超过大小限制，请精简后重试。";
  if (status === 400) return "请提供有效图片或不超过 15000 字的实验日志。";
  if (status === 401 || status === 403) return "当前账号无权使用诊断服务。";
  return "诊断请求失败，请稍后重试。";
}

export async function diagnoseExperiment({ imageFile, logText, domainHint }: DiagnoseExperimentInput): Promise<DiagnosisResult> {
  if (!imageFile && !logText?.trim()) throw new Error("请至少提供实验截图或实验日志。");
  if (logText && logText.length > MAX_LOG_LENGTH) throw new Error("实验日志不能超过 15000 字。");

  const imageBase64 = imageFile ? await compressImage(imageFile) : undefined;
  const endpoint = import.meta.env.DEV ? "/api/diagnose" : "/functions/v1/app/api/diagnose";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64, logText, domainHint }),
    });
  } catch {
    throw new Error("无法连接诊断服务，请检查网络后重试。");
  }

  let payload: unknown = null;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (!response.ok) throw new Error(requestErrorMessage(response.status, payload));
  if (!isDiagnosisResult(payload)) throw new Error("诊断服务返回了无效结果，请稍后重试。");
  return payload;
}
