import type { DiagnosisResult } from '../types/diagnosis'

export type Answers = Record<string, number>

export interface HypothesisScore {
  id: string
  weight: number
  probability: number
}

export function scoreHypotheses(diagnosis: DiagnosisResult, answers: Answers): HypothesisScore[] {
  const weights = diagnosis.hypotheses.map((hypothesis) => {
    const delta = diagnosis.questions.reduce((total, question) => {
      const optionIndex = answers[question.id]
      if (optionIndex === undefined) return total
      return total + (question.options[optionIndex]?.scoreDelta[hypothesis.id] ?? 0)
    }, 0)
    return { id: hypothesis.id, weight: Math.max(5, hypothesis.priorScore + delta) }
  })
  const total = weights.reduce((sum, item) => sum + item.weight, 0)
  return weights.map((item) => ({
    ...item,
    probability: item.weight / total,
  }))
}

export function getLeadingHypothesis(scores: HypothesisScore[]): HypothesisScore {
  return scores.reduce((leading, item) => item.probability > leading.probability ? item : leading, scores[0])
}

export function getPrunedIds(scores: HypothesisScore[], answeredCount: number): string[] {
  if (answeredCount === 0) return []
  return scores.filter((item) => item.probability < 0.15).map((item) => item.id)
}

export function getAutomaticLockId(diagnosis: DiagnosisResult, answers: Answers, scores: HypothesisScore[]): string | null {
  const answeredCount = Object.keys(answers).length
  if (answeredCount === 0) return null
  const leading = getLeadingHypothesis(scores)
  const allAnswered = diagnosis.questions.every((question) => answers[question.id] !== undefined)
  return leading.probability >= 0.6 || allAnswered ? leading.id : null
}

