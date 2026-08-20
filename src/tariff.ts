/**
 * 峰谷电价时段纯逻辑（可测试、零依赖）。
 *
 * 时段定义（按小时边界 [start, end) 判定）：
 * - 00:00-09:00 谷时
 * - 09:00-12:00 峰时
 * - 12:00-14:00 谷时
 * - 14:00-18:00 峰时
 * - 18:00-24:00 谷时
 *
 * @module dsh-tool-tariff/tariff
 */

export type TariffPeriod = 'peak' | 'off-peak'

export interface TariffSegment {
  /** 段起始 'HH:MM'。 */
  readonly start: string
  /** 段结束 'HH:MM'（24:00 表示午夜，属于前一天的段）。 */
  readonly end: string
  readonly period: TariffPeriod
  /** 中文标签：'峰时' | '谷时'。 */
  readonly label: string
}

/** 完整时段表（顺序即一天的时间顺序）。 */
export const TARIFF_SEGMENTS: readonly TariffSegment[] = [
  { start: '00:00', end: '09:00', period: 'off-peak', label: '谷时' },
  { start: '09:00', end: '12:00', period: 'peak', label: '峰时' },
  { start: '12:00', end: '14:00', period: 'off-peak', label: '谷时' },
  { start: '14:00', end: '18:00', period: 'peak', label: '峰时' },
  { start: '18:00', end: '24:00', period: 'off-peak', label: '谷时' },
] as const

/** 一天 1440 分钟。 */
export const MINUTES_PER_DAY = 24 * 60

/**
 * 解析 'HH:MM'（0-23 时 / 0-59 分，允许 '24:00'）为分钟数。
 * @param hhmm - 'HH:MM' 字符串。
 * @returns 自午夜起的分钟数（0..1440）。
 * @throws 非法格式时抛 Error。
 */
export function toMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (match === null) throw new Error(`tariff: 非法时间 "${hhmm}"，应为 HH:MM（如 08:50）`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  const total = hour * 60 + minute
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw new Error(`tariff: 非法时间 "${hhmm}"，小时须为 0-24 且分钟须为 0-59`)
  }
  return total
}

/** 分钟数格式化为 'HH:MM'（1440 → '24:00'）。 */
export function fromMinutes(minutes: number): string {
  const clamped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hour = Math.floor(clamped / 60)
  const minute = clamped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 在 'HH:MM' 上加分钟（支持跨午夜，如 23:50 + 20 → '00:10'）。 */
export function addMinutes(hhmm: string, minutes: number): string {
  return fromMinutes(toMinutes(hhmm) + minutes)
}

/**
 * 判定 'HH:MM' 属于哪个时段段（按 [start, end) 边界）。
 * @param hhmm - 'HH:MM' 时间。
 * @returns 命中的时段段。
 * @throws 时间不在任何段内（理论上不会发生，防御性）。
 */
export function classifyTime(hhmm: string): TariffSegment {
  const minutes = toMinutes(hhmm)
  const segment = TARIFF_SEGMENTS.find((item) => {
    const start = toMinutes(item.start)
    const end = item.end === '24:00' ? MINUTES_PER_DAY : toMinutes(item.end)
    return minutes >= start && minutes < end
  })
  if (segment === undefined) throw new Error(`tariff: 时间 ${hhmm} 不在任何时段内`)
  return segment
}

/** 一次查询的结果快照。 */
export interface TariffStatus {
  /** 查询的时钟时间 'HH:MM'。 */
  readonly now: string
  /** 当前所处时段。 */
  readonly current: TariffSegment
  /** 完整时段表。 */
  readonly segments: readonly TariffSegment[]
  /** 下一次时段切换。 */
  readonly nextSwitch: {
    /** 切换时刻 'HH:MM'（跨午夜时给出 '24:00'）。 */
    readonly at: string
    /** 切换后的时段标签（如 '峰时'）。 */
    readonly to: string
    /** 距切换的分钟数（0..1439）。 */
    readonly inMinutes: number
    /** 是否跨到次日。 */
    readonly tomorrow: boolean
  }
}

/**
 * 计算某时钟时间下的峰谷状态。
 * @param hhmm - 'HH:MM' 时钟时间。
 * @returns 当前时段、完整时段表与下次切换信息。
 */
export function tariffStatus(hhmm: string): TariffStatus {
  const minutes = toMinutes(hhmm)
  const current = classifyTime(hhmm)
  const next = TARIFF_SEGMENTS.find((item) => toMinutes(item.start) > minutes) ?? TARIFF_SEGMENTS[0]
  const tomorrow = next === TARIFF_SEGMENTS[0]
  const at = tomorrow ? '24:00' : next.start
  return {
    now: hhmm,
    current,
    segments: [...TARIFF_SEGMENTS],
    nextSwitch: {
      at,
      to: next.label,
      inMinutes: tomorrow ? (MINUTES_PER_DAY - minutes) + toMinutes(next.start) : toMinutes(next.start) - minutes,
      tomorrow,
    },
  }
}

/**
 * 取某时刻在指定 IANA 时区（或宿主本地时区）下的 'HH:MM' 时钟时间。
 * @param at - 时刻。
 * @param timezone - 可选 IANA 时区名（如 'Asia/Shanghai'）；缺省用宿主本地时间。
 * @returns 'HH:MM'（00:00-23:59，h23 制）。
 */
export function clockTimeIn(at: Date, timezone?: string): string {
  if (timezone === undefined || timezone.length === 0) {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  return `${hour}:${minute}`
}

/** 工具入参里的 time：'HH:MM' 直接使用；ISO 时间先换算成时钟时间。 */
export function resolveTimeArg(time: string | undefined, timezone: string | undefined, now: () => Date): string {
  if (time === undefined || time.length === 0) return clockTimeIn(now(), timezone)
  if (/^\d{1,2}:\d{2}$/.test(time)) {
    // 校验合法性
    toMinutes(time)
    return time
  }
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) throw new Error(`tariff: 非法时间 "${time}"，应为 HH:MM 或 ISO 8601 时间戳`)
  return clockTimeIn(parsed, timezone)
}
