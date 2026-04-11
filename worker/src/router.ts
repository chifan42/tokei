import { drizzle } from 'drizzle-orm/d1'
import { os } from './contract'
import { ingestHandler } from './routes/ingest'
import { summaryHandler } from './routes/summary'
import { checkBearer } from './middleware/auth'
import { errorHandler } from './middleware/errorHandler'

const authMiddleware = os.middleware(async ({ next, context, errors }) => {
  if (!checkBearer(context.request.headers, context.env.TOKEI_BEARER_TOKEN)) {
    throw errors.UNAUTHORIZED({ message: 'Missing or invalid bearer token' })
  }
  return next()
})

const ingest = os.ingest
  .use(errorHandler)
  .use(authMiddleware)
  .handler(async ({ input, context }) => {
    const db = drizzle(context.env.DB)
    return ingestHandler(input, { db, now: Math.floor(Date.now() / 1000) })
  })

const summary = os.summary
  .use(errorHandler)
  .use(authMiddleware)
  .handler(async ({ context }) => {
    const db = drizzle(context.env.DB)
    return summaryHandler({ db, now: Math.floor(Date.now() / 1000), tz: context.env.TOKEI_TIMEZONE })
  })

export const tokeiRouter = os.router({ ingest, summary })
