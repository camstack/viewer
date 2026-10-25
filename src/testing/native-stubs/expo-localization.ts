export const getLocales = (): readonly { languageCode: string; languageTag: string }[] => [
  { languageCode: 'en', languageTag: 'en-GB' },
]
export const getCalendars = (): readonly { timeZone: string | null }[] => [{ timeZone: 'UTC' }]
export const locale = 'en-GB'
