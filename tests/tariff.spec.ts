import { describe, expect, it } from 'vitest'
import {
  addMinutes,
  classifyTime,
  clockTimeIn,
  fromMinutes,
  resolveTimeArg,
  tariffStatus,
  toMinutes,
} from '../src/tariff.ts'

describe('tariff: toMinutes / fromMinutes', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('08:50')).toBe(530)
    expect(toMinutes('24:00')).toBe(1440)
    expect(toMinutes('23:59')).toBe(1439)
  })

  it('formats minutes back to HH:MM with wrapping', () => {
    expect(fromMinutes(530)).toBe('08:50')
    expect(fromMinutes(1440)).toBe('00:00')
    expect(fromMinutes(-10)).toBe('23:50')
    expect(addMinutes('23:50', 20)).toBe('00:10')
    expect(addMinutes('08:50', 10)).toBe('09:00')
  })

  it('rejects malformed input', () => {
    expect(() => toMinutes('8:5')).toThrow()
    expect(() => toMinutes('25:00')).toThrow()
    expect(() => toMinutes('24:01')).toThrow()
    expect(() => toMinutes('09:60')).toThrow()
    expect(() => toMinutes('abc')).toThrow()
  })
})

describe('tariff: classifyTime boundaries', () => {
  it('classifies the schedule exactly as specified', () => {
    // 00:00-09:00 谷时
    expect(classifyTime('00:00').label).toBe('谷时')
    expect(classifyTime('08:59').label).toBe('谷时')
    // 09:00-12:00 峰时
    expect(classifyTime('09:00').label).toBe('峰时')
    expect(classifyTime('11:59').label).toBe('峰时')
    // 12:00-14:00 谷时
    expect(classifyTime('12:00').label).toBe('谷时')
    expect(classifyTime('13:59').label).toBe('谷时')
    // 14:00-18:00 峰时
    expect(classifyTime('14:00').label).toBe('峰时')
    expect(classifyTime('17:59').label).toBe('峰时')
    // 18:00-24:00 谷时
    expect(classifyTime('18:00').label).toBe('谷时')
    expect(classifyTime('23:59').label).toBe('谷时')
  })
})

describe('tariff: tariffStatus', () => {
  it('reports current period and the full schedule', () => {
    const status = tariffStatus('08:50')
    expect(status.current).toMatchObject({ period: 'off-peak', label: '谷时' })
    expect(status.segments).toHaveLength(5)
    expect(status.segments.map((s) => s.label)).toEqual([
      '谷时', '峰时', '谷时', '峰时', '谷时',
    ])
  })

  it('computes nextSwitch forward within the day', () => {
    expect(tariffStatus('08:50').nextSwitch).toMatchObject({ at: '09:00', to: '峰时', inMinutes: 10, tomorrow: false })
    expect(tariffStatus('11:59').nextSwitch).toMatchObject({ at: '12:00', to: '谷时', inMinutes: 1, tomorrow: false })
    expect(tariffStatus('13:50').nextSwitch).toMatchObject({ at: '14:00', to: '峰时', inMinutes: 10, tomorrow: false })
    expect(tariffStatus('17:59').nextSwitch).toMatchObject({ at: '18:00', to: '谷时', inMinutes: 1, tomorrow: false })
  })

  it('wraps to tomorrow after the last segment', () => {
    const status = tariffStatus('23:00')
    expect(status.nextSwitch).toMatchObject({ at: '24:00', to: '谷时', tomorrow: true })
    expect(status.nextSwitch.inMinutes).toBe(60)
  })

  it('midnight is the start of the off-peak segment', () => {
    expect(tariffStatus('00:00').current.label).toBe('谷时')
  })
})

describe('tariff: clockTimeIn', () => {
  it('uses host local time when no timezone given', () => {
    const date = new Date(2026, 7, 20, 8, 50) // local 08:50
    expect(clockTimeIn(date)).toBe('08:50')
  })

  it('converts to a configured IANA timezone', () => {
    // 2026-08-20T00:50:00Z = 08:50 in Asia/Shanghai (UTC+8, no DST)
    const date = new Date('2026-08-20T00:50:00Z')
    expect(clockTimeIn(date, 'Asia/Shanghai')).toBe('08:50')
    expect(clockTimeIn(date, 'UTC')).toBe('00:50')
  })
})

describe('tariff: resolveTimeArg', () => {
  const now = () => new Date(2026, 7, 20, 9, 30)

  it('defaults to the current clock time', () => {
    expect(resolveTimeArg(undefined, undefined, now)).toBe('09:30')
  })

  it('accepts raw HH:MM', () => {
    expect(resolveTimeArg('14:00', undefined, now)).toBe('14:00')
    expect(() => resolveTimeArg('25:00', undefined, now)).toThrow()
  })

  it('converts ISO timestamps through the timezone', () => {
    expect(resolveTimeArg('2026-08-20T00:50:00Z', 'Asia/Shanghai', now)).toBe('08:50')
    expect(() => resolveTimeArg('not-a-time', undefined, now)).toThrow()
  })
})
