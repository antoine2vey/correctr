import { Console, Data, Effect, Option, Ref, Schema } from 'effect'

const SERVER_URL = 'http://localhost:3000'

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
const toastEl = Effect.runSync(Ref.make<HTMLElement | null>(null))

// ── Selection ─────────────────────────────────────────────────────────────────

const readAndSaveSelection: Effect.Effect<string, SelectionError> = Effect.sync(() =>
  window.getSelection(),
).pipe(
  Effect.flatMap(selection =>
    Option.fromNullable(selection && selection.rangeCount > 0 ? selection : null).pipe(
      Option.match({
        onNone: () => Effect.fail(new SelectionError({ message: 'No selection' })),
        onSome: sel => {
          const text = sel.toString()
          return text.trim()
            ? Ref.set(savedRange, sel.getRangeAt(0).cloneRange()).pipe(
                Effect.as(text),
              )
            : Effect.fail(new SelectionError({ message: 'Empty selection' }))
        },
      }),
    ),
  ),
)

const restoreAndReplace = (text: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const active = document.activeElement

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart ?? 0
      const end = active.selectionEnd ?? 0
      active.setRangeText(text, start, end, 'end')
      active.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }

    const range = yield* Ref.get(savedRange)
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
    const text = yield* readAndSaveSelection
    yield* showToast('Correcting…', 'loading')
    yield* Console.log(`[content] Correcting ${text.length} chars`)
    const corrected = yield* correctText(text)
    yield* restoreAndReplace(corrected)
    yield* Ref.set(savedRange, null)
    yield* showToast('Text corrected!', 'success')
  }).pipe(
    Effect.catchTags({
      SelectionError: () => Effect.void,
      ApiError: e =>
        Console.error('[content] API error:', e.message).pipe(
          Effect.andThen(showToast(e.message, 'error')),
          Effect.andThen(Ref.set(savedRange, null)),
        ),
    }),
  )

  Effect.runPromise(program)
})
