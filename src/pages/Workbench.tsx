import { useEffect, useMemo, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import CatalogRail from '../components/CatalogRail'
import type { CatalogFilter, CatalogItem } from '../components/CatalogRail'
import CausalTree from '../components/CausalTree'
import EvidencePanel from '../components/EvidencePanel'
import NewCaseView from '../components/NewCaseView'
import RecapCardPreview from '../components/RecapCardPreview'
import TriagePanel from '../components/TriagePanel'
import VaultMuseum from '../components/VaultMuseum'
import { presets } from '../data/presets'
import type { PresetCase } from '../data/presets'
import { deleteCustomCase, loadCustomCase, saveCustomCase } from '../lib/caseStorage'
import { downloadRecapCard, renderRecapCard } from '../lib/recapCard'
import { getAutomaticLockId, getLeadingHypothesis, getPrunedIds, scoreHypotheses } from '../lib/scoring'
import type { Answers, HypothesisScore } from '../lib/scoring'
import { deleteVaultEntry, listVaultEntries, saveVaultEntry } from '../lib/vaultStorage'
import type { VaultEntry } from '../lib/vaultStorage'
import type { DiagnosisResult } from '../types/diagnosis'

type WorkspaceView = 'case' | 'new' | 'archive'

export default function Workbench() {
  const [theme, setTheme] = useState<'ink' | 'lumen'>('ink')
  const [view, setView] = useState<WorkspaceView>('case')
  const [railOpen, setRailOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [activeCaseId, setActiveCaseId] = useState(presets[0].id)
  const [answers, setAnswers] = useState<Answers>({})
  const [manualLockId, setManualLockId] = useState<string | null>(null)
  const [customCase, setCustomCase] = useState<PresetCase | null>(null)
  const [archiveCase, setArchiveCase] = useState<PresetCase | null>(null)
  const [customCaseLoad] = useState(loadCustomCase)
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([])
  const [recapUrl, setRecapUrl] = useState<string | null>(null)
  const [recapBusy, setRecapBusy] = useState(false)
  const [recapSaved, setRecapSaved] = useState(false)
  const [recapCanSave, setRecapCanSave] = useState(true)
  const [hoveredSymptomId, setHoveredSymptomId] = useState<string | null>(null)
  const [hoveredHypothesisId, setHoveredHypothesisId] = useState<string | null>(null)
  const customCreatedAtRef = useRef(0)
  const customHasImageRef = useRef(false)
  const customCaseTouchedRef = useRef(false)
  const answersSaveTimerRef = useRef<number | undefined>(undefined)
  const recapUrlRef = useRef<string | null>(null)
  const recapBlobRef = useRef<Blob | null>(null)
  const recapExportedAtRef = useRef(0)
  const recapRequestRef = useRef(0)
  const archiveUrlRef = useRef('')

  const activeCase = archiveCase ?? (customCase?.id === activeCaseId ? customCase : presets.find((preset) => preset.id === activeCaseId) ?? presets[0])
  const isEditableCustom = Boolean(customCase && !archiveCase && customCase.id === activeCaseId)
  const { diagnosis } = activeCase
  const scores = useMemo(() => scoreHypotheses(diagnosis, answers), [diagnosis, answers])
  const prunedIds = useMemo(() => getPrunedIds(scores, Object.keys(answers).length), [scores, answers])
  const automaticLockId = useMemo(() => getAutomaticLockId(diagnosis, answers, scores), [diagnosis, answers, scores])
  const lockedId = manualLockId ?? automaticLockId
  const leading = getLeadingHypothesis(scores)
  const answeredCount = Object.keys(answers).length
  const hoveredHypothesis = hoveredHypothesisId ? diagnosis.hypotheses.find((item) => item.id === hoveredHypothesisId) : undefined
  const highlightSymptomIds = hoveredSymptomId ? [hoveredSymptomId] : hoveredHypothesis?.evidenceFor ?? []
  const flowStep = lockedId ? 5 : prunedIds.length > 0 ? 4 : answeredCount > 0 ? 3 : 2

  useEffect(() => {
    document.body.classList.remove('ink', 'lumen')
    document.body.classList.add(theme)
  }, [theme])

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
        label: caseData.diagnosis.caseTitle,
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
    void listVaultEntries().then(setVaultEntries)
    return () => {
      window.clearTimeout(answersSaveTimerRef.current)
      if (recapUrlRef.current) URL.revokeObjectURL(recapUrlRef.current)
    }
  }, [])

  const allItems = useMemo<CatalogItem[]>(() => {
    const presetItems = presets.map((preset, index) => ({
      id: preset.id,
      kind: 'preset' as const,
      title: preset.label,
      summary: preset.diagnosis.caseTitle,
      domain: preset.diagnosis.domain,
      code: `NO.${String(index + 1).padStart(3, '0')}`,
      truthTitle: preset.diagnosis.hypotheses[0]?.title,
      probability: preset.id === activeCaseId ? leading.probability : undefined,
      locked: preset.id === activeCaseId ? Boolean(lockedId) : undefined,
    }))
    const customItems = customCase ? [{
      id: customCase.id,
      kind: 'custom' as const,
      title: customCase.diagnosis.caseTitle,
      summary: customCase.diagnosis.caseTitle,
      domain: customCase.diagnosis.domain,
      code: 'C.01',
      truthTitle: customCase.id === activeCaseId && lockedId ? diagnosis.hypotheses.find((item) => item.id === lockedId)?.title : undefined,
      probability: customCase.id === activeCaseId ? leading.probability : undefined,
      locked: customCase.id === activeCaseId ? Boolean(lockedId) : undefined,
    }] : []
    const vaultItems = [...vaultEntries].sort((a, b) => a.createdAt - b.createdAt).map((entry, index) => ({
      id: entry.id,
      kind: 'vault' as const,
      title: entry.title,
      summary: entry.truthTitle,
      domain: entry.domain,
      code: `V.${String(index + 1).padStart(2, '0')}`,
      truthTitle: entry.truthTitle,
      probability: entry.probability,
      locked: true,
    }))
    return [...presetItems, ...customItems, ...vaultItems]
  }, [activeCaseId, customCase, vaultEntries, leading.probability, lockedId, diagnosis.hypotheses])

  const activeItem = allItems.find((item) => item.id === activeCaseId)
  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return allItems.filter((item) => {
      if (filter === 'progress' && item.id !== activeCaseId) return false
      if (filter === 'mine' && item.kind !== 'custom') return false
      if (filter === 'archived' && item.kind !== 'vault') return false
      if (!keyword) return true
      return [item.code, item.title, item.domain, item.truthTitle, item.summary].some((value) => value?.toLowerCase().includes(keyword))
    })
  }, [allItems, filter, search, activeCaseId])

  function scheduleAnswersSave(nextAnswers: Answers) {
    if (!customCase || archiveCase) return
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

  function clearArchiveCase() {
    if (archiveUrlRef.current) {
      URL.revokeObjectURL(archiveUrlRef.current)
      archiveUrlRef.current = ''
    }
    setArchiveCase(null)
  }

  function clearHover() {
    setHoveredSymptomId(null)
    setHoveredHypothesisId(null)
  }

  function selectCase(caseId: string) {
    clearHover()
    clearArchiveCase()
    clearArchiveCase()
    setActiveCaseId(caseId)
    setAnswers({})
    setManualLockId(null)
    setRecapSaved(false)
  }

  function answerQuestion(questionId: string, optionIndex: number) {
    const nextAnswers = { ...answers, [questionId]: optionIndex }
    setAnswers(nextAnswers)
    if (isEditableCustom) scheduleAnswersSave(nextAnswers)
    setManualLockId(null)
    setRecapSaved(false)
  }

  function resetAnswers() {
    setAnswers({})
    if (isEditableCustom) scheduleAnswersSave({})
    setManualLockId(null)
    setRecapSaved(false)
  }

  function handleDiagnoseSuccess(nextDiagnosis: DiagnosisResult, imageFile?: File, logText?: string) {
    clearHover()
    window.clearTimeout(answersSaveTimerRef.current)
    customCaseTouchedRef.current = true
    const createdAt = Date.now()
    const id = `custom-${createdAt}`
    const hasImage = Boolean(imageFile)
    const log = logText ?? ''
    const image = imageFile ? URL.createObjectURL(imageFile) : ''
    clearArchiveCase()
    customCreatedAtRef.current = createdAt
    customHasImageRef.current = hasImage
    void saveCustomCase({ id, diagnosis: nextDiagnosis, log, conditions: '', answers: {}, createdAt, hasImage }, imageFile)
    setCustomCase({ id, label: nextDiagnosis.caseTitle, diagnosis: nextDiagnosis, image, log, conditions: '' })
    setActiveCaseId(id)
    setAnswers({})
    setManualLockId(null)
    setRecapSaved(false)
    setView('case')
  }

  function removeCustomCase() {
    customCaseTouchedRef.current = true
    window.clearTimeout(answersSaveTimerRef.current)
    void loadCustomCase()
      .then((stored) => deleteCustomCase(stored?.caseData.id ?? customCase?.id ?? ''))
      .catch(() => {})
    if (customCase?.image.startsWith('blob:')) URL.revokeObjectURL(customCase.image)
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

  async function renderRecapFromData(data: { diagnosis: DiagnosisResult; scores: HypothesisScore[]; lockedId: string; answers: Answers; image: Blob | null }, canSave = true) {
    const request = ++recapRequestRef.current
    setRecapCanSave(canSave)
    setRecapBusy(true)
    setRecapSaved(false)
    try {
      const exportedAt = Date.now()
      const blob = await renderRecapCard({ ...data, exportedAt })
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

  async function buildRecap() {
    if (!lockedId || recapBusy) return
    const image = await getActiveImageBlob()
    await renderRecapFromData({ diagnosis, scores, lockedId, answers, image })
  }

  async function exportVaultEntry(entry: VaultEntry) {
    const entryScores = scoreHypotheses(entry.diagnosis, entry.answers)
    const savedLockId = entry.lockedId && entryScores.some((score) => score.id === entry.lockedId) ? entry.lockedId : null
    const entryLocked = savedLockId ?? getAutomaticLockId(entry.diagnosis, entry.answers, entryScores) ?? getLeadingHypothesis(entryScores).id
    if (!entryLocked) return
    await renderRecapFromData({ diagnosis: entry.diagnosis, scores: entryScores, lockedId: entryLocked, answers: entry.answers, image: entry.image }, false)
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
      lockedId,
      symptomSummary: diagnosis.observedSymptoms.find((item) => item.severity === 'critical')?.label ?? '',
      log: activeCase.log,
      answers,
      diagnosis,
      image,
      thumb: null,
    })
    if (result.ok) {
      setRecapSaved(true)
      setVaultEntries(await listVaultEntries())
    }
  }

  async function openArchive() {
    clearHover()
    setView('archive')
    setRailOpen(false)
    setVaultEntries(await listVaultEntries())
  }

  async function handleDeleteVault(id: string) {
    await deleteVaultEntry(id)
    setVaultEntries(await listVaultEntries())
  }

  function restoreVault(entry: VaultEntry) {
    clearArchiveCase()
    const archiveUrl = entry.image ? URL.createObjectURL(entry.image) : ''
    archiveUrlRef.current = archiveUrl
    setArchiveCase({
      id: `archive-${entry.id}`,
      label: '往期病例',
      diagnosis: entry.diagnosis,
      image: archiveUrl,
      log: entry.log,
      conditions: '',
    })
    setActiveCaseId(entry.id)
    setAnswers(entry.answers)
    const restoredScores = scoreHypotheses(entry.diagnosis, entry.answers)
    const savedLockId = entry.lockedId && restoredScores.some((score) => score.id === entry.lockedId) ? entry.lockedId : null
    setManualLockId(savedLockId ?? getAutomaticLockId(entry.diagnosis, entry.answers, restoredScores) ?? getLeadingHypothesis(restoredScores).id)
    setRecapSaved(false)
    setView('case')
  }

  function handleSelect(id: string) {
    clearHover()
    const entry = vaultEntries.find((item) => item.id === id)
    if (entry) {
      restoreVault(entry)
      setRailOpen(false)
      return
    }
    if (id === customCase?.id) {
      setActiveCaseId(id)
      setView('case')
      setRailOpen(false)
      return
    }
    selectCase(id)
    setView('case')
    setRailOpen(false)
  }

  const viewTitle = view === 'case' ? activeCase.label : view === 'new' ? '新建病例' : '翻车博物馆'

  return (
    <div className="h-screen surface-desk p-2.5 sm:p-4">
      <div className="app-shell flex h-full overflow-hidden border-[1.5px] rule-strong-border surface-folio">
        <CatalogRail
        theme={theme}
        onToggleTheme={() => setTheme((value) => value === 'ink' ? 'lumen' : 'ink')}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        items={filteredItems}
        activeItem={activeItem}
        activeId={activeCaseId}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        onSelect={handleSelect}
        onNewCase={() => { clearHover(); setView('new'); setRailOpen(false) }}
        onArchive={() => void openArchive()}
        flowStep={flowStep}
        totalCount={presets.length + (customCase ? 1 : 0) + vaultEntries.length}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="double-rule flex h-14 shrink-0 items-center justify-between px-4 surface-folio lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="打开目录" onClick={() => setRailOpen(true)} className="text-aux hover:seal-text lg:hidden">
              <Menu size={17} />
            </button>
            <h1 className="truncate font-display text-base font-semibold text-main">{viewTitle}</h1>
            <span className="hidden font-mono-tab text-[10px] tracking-[0.16em] text-aux sm:inline">
              {view === 'case' ? diagnosis.domain : view === 'new' ? 'NEW CASE' : 'ARCHIVE'}
            </span>
          </div>
          {view === 'case' && (
            <span className={`font-mono-tab text-[10px] ${lockedId ? 'teal-text' : 'amber-text'}`}>
              {lockedId ? '已锁定真因' : `已答 ${answeredCount}/${diagnosis.questions.length}`}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {view === 'case' && (
            <div className="grid h-full min-h-0 auto-rows-min grid-cols-1 overflow-y-auto xl:auto-rows-fr xl:grid-cols-2 xl:overflow-hidden">
              <EvidencePanel key={activeCase.id} preset={activeCase} highlightSymptomIds={highlightSymptomIds} onHoverSymptom={setHoveredSymptomId} />
              <div className="flex min-h-0 flex-col gap-3 p-3 pb-16 surface-folio xl:overflow-y-auto">
                <CausalTree
                  key={activeCase.id}
                  diagnosis={diagnosis}
                  scores={scores}
                  prunedIds={prunedIds}
                  lockedId={lockedId}
                  answeredCount={answeredCount}
                  theme={theme}
                  hoveredSymptomId={hoveredSymptomId}
                  hoveredHypothesisId={hoveredHypothesisId}
                  onHoverHypothesis={setHoveredHypothesisId}
                />
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
                  recapBusy={recapBusy}
                />
                {isEditableCustom && (
                  <button type="button" onClick={removeCustomCase} className="btn-ghost self-start px-3 py-1.5 text-[11px]">移除当前自定义病例</button>
                )}
              </div>
            </div>
          )}
          {view === 'new' && <NewCaseView onCancel={() => setView('case')} onSuccess={handleDiagnoseSuccess} />}
          {view === 'archive' && (
            <VaultMuseum
              entries={vaultEntries}
              presets={presets}
              onRestore={restoreVault}
              onDelete={(id) => void handleDeleteVault(id)}
              onExport={(entry) => void exportVaultEntry(entry)}
              onSelectPreset={(id) => { selectCase(id); setView('case') }}
              onNewCase={() => setView('new')}
            />
          )}
        </div>
        </div>
      </div>

      <RecapCardPreview
        open={recapBusy || recapUrl !== null}
        url={recapUrl}
        busy={recapBusy}
        onClose={closeRecap}
        onDownload={downloadRecap}
        onSaveToVault={() => void saveToVault()}
        saved={recapSaved}
        canSave={recapCanSave}
      />
    </div>
  )
}
