import { Console, Data, Effect, Schema } from 'effect'

const SERVER_URL = 'http://localhost:3000'

export class ApiError extends Data.TaggedError('ApiError')<{
  message: string
}> {}

const CorrectResponseSchema = Schema.Struct({
  corrected: Schema.String,
})

export const correctText = (text: string): Effect.Effect<string, ApiError> =>
  Effect.gen(function* () {
    yield* Console.log(`[api] Correcting ${text.length} chars`)

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
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ error?: string }>,
        catch: () => new ApiError({ message: 'Failed to parse error response' }),
      })
      return yield* Effect.fail(
        new ApiError({
          message: body?.error ?? `Server error ${response.status}`,
        }),
      )
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

export const copyToClipboard = (text: string): Effect.Effect<void, ApiError> =>
  Effect.tryPromise({
    try: () => navigator.clipboard.writeText(text),
    catch: e => new ApiError({ message: `Clipboard error: ${String(e)}` }),
  })
