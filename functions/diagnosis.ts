import {
  parseDiagnosisContent as parseCoreDiagnosisContent,
  repairDiagnosis,
  trimDiagnosisStrings,
  validateDiagnosis,
} from "./diagnosis-core.mjs";
import type { DiagnosisResult } from "../src/types/diagnosis.ts";

export { repairDiagnosis, trimDiagnosisStrings, validateDiagnosis };
export type FunctionDiagnosisResult = DiagnosisResult;

type ParseResult =
  | { ok: true; data: FunctionDiagnosisResult }
  | { ok: false; feedback: string };

export function parseDiagnosisContent(content: string): ParseResult {
  return parseCoreDiagnosisContent(content) as ParseResult;
}
