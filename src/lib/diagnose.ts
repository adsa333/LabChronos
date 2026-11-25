// 默认使用真实接口；仅显式设置 VITE_DIAGNOSE_MODE=mock 用于本地演示。
import { presets } from '../data/presets'
import type { DiagnosisResult, Domain } from '../types/diagnosis'
import { diagnoseExperiment } from './api'

export interface DiagnoseInput {
  imageFile?: File
  logText?: string
  domainHint?: Domain
}

const LIVE = import.meta.env.VITE_DIAGNOSE_MODE !== 'mock'
const MOCK_DELAY = 4200

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('诊断已取消', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('诊断已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runDiagnose(input: DiagnoseInput, signal?: AbortSignal): Promise<DiagnosisResult> {
  if (LIVE) return diagnoseExperiment(input)

  const presetId = input.domainHint === 'Bio/Chem'
    ? 'gel-electrophoresis-smearing'
    : input.domainHint === 'Physics/EE'
      ? 'oscilloscope-ringing'
      : 'ai-training-nan'
  const preset = presets.find((item) => item.id === presetId) ?? presets[0]
  const diagnosis = JSON.parse(JSON.stringify(preset.diagnosis)) as DiagnosisResult
  diagnosis.caseTitle = `自定义诊断 · ${input.imageFile?.name ?? '实验日志'}`
  diagnosis.observedSymptoms.forEach((symptom) => {
    delete symptom.bbox
  })
  diagnosis.confidenceNote = '演示结果：当前为内置病例推演，接入真实模型后将依据你的截图重新分析。'

  await wait(MOCK_DELAY, signal)
  if (!navigator.onLine) throw new Error('无法连接诊断服务，请检查网络后重试。')
  return diagnosis
}
