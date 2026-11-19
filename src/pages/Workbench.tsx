import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, FlaskConical, Plus, X } from 'lucide-react'
import CausalTree from '../components/CausalTree'
import DiagnoseDialog from '../components/DiagnoseDialog'
import EvidencePanel from '../components/EvidencePanel'
import PanelHeader from '../components/PanelHeader'
import RecapCardPreview from '../components/RecapCardPreview'
import TriagePanel from '../components/TriagePanel'
import VaultMuseum from '../components/VaultMuseum'
import { presets } from '../data/presets'
import type { PresetCase } from '../data/presets'
import { deleteCustomCase, loadCustomCase, saveCustomCase } from '../lib/caseStorage'
import { downloadRecapCard, renderRecapCard } from '../lib/recapCard'
import { getAutomaticLockId, getLeadingHypothesis, getPrunedIds, scoreHypotheses } from '../lib/scoring'
import type { Answers } from '../lib/scoring'
import { deleteVaultEntry, listVaultEntries, saveVaultEntry } from '../lib/vaultStorage'
import type { VaultEntry } from '../lib/vaultStorage'
import type { DiagnosisResult } from '../types/diagnosis'

export default function Workbench() {
  const [activeCaseId, setActiveCaseId] = useState(presets[0].id)
  const [answers, setAnswers] = useState<Answers>({})
  const [manualLockId, setManualLockId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [customCase, setCustomCase] = useState<PresetCase | null>(null)
  const [museumOpen, setMuseumOpen] = useState(false)
  const [recapUrl, setRecapUrl] = useState<string | null>(null)
  const [recapBusy, setRecapBusy] = useState(false)
  const [recapSaved, setRecapSaved] = useState(false)
  const [vaultNote, setVaultNote] = useState<string | null>(null)
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([])
  const [customCaseLoad] = useState(loadCustomCase)
  const recapUrlRef = useRef<string | null>(null)
  const recapBlobRef = useRef<Blob | null>(null)
  const recapExportedAtRef = useRef(0)
  const recapRequestRef = useRef(0)
  const customCreatedAtRef = useRef(0)
  const customHasImageRef = useRef(false)
  const customCaseTouchedRef = useRef(false)
  const answersSaveTimerRef = useRef<number | undefined>(undefined)
  const activeCase = customCase?.id === activeCaseId ? customCase : presets.find((preset) => preset.id === activeCaseId) ?? presets[0]
  const { diagnosis } = activeCase
  const scores = useMemo(() => scoreHypotheses(diagnosis, answers), [diagnosis, answers])
  const prunedIds = useMemo(() => getPrunedIds(scores, Object.keys(answers).length), [scores, answers])
  const automaticLockId = useMemo(() => getAutomaticLockId(diagnosis, answers, scores), [diagnosis, answers, scores])
  const lockedId = manualLockId ?? automaticLockId

  useEffect(() => {
    return () => {
      if (customCase?.image.startsWith('blob:')) URL.revokeObjectURL(customCase.image)
    }
  }, [customCase])

  useEffect(() => {
    let active = true
    void customCaseLoad.then((stored) => {
      if (!active || !stored || customCaseTouchedRef.current) return
      const { caseData, imageBlob } = stored
      customCreatedAtRef.current = caseData.createdAt
      customHasImageRef.current = caseData.hasImage
      setCustomCase({
        id: caseData.id,
        label: '自定义诊断',
        diagnosis: caseData.diagnosis,
        image: imageBlob ? URL.createObjectURL(imageBlob) : '',
        log: caseData.log,
        conditions: caseData.conditions,
      })
      setActiveCaseId(caseData.id)
      setAnswers(caseData.answers)
      setManualLockId(null)
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [customCaseLoad])

  useEffect(() => {
    return () => {
      window.clearTimeout(answersSaveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    void listVaultEntries().then(setVaultEntries)
  }, [])

  useEffect(() => {
    return () => {
      if (recapUrlRef.current) URL.revokeObjectURL(recapUrlRef.current)
    }
  }, [])

  function scheduleAnswersSave(nextAnswers: Answers) {
    if (!customCase) return
    window.clearTimeout(answersSaveTimerRef.current)
    answersSaveTimerRef.current = window.setTimeout(() => {
      void saveCustomCase({
        id: customCase.id,
        diagnosis: customCase.diagnosis,
        log: customCase.log,
        conditions: customCase.conditions,
        answers: nextAnswers,
        createdAt: customCreatedAtRef.current,
        hasImage: customHasImageRef.current,
      })
    }, 300)
  }

  function selectCase(caseId: string) {
    setActiveCaseId(caseId)
    setAnswers({})
    setManualLockId(null)
    setRecapSaved(false)
    setVaultNote(null)
  }

  function answerQuestion(questionId: string, optionIndex: number) {
    const nextAnswers = { ...answers, [questionId]: optionIndex }
    setAnswers(nextAnswers)
    if (customCase) scheduleAnswersSave(nextAnswers)
    setManualLockId(null)
    setRecapSaved(false)
  }

  function resetAnswers() {
    setAnswers({})
    if (customCase) scheduleAnswersSave({})
    setManualLockId(null)
    setRecapSaved(false)
  }

  function handleDiagnoseSuccess(diagnosis: DiagnosisResult, imageFile?: File, logText?: string) {
    window.clearTimeout(answersSaveTimerRef.current)
    customCaseTouchedRef.current = true
    const createdAt = Date.now()
    const id = `custom-${createdAt}`
    const hasImage = Boolean(imageFile)
    const log = logText ?? ''
    const image = imageFile ? URL.createObjectURL(imageFile) : ''
    customCreatedAtRef.current = createdAt
    customHasImageRef.current = hasImage
    void saveCustomCase({ id, diagnosis, log, conditions: '', answers: {}, createdAt, hasImage }, imageFile)
    setCustomCase({ id, label: '自定义诊断', diagnosis, image, log, conditions: '' })
    setActiveCaseId(id)
    setAnswers({})
    setManualLockId(null)
    setRecapSaved(false)
    setDialogOpen(false)
  }

  function removeCustomCase() {
    customCaseTouchedRef.current = true
    if (customCase) {
      window.clearTimeout(answersSaveTimerRef.current)
      void deleteCustomCase(customCase.id)
      if (customCase.image.startsWith('blob:')) URL.revokeObjectURL(customCase.image)
    }
    setCustomCase(null)
    selectCase(presets[0].id)
  }

  async function getActiveImageBlob(): Promise<Blob | null> {
    if (!activeCase.image) return null
    try {
      const response = await fetch(activeCase.image)
      return response.ok ? await response.blob() : null
    } catch {
      return null
    }
  }

  async function buildRecap() {
    if (!lockedId || recapBusy) return
    const request = ++recapRequestRef.current
    setRecapBusy(true)
    setRecapSaved(false)
    try {
      const image = await getActiveImageBlob()
      const exportedAt = Date.now()
      const blob = await renderRecapCard({ diagnosis, scores, lockedId, answers, image, exportedAt })
      if (recapRequestRef.current !== request) return
      if (recapUrlRef.current) URL.revokeObjectURL(recapUrlRef.current)
      const url = URL.createObjectURL(blob)
      recapUrlRef.current = url
      recapBlobRef.current = blob
      recapExportedAtRef.current = exportedAt
      setRecapUrl(url)
    } catch {} finally {
      if (recapRequestRef.current === request) setRecapBusy(false)
    }
  }

  function closeRecap() {
    recapRequestRef.current += 1
    if (recapUrlRef.current) {
      URL.revokeObjectURL(recapUrlRef.current)
      recapUrlRef.current = null
    }
    recapBlobRef.current = null
    setRecapUrl(null)
    setRecapBusy(false)
    setRecapSaved(false)
  }

  function downloadRecap() {
    if (recapBlobRef.current) downloadRecapCard(recapBlobRef.current, recapExportedAtRef.current)
  }

  async function saveToVault() {
    if (!lockedId) return
    const hypothesis = diagnosis.hypotheses.find((item) => item.id === lockedId)
    const score = scores.find((item) => item.id === lockedId)
    const image = await getActiveImageBlob()
    const createdAt = Date.now()
    const result = await saveVaultEntry({
      id: `vault-${createdAt}`,
      createdAt,
      title: diagnosis.caseTitle,
      domain: diagnosis.domain,
      truthTitle: hypothesis?.title ?? '',
      probability: score?.probability ?? 0,
      symptomSummary: diagnosis.observedSymptoms.find((item) => item.severity === 'critical')?.label ?? '',
      log: activeCase.log,
      answers,
      diagnosis,
      image,
      thumb: null,
    })
    if (result.ok) {
      setVaultNote(null)
      setRecapSaved(true)
      setVaultEntries(await listVaultEntries())
    } else {
      setVaultNote(result.code === 'QUOTA' ? '本机存储空间不足，未能存证' : '本机存储不可用，未能存证')
    }
  }

  async function openMuseum() {
    setMuseumOpen(true)
    setVaultEntries(await listVaultEntries())
  }

  function closeMuseum() {
    setMuseumOpen(false)
  }

  function startDiagnosisFromMuseum() {
    setMuseumOpen(false)
    setDialogOpen(true)
  }

  async function handleDeleteVault(id: string) {
    await deleteVaultEntry(id)
    setVaultEntries(await listVaultEntries())
  }

  function restoreVault(entry: VaultEntry) {
    customCaseTouchedRef.current = true
    customCreatedAtRef.current = entry.createdAt
    customHasImageRef.current = Boolean(entry.image)
    setCustomCase({
      id: entry.id,
      label: '自定义诊断',
      diagnosis: entry.diagnosis,
      image: entry.image ? URL.createObjectURL(entry.image) : '',
      log: entry.log,
      conditions: '',
    })
    setActiveCaseId(entry.id)
    setAnswers(entry.answers)
    setManualLockId(null)
    setRecapSaved(false)
    setVaultNote(null)
    setMuseumOpen(false)
  }

  return (
    <div className="h-screen min-w-[1180px] overflow-hidden bg-bg text-ink">
      <header className="grid h-14 grid-cols-[300px_minmax(0,1fr)_380px] items-center gap-3 border-b border-line px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-truth/40 bg-truth/10 text-truth">
            <FlaskConical size={18} strokeWidth={1.8} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-tight text-ink">LabChronos</span>
              <span className="rounded border border-truth/40 bg-truth/10 px-1.5 py-px font-mono text-[10px] text-truth">M2</span>
            </div>
            <p className="mt-0.5 text-[10px] tracking-wide text-ink-muted">实验失败取证 <span className="text-pruned">·</span> Failure Forensics</p>
          </div>
        </div>

        <nav aria-label="病例选择" className="flex items-center justify-center gap-2">
          {presets.map((preset) => {
            const isActive = activeCase.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => selectCase(preset.id)}
                className={`h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-truth ${isActive ? 'border-truth/70 bg-truth/10 text-truth' : 'border-line bg-panel text-ink-muted hover:border-pruned hover:text-ink'}`}
              >
                {preset.label}
              </button>
            )
          })}
          {customCase && (
            <div
              role="button"
              tabIndex={0}
              aria-pressed={activeCase.id === customCase.id}
              onClick={() => selectCase(customCase.id)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  selectCase(customCase.id)
                }
              }}
              className={`flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-truth ${activeCase.id === customCase.id ? 'border-truth/70 bg-truth/10 text-truth' : 'border-line bg-panel text-ink-muted hover:border-pruned hover:text-ink'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${activeCase.id === customCase.id ? 'bg-truth' : 'bg-pruned'}`} />
              自定义诊断
              <button
                type="button"
                aria-label="移除自定义诊断"
                onClick={(event) => {
                  event.stopPropagation()
                  removeCustomCase()
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded hover:bg-truth/15"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setDialogOpen(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-truth/40 bg-truth/10 px-3 text-xs text-truth hover:bg-truth/15">
            <Plus size={14} />新建诊断
          </button>
          <button type="button" onClick={() => void openMuseum()} className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs text-ink-muted hover:border-truth/40 hover:text-truth">
            <Archive size={14} />翻车博物馆
            {vaultEntries.length > 0 && (
              <span className="rounded bg-truth/15 px-1.5 py-px font-mono text-[9px] text-truth">{vaultEntries.length}</span>
            )}
          </button>
        </div>
      </header>

      <main className="grid h-[calc(100vh-56px)] grid-cols-[300px_minmax(0,1fr)_380px] gap-3 p-3">
        <EvidencePanel key={activeCase.id} preset={activeCase} synthetic={presets.some((preset) => preset.id === activeCase.id)} />
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <PanelHeader index="02" title={activeCase.label} english="CAUSAL TREE" />
          {diagnosis.confidenceNote && (
            <div className="shrink-0 truncate border-b border-line px-3 py-1.5 text-[10px] leading-4 text-suspect">
              {diagnosis.confidenceNote}
            </div>
          )}
          <div className="min-h-0 flex-1 p-3">
            <CausalTree
              key={activeCase.id}
              diagnosis={diagnosis}
              scores={scores}
              prunedIds={prunedIds}
              lockedId={lockedId}
            />
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-3 font-mono text-[9px] text-ink-muted">
            <span>{lockedId ? `${lockedId.toUpperCase()} 已锁定 · 可重置后尝试其他路径` : '回答右侧问题，实时重算概率并剪枝'}</span>
            <span className="text-pruned">ROOT → HYPOTHESES → SUB-CAUSES</span>
          </div>
        </section>
        <TriagePanel
          diagnosis={diagnosis}
          answers={answers}
          scores={scores}
          lockedId={lockedId}
          onAnswer={answerQuestion}
          onManualLock={() => setManualLockId(getLeadingHypothesis(scores).id)}
          onReset={resetAnswers}
          onExportRecap={() => void buildRecap()}
          onSaveToVault={() => void saveToVault()}
          vaulted={recapSaved}
          vaultError={vaultNote}
          recapBusy={recapBusy}
        />
      </main>
      <DiagnoseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSuccess={handleDiagnoseSuccess} />
      <RecapCardPreview
        open={recapBusy || recapUrl !== null}
        url={recapUrl}
        busy={recapBusy}
        onClose={closeRecap}
        onDownload={downloadRecap}
        onSaveToVault={() => void saveToVault()}
        saved={recapSaved}
      />
      <VaultMuseum
        open={museumOpen}
        entries={vaultEntries}
        onClose={closeMuseum}
        onRestore={restoreVault}
        onDelete={(id) => void handleDeleteVault(id)}
        onStartDiagnosis={startDiagnosisFromMuseum}
      />
    </div>
  )
}
