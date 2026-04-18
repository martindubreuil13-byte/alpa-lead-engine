type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

type LocalDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getZonedFormatter(timeZone: string) {
  const cached = zonedFormatterCache.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  zonedFormatterCache.set(timeZone, formatter)
  return formatter
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getZonedFormatter(timeZone).formatToParts(date)
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)

  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    second: lookup('second'),
  }
}

function compareLocalDateTimes(left: LocalDateTimeParts, right: LocalDateTimeParts) {
  const leftKey = `${left.year}-${String(left.month).padStart(2, '0')}-${String(left.day).padStart(2, '0')} ${String(left.hour).padStart(2, '0')}:${String(left.minute).padStart(2, '0')}`
  const rightKey = `${right.year}-${String(right.month).padStart(2, '0')}-${String(right.day).padStart(2, '0')} ${String(right.hour).padStart(2, '0')}:${String(right.minute).padStart(2, '0')}`
  return leftKey.localeCompare(rightKey)
}

function addLocalDays(parts: LocalDateTimeParts, days: number): LocalDateTimeParts {
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  }
}

function diffMinutes(desired: LocalDateTimeParts, actual: ZonedParts) {
  const desiredUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute)
  const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
  return Math.round((desiredUtc - actualUtc) / 60000)
}

export function normalizeScheduleTime(value: string | null | undefined) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return '09:00'

  const hour = Math.max(0, Math.min(23, Number(match[1])))
  const minute = Math.max(0, Math.min(59, Number(match[2])))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function parseScheduleTime(value: string | null | undefined) {
  const normalized = normalizeScheduleTime(value)
  const [hour, minute] = normalized.split(':').map((part) => Number(part))
  return { hour, minute, normalized }
}

export function parseLocalDateTimeInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }
}

export function zonedLocalToUtc(parts: LocalDateTimeParts, timeZone: string) {
  let candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0))

  for (let i = 0; i < 4; i += 1) {
    const actual = getZonedParts(candidate, timeZone)
    const deltaMinutes = diffMinutes(parts, actual)
    if (deltaMinutes === 0) {
      return candidate
    }
    candidate = new Date(candidate.getTime() + deltaMinutes * 60000)
  }

  return candidate
}

export function computeNextDailyRunAt(params: {
  timeZone: string
  localTime: string
  after?: Date
}) {
  const { timeZone, localTime } = params
  const after = params.after ?? new Date()
  const { hour, minute } = parseScheduleTime(localTime)
  const afterLocal = getZonedParts(after, timeZone)

  let candidateLocal: LocalDateTimeParts = {
    year: afterLocal.year,
    month: afterLocal.month,
    day: afterLocal.day,
    hour,
    minute,
  }

  const afterComparable: LocalDateTimeParts = {
    year: afterLocal.year,
    month: afterLocal.month,
    day: afterLocal.day,
    hour: afterLocal.hour,
    minute: afterLocal.minute,
  }

  if (compareLocalDateTimes(candidateLocal, afterComparable) <= 0) {
    candidateLocal = addLocalDays(candidateLocal, 1)
  }

  return zonedLocalToUtc(candidateLocal, timeZone)
}

export function computeFirstRunAt(params: {
  startMode: 'now' | 'later'
  timeZone: string
  startAtLocal?: string | null
  localTime: string
}) {
  const { startMode, timeZone, startAtLocal, localTime } = params

  if (startMode === 'later' && startAtLocal) {
    const parsed = parseLocalDateTimeInput(startAtLocal)
    if (parsed) {
      return zonedLocalToUtc(parsed, timeZone)
    }
  }

  return new Date()
}

export function computeNextRunAfterCompletion(params: {
  timeZone: string
  localTime: string
  completedAt?: Date
}) {
  return computeNextDailyRunAt({
    timeZone: params.timeZone,
    localTime: params.localTime,
    after: params.completedAt ?? new Date(),
  })
}
