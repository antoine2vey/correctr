import { Data, Effect, Ref, Schema } from 'effect'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

// ── Errors ────────────────────────────────────────────────────────────────────

class ApiError extends Data.TaggedError('ApiError')<{ message: string }> {}
class SelectionError extends Data.TaggedError('SelectionError')<{ message: string }> {}

// ── API ───────────────────────────────────────────────────────────────────────

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

// ── State ─────────────────────────────────────────────────────────────────────

const savedRange = Effect.runSync(Ref.make<Range | null>(null))
const savedActiveElement = Effect.runSync(
  Ref.make<{ el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number } | null>(null),
)
const savedIframe = Effect.runSync(Ref.make<HTMLIFrameElement | null>(null))
const toastEl = Effect.runSync(Ref.make<HTMLElement | null>(null))

const clearSavedState = Ref.set(savedRange, null).pipe(
  Effect.andThen(Ref.set(savedActiveElement, null)),
  Effect.andThen(Ref.set(savedIframe, null)),
)

const isInputLike = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el?.tagName === 'INPUT' ||
  el?.tagName === 'TEXTAREA'

const saveIframeSelection = (iframe: HTMLIFrameElement) => {
  const selection = iframe.contentWindow?.getSelection()
  const text = selection?.toString() ?? ''
  if (text.trim() && selection && selection.rangeCount > 0) {
    Effect.runSync(
      Ref.set(savedIframe, iframe).pipe(
        Effect.andThen(Ref.set(savedRange, selection.getRangeAt(0).cloneRange())),
        Effect.andThen(Ref.set(savedActiveElement, null)),
      ),
    )
  }
}

const saveCurrentSelection = () => {
  const active = document.activeElement

  if (active instanceof HTMLIFrameElement) {
    try {
      saveIframeSelection(active)
    } catch {
      // cross-origin iframe, skip
    }
    return
  }

  if (isInputLike(active)) {
    const el = active as HTMLInputElement
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) {
      Effect.runSync(
        Ref.set(savedActiveElement, { el, start, end }).pipe(
          Effect.andThen(Ref.set(savedRange, null)),
          Effect.andThen(Ref.set(savedIframe, null)),
        ),
      )
    }
  } else {
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    if (text.trim() && selection && selection.rangeCount > 0) {
      Effect.runSync(
        Ref.set(savedRange, selection.getRangeAt(0).cloneRange()).pipe(
          Effect.andThen(Ref.set(savedActiveElement, null)),
          Effect.andThen(Ref.set(savedIframe, null)),
        ),
      )
    }
  }
}

// Track selection continuously
document.addEventListener('selectionchange', saveCurrentSelection)

// Also capture on right-click mousedown — fires before contextmenu and before any selection clearing
document.addEventListener('mousedown', e => {
  if (e.button === 2) saveCurrentSelection()
})

// ── Iframe selection tracking ──────────────────────────────────────────────────

const instrumentedIframes = new WeakSet<HTMLIFrameElement>()

const attachIframeListeners = (iframe: HTMLIFrameElement) => {
  if (instrumentedIframes.has(iframe)) return
  instrumentedIframes.add(iframe)

  const attach = () => {
    try {
      const iframeDoc = iframe.contentDocument
      if (!iframeDoc) return
      iframeDoc.addEventListener('selectionchange', () => saveIframeSelection(iframe))
    } catch {
      // cross-origin or unavailable iframe, skip
    }
  }

  // Always listen for future loads — handles srcdoc being set after the iframe is created
  iframe.addEventListener('load', attach)
  // Also attach to current document if already loaded
  if (iframe.contentDocument?.readyState === 'complete') {
    attach()
  }
}

document.querySelectorAll('iframe').forEach(attachIframeListeners)

const iframeObserver = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLIFrameElement) {
        attachIframeListeners(node)
      } else if (node instanceof Element) {
        node.querySelectorAll('iframe').forEach(attachIframeListeners)
      }
    }
  }
})
iframeObserver.observe(document.body, { childList: true, subtree: true })

// ── Selection ─────────────────────────────────────────────────────────────────

const validateText = (text: string): Effect.Effect<string, SelectionError> =>
  text.trim()
    ? Effect.succeed(text)
    : Effect.fail(new SelectionError({ message: 'Empty selection' }))

const restoreAndReplace = (text: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const saved = yield* Ref.get(savedActiveElement)
    if (saved) {
      saved.el.focus()
      saved.el.setRangeText(text, saved.start, saved.end, 'end')
      saved.el.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }

    const iframe = yield* Ref.get(savedIframe)
    const range = yield* Ref.get(savedRange)

    if (iframe && range) {
      yield* Effect.sync(() => {
        try {
          const iframeWin = iframe.contentWindow
          const iframeDoc = iframe.contentDocument
          if (iframeWin && iframeDoc) {
            const selection = iframeWin.getSelection()
            if (selection) {
              selection.removeAllRanges()
              selection.addRange(range)
              iframeDoc.execCommand('insertText', false, text)
            }
          }
        } catch {
          // replacement failed, skip
        }
      })
      return
    }

    if (!range) return

    yield* Effect.sync(() => {
      const selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
        document.execCommand('insertText', false, text)
      }
    })
  })

// ── Toast ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'loading' | 'success' | 'error'

const injectStyles: Effect.Effect<void> = Effect.sync(() => {
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
})

const showToast = (message: string, variant: ToastVariant): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* injectStyles

    const prev = yield* Ref.get(toastEl)
    prev?.remove()

    const palette = {
      loading: { bg: '#f8f9fb', border: '#e4e7ec', color: '#374151' },
      success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
      error: { bg: '#fef2f2', border: '#fecaca', color: '#dc2626' },
    }
    const icons = { loading: '↻', success: '✓', error: '✕' }
    const p = palette[variant]

    const el = document.createElement('div')
    el.style.cssText = `
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
      iconSpan.style.cssText =
        'display:inline-block; animation: correctr-spin 0.7s linear infinite;'
    }

    const label = document.createElement('span')
    label.textContent = message

    el.appendChild(iconSpan)
    el.appendChild(label)
    document.body.appendChild(el)

    yield* Ref.set(toastEl, el)

    if (variant !== 'loading') {
      setTimeout(() => {
        el.remove()
        Effect.runSync(Ref.set(toastEl, null))
      }, 3000)
    }
  })

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'CORRECTR_TRIGGER') return

  const program = Effect.gen(function* () {
    const text = yield* validateText(message.text ?? '')
    yield* showToast('Correcting…', 'loading')
    const corrected = yield* correctText(text)
    yield* restoreAndReplace(corrected)
    yield* clearSavedState
    yield* showToast('Text corrected!', 'success')
  }).pipe(
    Effect.catchTags({
      SelectionError: () => Effect.void,
      ApiError: e => showToast(e.message, 'error').pipe(Effect.andThen(clearSavedState)),
    }),
  )

  Effect.runPromise(program)
})
