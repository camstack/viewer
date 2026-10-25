import type { JobRequest } from './activity-store.js'

/** Called when the job ends, however it ends (the page un-dims what it queued). */
export type OnSettled = () => void

/** The same job, calling `settled` once it has run (done or failed) or been cancelled while queued. */
export function settleAfter(request: JobRequest, settled: OnSettled | undefined): JobRequest {
  if (settled === undefined) return request
  return {
    ...request,
    onCancel: settled,
    run: async (context) => {
      try {
        return await request.run(context)
      } finally {
        settled()
      }
    },
  }
}
