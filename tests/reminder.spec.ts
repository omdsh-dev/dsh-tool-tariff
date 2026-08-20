import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inReminderWindow, startReminderScheduler } from '../src/reminder.ts'
import type { ReminderSchedulerOptions } from '../src/reminder.ts'

describe('reminder: inReminderWindow', () => {
  it('is true inside the window and false outside', () => {
    expect(inReminderWindow('08:50', '08:50', 10)).toBe(true)
    expect(inReminderWindow('08:59', '08:50', 10)).toBe(true)
    expect(inReminderWindow('09:00', '08:50', 10)).toBe(false)
    expect(inReminderWindow('08:49', '08:50', 10)).toBe(false)
    expect(inReminderWindow('13:55', '13:50', 10)).toBe(true)
  })

  it('wraps across midnight', () => {
    expect(inReminderWindow('23:55', '23:50', 10)).toBe(true)
    expect(inReminderWindow('00:04', '23:50', 10)).toBe(false) // 窗口不过午夜（实现约定）
  })
})

describe('reminder: startReminderScheduler', () => {
  let clock: Date

  beforeEach(() => {
    vi.useFakeTimers()
    // 本地 2026-08-20 08:49
    clock = new Date(2026, 7, 20, 8, 49, 0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeOptions = (onFire: (time: string) => void): ReminderSchedulerOptions => ({
    reminderTimes: ['08:50', '13:50'],
    reminderWindowMinutes: 10,
    tickMs: 1000,
    now: () => clock,
    onFire,
  })

  it('fires once when the clock enters the window', () => {
    const onFire = vi.fn()
    const scheduler = startReminderScheduler(makeOptions(onFire))
    // 08:49：未到窗口
    vi.advanceTimersByTime(1000)
    expect(onFire).not.toHaveBeenCalled()
    // 08:50：进入窗口
    clock = new Date(2026, 7, 20, 8, 50, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith('08:50')
    // 08:55：仍在窗口内，但不重复触发
    clock = new Date(2026, 7, 20, 8, 55, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('fires for each configured time on the same day', () => {
    const onFire = vi.fn()
    const scheduler = startReminderScheduler(makeOptions(onFire))
    clock = new Date(2026, 7, 20, 8, 50, 0)
    vi.advanceTimersByTime(1000)
    clock = new Date(2026, 7, 20, 13, 50, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(2)
    expect(onFire.mock.calls.map((call) => call[0])).toEqual(['08:50', '13:50'])
    scheduler.dispose()
  })

  it('does not fire again for the same boundary on the next day tick', () => {
    const onFire = vi.fn()
    const scheduler = startReminderScheduler(makeOptions(onFire))
    clock = new Date(2026, 7, 20, 8, 50, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
    // 当天不再触发（即使再跨几个 tick）
    vi.advanceTimersByTime(10_000)
    expect(onFire).toHaveBeenCalledTimes(1)
    // 次日同一时刻重新触发
    clock = new Date(2026, 7, 21, 8, 50, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })

  it('does not fire when the window already passed before startup', () => {
    const onFire = vi.fn()
    const scheduler = startReminderScheduler(makeOptions(onFire))
    // 09:00 之后启动：08:50 窗口已过
    clock = new Date(2026, 7, 20, 10, 0, 0)
    vi.advanceTimersByTime(1000)
    expect(onFire).not.toHaveBeenCalled()
    scheduler.dispose()
  })

  it('dispose stops further ticks', () => {
    const onFire = vi.fn()
    const scheduler = startReminderScheduler(makeOptions(onFire))
    clock = new Date(2026, 7, 20, 8, 50, 0)
    scheduler.dispose()
    vi.advanceTimersByTime(10_000)
    expect(onFire).not.toHaveBeenCalled()
  })
})
