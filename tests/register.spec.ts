import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

interface FakeToolDef {
  name: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (...args: unknown[]) => unknown[] }
  timeoutMs: number
}

describe('tariff: plugin registration contract', () => {
  it('exports the cordis plugin contract', () => {
    expect(name).toBe('@deepseek-ai/dsh-tool-tariff')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the tariff and api_balance tools with schema + render', () => {
    const registered: FakeToolDef[] = []
    const ctx: any = {
      tools: { register: (def: FakeToolDef) => { registered.push(def); return () => {} } },
      get: () => undefined,
      inject: () => () => {},
    }
    apply(ctx)

    expect(registered.map((def) => def.name)).toEqual(['tariff', 'api_balance'])

    const tariff = registered[0]
    expect(typeof tariff.parameters.time).toBe('object')
    expect(typeof tariff.output.render).toBe('function')
    expect(tariff.timeoutMs).toBeGreaterThan(0)

    const balance = registered[1]
    expect(balance.output.schema).toEqual({ type: 'json' })
    expect(typeof balance.output.render).toBe('function')
  })

  it('waits for the connection service via ctx.inject', () => {
    const injected: Array<{ deps: string[]; cb: () => unknown }> = []
    const ctx: any = {
      tools: { register: () => () => {} },
      get: () => undefined,
      inject: (deps: string[], cb: () => unknown) => { injected.push({ deps, cb }); return () => {} },
    }
    apply(ctx)
    expect(injected).toHaveLength(1)
    expect(injected[0].deps).toEqual(['connection'])
  })

  it('does not start the reminder scheduler without the agents service', () => {
    const ctx: any = {
      tools: { register: () => () => {} },
      get: () => undefined,
      inject: () => () => {},
    }
    expect(() => apply(ctx)).not.toThrow()
  })

  it('rejects invalid reminder times in config', () => {
    const ctx: any = {
      tools: { register: () => () => {} },
      get: () => undefined,
      inject: () => () => {},
    }
    expect(() => apply(ctx, { reminderTimes: ['25:00'] })).toThrow(/非法提醒时刻/)
  })
})
