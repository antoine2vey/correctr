import { Data, Effect, Schema } from 'effect'

const SERVER_URL = 'http://localhost:3000'

class ApiError extends Data.TaggedError('ApiError')<{ message: string }> {}

const CorrectResponseSchema = Schema.Struct({ corrected: Schema.String })

const correctText = (text: string): Effect.Effect<string, ApiError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${SERVER_URL}/correct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        }),
      catch: e => new ApiError({ message: `Network error: ${String(e)}` }),
    })

    if (!response.ok) {
      return yield* Effect.fail(new ApiError({ message: `Server error ${response.status}` }))
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new ApiError({ message: 'Failed to parse response' }),
    })

    const { corrected } = yield* Schema.decodeUnknown(CorrectResponseSchema)(json).pipe(
      Effect.mapError(() => new ApiError({ message: 'Unexpected response format' })),
    )

    return corrected
  })

// ── Selection ────────────────────────────────────────────────────────────────

let savedRange: Range | null = null

function readAndSaveSelection(): string | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  savedRange = selection.getRangeAt(0).cloneRange()
  return selection.toString() || null
}

function restoreAndReplace(text: string) {
  const active = document.activeElement

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? 0
    const end = active.selectionEnd ?? 0
    active.setRangeText(text, start, end, 'end')
    active.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }

  if (!savedRange) return
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(savedRange)
    document.execCommand('insertText', false, text)
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastEl: HTMLElement | null = null

type ToastVariant = 'loading' | 'success' | 'error'

function injectStyles() {
  if (document.getElementById('correctr-styles')) return
  const style = document.createElement('style')
  style.id = 'correctr-styles'
  style.textContent = `
    @keyframes correctr-in {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes correctr-spin { to { transform: rotate(360deg); } }
  `
  document.head.appendChild(style)
}

function showToast(message: string, variant: ToastVariant) {
  injectStyles()
  toastEl?.remove()

  const palette = {
    loading: { bg: '#f8f9fb', border: '#e4e7ec', color: '#374151' },
    success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
    error: { bg: '#fef2f2', border: '#fecaca', color: '#dc2626' },
  }
  const icons = { loading: '↻', success: '✓', error: '✕' }
  const p = palette[variant]

  toastEl = document.createElement('div')
  toastEl.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; border-radius: 10px;
    border: 1px solid ${p.border}; background: ${p.bg}; color: ${p.color};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,.10);
    animation: correctr-in 0.2s ease both;
  `

  const iconSpan = document.createElement('span')
  iconSpan.textContent = icons[variant]
  if (variant === 'loading') {
    iconSpan.style.cssText = 'display:inline-block; animation: correctr-spin 0.7s linear infinite;'
  }

  const label = document.createElement('span')
  label.textContent = message

  toastEl.appendChild(iconSpan)
  toastEl.appendChild(label)
  document.body.appendChild(toastEl)

  if (variant !== 'loading') {
    setTimeout(() => {
      toastEl?.remove()
      toastEl = null
    }, 3000)
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'CORRECTR_TRIGGER') return

  const text = readAndSaveSelection()
  if (!text?.trim()) return

  showToast('Correcting…', 'loading')

  Effect.runPromise(correctText(text)).then(
    corrected => {
      restoreAndReplace(corrected)
      showToast('Text corrected!', 'success')
      savedRange = null
    },
    (err: ApiError) => {
      showToast(err.message ?? 'Something went wrong', 'error')
      savedRange = null
    },
  )
})
