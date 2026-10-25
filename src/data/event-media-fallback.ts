/**
 * When the HTTP event-media URL is an honest miss, do not recover through
 * `getEventMedia`. That tRPC path ships base64 through hub-main; a 404 from
 * the analytics data-plane means there is no blob, and N cards doing the
 * same fallback is the paint-burst that sat on the 2026-08-24 Events stall.
 *
 * Other statuses (and a fetch that never obtained a status) may still try
 * the base64 recovery — a CORS/network failure is not a miss.
 */
export function isHonestEventMediaMiss(httpStatus: number): boolean {
  return httpStatus === 404
}
