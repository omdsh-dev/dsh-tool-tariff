/**
 * 峰时切换提醒调度器。
 *
 * 每隔 tickMs 检查一次当前时钟时间：落在任一提醒窗口（如 08:50-09:00、
 * 13:50-14:00，即提醒时刻 + window 分钟）内且当天尚未触发过时，回调 onFire
 * 一次。窗口内重启进程会再次触发（当天一次性语义只存在于内存）。
 *
 * 用轮询而非精确 setTimeout：避免 IANA 时区下的 DST 换算，且天然覆盖
 * "插件在窗口中途启动"的情况。
 *
 * @module dsh-tool-tariff/reminder
 */

import { clockTimeIn, toMinutes } from './tariff.ts'

export interface ReminderSchedulerOptions {
  /** 可选 IANA 时区（缺省宿主本地时间）。 */
  readonly timezone?: string
  /** 每天触发提醒的时刻列表 'HH:MM'（默认 08:50 / 13:50）。 */
  readonly reminderTimes?: readonly string[]
  /** 每个提醒的窗口长度（分钟，默认 10，即 08:50-09:00）。 */
  readonly reminderWindowMinutes?: number
  /** 轮询间隔毫秒（默认 20000）。 */
  readonly tickMs?: number
  /** 可注入时钟（测试用）。 */
  readonly now?: () => Date
  /** 命中窗口时回调（同一时刻同一天至多一次）。 */
  readonly onFire: (time: string) => void | Promise<void>
}

export interface ReminderScheduler {
  /** 停止轮询并清理定时器。 */
  dispose(): void
}

/**
 * 判定时钟时间 hhmm 是否落在某提醒窗口内（[time, time+window)）。
 * 窗口以分钟运算，不跨午夜：窗口在 24:00 结束即截止（如 23:50+10 只覆盖
 * 23:50-23:59，00:00 起属于次日）。
 * @param hhmm - 当前时钟时间 'HH:MM'。
 * @param time - 提醒时刻 'HH:MM'。
 * @param windowMinutes - 窗口分钟数。
 */
export function inReminderWindow(hhmm: string, time: string, windowMinutes: number): boolean {
  const minutes = toMinutes(hhmm)
  const start = toMinutes(time)
  return minutes >= start && minutes < start + windowMinutes
}

/**
 * 启动提醒调度器。
 * @param options - 配置与回调。
 * @returns 可 dispose 的调度器句柄。
 */
export function startReminderScheduler(options: ReminderSchedulerOptions): ReminderScheduler {
  const times = options.reminderTimes !== undefined && options.reminderTimes.length > 0
    ? [...options.reminderTimes]
    : ['08:50', '13:50']
  const windowMinutes = options.reminderWindowMinutes ?? 10
  const tickMs = options.tickMs ?? 20_000
  const clock = options.now ?? (() => new Date())
  /** time -> 当天日期键；同一天同一时刻只触发一次。 */
  const lastFired = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const dateKey = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const tick = (): void => {
    if (disposed) return
    const now = clock()
    const hhmm = clockTimeIn(now, options.timezone)
    const day = dateKey(now)
    for (const time of times) {
      if (!inReminderWindow(hhmm, time, windowMinutes)) continue
      if (lastFired.get(time) === day) continue
      lastFired.set(time, day)
      Promise.resolve(options.onFire(time)).catch((error: unknown) => {
        // 提醒投递失败不应中断调度器。
        console.error(`dsh-tool-tariff: 峰时切换提醒投递失败: ${String(error instanceof Error ? error.message : error)}`)
      })
    }
    timer = setTimeout(tick, tickMs)
  }

  timer = setTimeout(tick, tickMs)

  return {
    dispose(): void {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
