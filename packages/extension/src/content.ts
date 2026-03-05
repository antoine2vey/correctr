import { Console, Data, Effect, Ref, Schema } from 'effect'

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

console.log('[content] Content script loaded')

const isInputLike = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el?.tagName === 'INPUT' ||
  el?.tagName === 'TEXTAREA'

const saveCurrentSelection = (source: string) => {
  const active = document.activeElement
  console.log(`[content] saveCurrentSelection (${source}) — activeElement: ${active?.tagName} ${active?.constructor.name}`)

  if (active instanceof HTMLIFrameElement) {
    try {
      const iframeWin = active.contentWindow
      const selection = iframeWin?.getSelection()
      const text = selection?.toString() ?? ''
      console.log(`[content] (${source}) iframe selection rangeCount=${selection?.rangeCount} text="${text.slice(0, 50)}"`)
      if (text.trim() && selection && selection.rangeCount > 0) {
        Effect.runSync(Ref.set(savedIframe, active))
        Effect.runSync(Ref.set(savedRange, selection.getRangeAt(0).cloneRange()))
        Effect.runSync(Ref.set(savedActiveElement, null))
        console.log(`[content] (${source}) saved iframe range`)
      }
    } catch (e) {
      console.warn(`[content] (${source}) cross-origin iframe, cannot access selection`, e)
    }
    return
  }

  if (isInputLike(active)) {
    const el = active as HTMLInputElement
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) {
      console.log(`[content] (${source}) saved input/textarea [${start}, ${end}]`)
      Effect.runSync(Ref.set(savedActiveElement, { el, start, end }))
      Effect.runSync(Ref.set(savedRange, null))
      Effect.runSync(Ref.set(savedIframe, null))
    }
  } else {
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    console.log(`[content] (${source}) getSelection rangeCount=${selection?.rangeCount} text="${text.slice(0, 50)}"`)
    if (text.trim() && selection && selection.rangeCount > 0) {
      Effect.runSync(Ref.set(savedRange, selection.getRangeAt(0).cloneRange()))
      Effect.runSync(Ref.set(savedActiveElement, null))
      Effect.runSync(Ref.set(savedIframe, null))
      console.log(`[content] (${source}) saved range`)
    }
  }
}

// Track selection continuously
document.addEventListener('selectionchange', () => saveCurrentSelection('selectionchange'))

// Also capture on right-click mousedown — fires before contextmenu and before any selection clearing
document.addEventListener('mousedown', e => {
  if (e.button === 2) saveCurrentSelection('mousedown-right')
})

// ── Selection ─────────────────────────────────────────────────────────────────

const validateText = (text: string): Effect.Effect<string, SelectionError> =>
  text.trim()
    ? Effect.succeed(text)
    : Effect.fail(new SelectionError({ message: 'Empty selection' }))

const restoreAndReplace = (text: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const saved = yield* Ref.get(savedActiveElement)
    if (saved) {
      console.log(`[content] Replacing via input/textarea setRangeText [${saved.start}, ${saved.end}]`)
      saved.el.focus()
      saved.el.setRangeText(text, saved.start, saved.end, 'end')
      saved.el.dispatchEvent(new Event('input', { bubbles: true }))
      console.log('[content] Replacement done (input/textarea)')
      return
    }

    const iframe = yield* Ref.get(savedIframe)
    const range = yield* Ref.get(savedRange)
    console.log(`[content] iframe: ${iframe ? iframe.id : 'null'}, range: ${range ? 'present' : 'null'}`)

    if (iframe && range) {
      console.log('[content] Replacing via iframe execCommand')
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
              console.log('[content] Replacement done (iframe execCommand)')
            } else {
              console.warn('[content] iframe getSelection() returned null')
            }
          }
        } catch (e) {
          console.warn('[content] iframe replacement failed', e)
        }
      })
      return
    }

    if (!range) {
      console.warn('[content] No saved range, cannot replace text')
      return
    }

    yield* Effect.sync(() => {
      const selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
        document.execCommand('insertText', false, text)
        console.log('[content] Replacement done (execCommand)')
      } else {
        console.warn('[content] getSelection() returned null, cannot replace')
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

  console.log('[content] Received CORRECTR_TRIGGER, text length:', message.text?.length ?? 0)

  const program = Effect.gen(function* () {
    const text = yield* validateText(message.text ?? '')
    console.log(`[content] Text validated (${text.length} chars): "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`)
    yield* showToast('Correcting…', 'loading')
    const corrected = yield* correctText(text)
    console.log(`[content] Received corrected text (${corrected.length} chars): "${corrected.slice(0, 80)}${corrected.length > 80 ? '…' : ''}"`)
    yield* restoreAndReplace(corrected)
    yield* Ref.set(savedRange, null)
    yield* Ref.set(savedActiveElement, null)
    yield* Ref.set(savedIframe, null)
    yield* showToast('Text corrected!', 'success')
  }).pipe(
    Effect.catchTags({
      SelectionError: e => Effect.sync(() => console.warn('[content] SelectionError:', e.message)),
      ApiError: e =>
        Console.error('[content] API error:', e.message).pipe(
          Effect.andThen(showToast(e.message, 'error')),
          Effect.andThen(Ref.set(savedRange, null)),
        ),
    }),
  )

  Effect.runPromise(program)
})
