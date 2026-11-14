import type { DiagnosisResult } from '../../types/diagnosis'
import aiDiagnosisJson from './ai-training-nan.json?raw'
import gelDiagnosisJson from './gel-electrophoresis-smearing.json?raw'
import scopeDiagnosisJson from './oscilloscope-ringing.json?raw'
import aiImage from './assets/ai-training-nan.png'
import gelImage from './assets/gel-electrophoresis-smearing.png'
import scopeImage from './assets/oscilloscope-ringing.png'
import aiLog from './assets/ai-training-nan.log?raw'
import gelLog from './assets/gel-electrophoresis-smearing.log?raw'
import scopeLog from './assets/oscilloscope-ringing.log?raw'
import aiConditions from './assets/ai-training-nan-conditions.csv?raw'
import gelConditions from './assets/gel-electrophoresis-smearing-conditions.csv?raw'
import scopeConditions from './assets/oscilloscope-ringing-conditions.csv?raw'

export interface PresetCase {
  id: string
  label: string
  diagnosis: DiagnosisResult
  image: string
  log: string
  conditions: string
}

export const presets: PresetCase[] = [
  {
    id: 'ai-training-nan',
    label: 'AI 训练崩盘',
    diagnosis: JSON.parse(aiDiagnosisJson) as DiagnosisResult,
    image: aiImage,
    log: aiLog,
    conditions: aiConditions,
  },
  {
    id: 'gel-electrophoresis-smearing',
    label: '凝胶电泳拖尾',
    diagnosis: JSON.parse(gelDiagnosisJson) as DiagnosisResult,
    image: gelImage,
    log: gelLog,
    conditions: gelConditions,
  },
  {
    id: 'oscilloscope-ringing',
    label: '示波器波形振铃',
    diagnosis: JSON.parse(scopeDiagnosisJson) as DiagnosisResult,
    image: scopeImage,
    log: scopeLog,
    conditions: scopeConditions,
  },
]
