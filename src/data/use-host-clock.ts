/** The device's local time, in the APP's language, ticking on the minute. */
import { useEffect, useState } from 'react'
import { useDateLocale } from '../lib/date-locale.js'
import { formatClock, msToNextMinute } from './host-clock.js'

export function useHostClock(): string {
  const locale = useDateLocale()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      setNow(new Date())
      timer = setTimeout(tick, msToNextMinute(Date.now()))
    }
    timer = setTimeout(tick, msToNextMinute(Date.now()))
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return formatClock(now, locale)
}
