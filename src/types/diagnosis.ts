/**
 * 唯一数据契约 —— 前端、Server Function、内置病例 JSON 三处共用。
 * 由 B 维护；任何字段改动需 A/B/C 三人一致同意后再改。
 */
export type Domain = "AI/ML" | "Bio/Chem" | "Physics/EE" | "General";

export interface Symptom {
  id: string; // "s1"
  label: string; // "Epoch 14 起 Loss 跳变为 NaN"
  detail: string; // 一句客观描述
  severity: "critical" | "warning";
  source: "image" | "log";
  bbox?: [number, number, number, number]; // 图片病灶框，0~1 归一化 [x, y, w, h]，定位不准时省略
}

export interface Hypothesis {
  id: string; // "h1"
  title: string; // "学习率过大且缺少 Warmup"
  mechanism: string; // 一句话科学原理
  priorScore: number; // 初始权重，所有假设合计 100
  evidenceFor: string[]; // 支持该假设的 symptom id
  subCauses: string[]; // 2 条子原因
  minimalControl: {
    action: string; // 只改 1 个变量的验证操作
    paramDiff: { key: string; before: string; after: string }[];
    expectedOutcome: string;
    expectedCurve?: { x: number; before: number | null; after: number }[]; // P1：仅曲线类病例
  };
}

export interface QuestionOption {
  label: string;
  scoreDelta: Record<string, number>; // 必须覆盖所有 hypothesis id，取值范围 -40 ~ +40
}

export interface Question {
  id: string; // "q1"
  prompt: string; // 排查问题
  howToCheck: string; // 具体怎么查（命令 / 操作 / 观察点）
  options: QuestionOption[]; // 2~3 个选项 + 1 个"不确定"（scoreDelta 全为 0）
}

export interface DiagnosisResult {
  caseTitle: string;
  domain: Domain;
  confidenceNote?: string; // 信息不足时的提示
  observedSymptoms: Symptom[]; // 3~5 条
  hypotheses: Hypothesis[]; // 3~4 个
  questions: Question[]; // 2~3 道
}
