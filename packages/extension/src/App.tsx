import { Effect } from 'effect'
import { useCallback, useRef, useState } from 'react'
import { type ApiError, copyToClipboard, correctText } from './api'

type ToastType = 'success' | 'error'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let toastId = 0

export default function App() {
  const [text, setText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData('text')
      if (!pasted.trim()) return

      setIsLoading(true)

      const program = Effect.gen(function* () {
        const corrected = yield* correctText(pasted)
        yield* copyToClipboard(corrected)
        return corrected
      })

      Effect.runPromise(program).then(
        corrected => {
          setText(corrected)
          setIsLoading(false)
          addToast('Corrected text copied to clipboard', 'success')
        },
        (err: ApiError) => {
          setIsLoading(false)
          addToast(err.message ?? 'Something went wrong', 'error')
        },
      )
    },
    [addToast],
  )

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="logo-dot" />
          <span className="logo-text">Correctr</span>
        </div>
        <button
          type="button"
          className="toggle-btn"
          onClick={() => setIsCollapsed(v => !v)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 5l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 9l4-4 4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </header>

      {!isCollapsed && (
        <main className="main">
          <div className="textarea-wrapper">
            <textarea
              ref={textareaRef}
              className="textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              onPaste={handlePaste}
              placeholder="Paste your text here to auto-correct it..."
              spellCheck={false}
              disabled={isLoading}
            />
            {isLoading && (
              <div className="loading-overlay">
                <div className="spinner-ring" />
                <span className="loading-label">Correcting…</span>
              </div>
            )}
          </div>
          {text && !isLoading && (
            <p className="hint">Paste again to re-correct — result is copied automatically.</p>
          )}
        </main>
      )}

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">{t.type === 'success' ? '✓' : '✕'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
