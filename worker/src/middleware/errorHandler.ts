import { os } from '../contract'

/** Translate thrown errors into structured oRPC errors. */
export const errorHandler = os.middleware(async ({ next, errors }) => {
  try {
    return await next()
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.startsWith('CLOCK_SKEW') && 'CLOCK_SKEW' in errors) {
        throw (errors as any).CLOCK_SKEW({ message: e.message })
      }
    }
    console.error('unhandled error', e)
    throw e
  }
})
