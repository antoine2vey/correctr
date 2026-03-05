import { Data } from 'effect'

export class OpenAIError extends Data.TaggedError('OpenAIError')<{
  message: string
  cause?: unknown
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  message: string
}> {}
