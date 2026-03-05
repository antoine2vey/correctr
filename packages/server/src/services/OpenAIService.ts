import { Context, Effect, Layer } from 'effect'
import OpenAI from 'openai'
import { OpenAIError } from '../errors/index.js'

const SYSTEM_PROMPT = `You are a grammar and spelling correction assistant.
Your job is to correct the input text for grammar, spelling, punctuation, and clarity.
Return ONLY the corrected text — no explanations, no commentary, no quotes around the text.
Preserve the original meaning, tone, and formatting (line breaks, lists, emojis, etc.) as much as possible.`

interface OpenAIServiceShape {
  correct: (text: string) => Effect.Effect<string, OpenAIError>
}

export class OpenAIService extends Context.Tag('OpenAIService')<
  OpenAIService,
  OpenAIServiceShape
>() {}

export const OpenAIServiceLive = Layer.effect(
  OpenAIService,
  Effect.gen(function* () {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return yield* Effect.fail(new OpenAIError({ message: 'OPENAI_API_KEY is not set' }))
    }

    const client = new OpenAI({ apiKey })

    return {
      correct: (text: string) =>
        Effect.tryPromise({
          try: () =>
            client.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text },
              ],
            }),
          catch: e => new OpenAIError({ message: 'OpenAI API call failed', cause: e }),
        }).pipe(
          Effect.flatMap(response => {
            const content = response.choices[0]?.message?.content
            if (content) return Effect.succeed(content)
            return Effect.fail(new OpenAIError({ message: 'Unexpected response format' }))
          }),
        ),
    }
  }),
)
