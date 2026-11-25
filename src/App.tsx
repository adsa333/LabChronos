import { useEffect, useState } from 'react'
import EntryGate from './components/EntryGate'
import Workbench from './pages/Workbench'

const ENTERED_KEY = 'labchronos_entered'

function readEntered(): boolean {
  if (new URLSearchParams(window.location.search).get('skipIntro') === '1') return true
  try {
    return sessionStorage.getItem(ENTERED_KEY) === '1'
  } catch {
    return false
  }
}

function writeEntered(value: boolean) {
  try {
    if (value) sessionStorage.setItem(ENTERED_KEY, '1')
    else sessionStorage.removeItem(ENTERED_KEY)
  } catch {
    // sessionStorage unavailable (private mode) — cover simply re-shows on refresh
  }
}

interface EntryTarget {
  caseId?: string
  view?: 'new'
}

function App() {
  const [entered, setEntered] = useState(readEntered)
  const [theme, setTheme] = useState<'ink' | 'lumen'>('ink')
  const [entryTarget, setEntryTarget] = useState<EntryTarget | null>(null)

  useEffect(() => {
    document.body.classList.remove('ink', 'lumen')
    document.body.classList.add(theme)
  }, [theme])

  const toggleTheme = () => setTheme((value) => value === 'ink' ? 'lumen' : 'ink')

  function enter(target: EntryTarget) {
    setEntryTarget(target)
    writeEntered(true)
    setEntered(true)
  }

  function showCover() {
    writeEntered(false)
    setEntered(false)
  }

  if (!entered) {
    return (
      <EntryGate
        theme={theme}
        onToggleTheme={toggleTheme}
        onEnterCase={(caseId) => enter({ caseId })}
        onEnterNewCase={() => enter({ view: 'new' })}
      />
    )
  }
  return (
    <Workbench
      theme={theme}
      onToggleTheme={toggleTheme}
      initialCaseId={entryTarget?.caseId}
      initialView={entryTarget?.view}
      onShowCover={showCover}
    />
  )
}

export default App