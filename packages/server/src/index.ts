import { Console, Effect, Schema } from 'effect'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ValidationError } from './errors/index.js'
import { OpenAIService, OpenAIServiceLive } from './services/OpenAIService.js'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)

const CorrectRequestSchema = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1, { message: () => 'text must not be empty' })),
})

app.post('/correct', async ctx => {
  return Effect.runPromise(
    Effect.gen(function* () {
      const body = yield* Effect.tryPromise({
        try: () => ctx.req.json(),
        catch: () => new ValidationError({ message: 'Invalid JSON body' }),
      })

      const { text } = yield* Schema.decodeUnknown(CorrectRequestSchema)(body).pipe(
        Effect.mapError(e => new ValidationError({ message: `Validation failed: ${e.message}` })),
      )

      yield* Console.log(`[correct] Processing ${text.length} chars`)

      const service = yield* OpenAIService
      const corrected = yield* service.correct(text)

      yield* Console.log(`[correct] Done, returned ${corrected.length} chars`)

      return ctx.json({ corrected })
    }).pipe(
      Effect.provide(OpenAIServiceLive),
      Effect.catchTags({
        ValidationError: e => Effect.succeed(ctx.json({ error: e.message }, 400)),
        OpenAIError: e =>
          Console.error('[correct] OpenAI error:', e.message).pipe(
            Effect.andThen(Effect.succeed(ctx.json({ error: 'Failed to correct text' }, 500))),
          ),
      }),
    ),
  )
})

app.get('/health', c => c.json({ status: 'ok' }))

const port = Number(process.env.PORT ?? 3000)

console.log(`Correctr server running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
