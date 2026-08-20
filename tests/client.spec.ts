import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 客户端 bundle 契约测试：以 mock window.__ModuleLoader__ 求值 lib 的
 * client 入口（构建后是 lib/client.js），验证：
 * - ModuleLoader.load 注册形态（id + factory）；
 * - factory 物化出 cordis 插件（name/inject/apply）；
 * - apply 经 ctx.slots.inject 注册 conversation.session.header.utilities 条目；
 * - 无 connection 时 api 为 null，有 connection 时组件经 /api RPC 调用 host。
 */
function loadClientBundle(sourcePath: string) {
  const code = readFileSync(new URL(sourcePath, import.meta.url), 'utf8')
  let captured: { id: string; factory: (require: (spec: string) => unknown) => unknown } | undefined
  const windowMock = {
    __ModuleLoader__: { load: (entry: { id: string; factory: (r: (s: string) => unknown) => unknown }) => { captured = entry } },
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', code)
  fn(windowMock)
  if (captured === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
  return captured
}

const reactStub = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('react.fragment'),
  useState: () => [null, () => {}],
  useEffect: () => {},
} as never

function materialize(sourcePath: string) {
  const entry = loadClientBundle(sourcePath)
  // factory 末尾 return module.exports —— 返回值即插件本体。
  return entry.factory((spec) => {
    if (spec === 'react') return reactStub
    throw new Error(`unexpected require: ${spec}`)
  })
}

describe('tariff client bundle: ModuleLoader contract', () => {
  const plugin = materialize('../client/client.js') as { name: string; inject: string[]; apply: (ctx: unknown) => unknown }

  it('registers a factory with the package id and returns a cordis plugin', () => {
    const entry = loadClientBundle('../client/client.js')
    expect(entry.id).toBe('@deepseek-ai/dsh-tool-tariff')
    expect(plugin.name).toBe('tool-tariff-client')
    expect(plugin.inject).toContain('slots')
    expect(typeof plugin.apply).toBe('function')
  })

  it('registers a tariff-status entry in the header utilities slot', () => {
    let injected: { key: string; cb: () => unknown } | undefined
    let registered: { entry: Record<string, unknown>; component: unknown } | undefined
    const ctx: any = {
      get: () => undefined,
      slots: {
        inject: (key: string, cb: () => unknown) => { injected = { key, cb }; return () => {} },
        register: (entry: Record<string, unknown>, component: unknown) => { registered = { entry, component }; return () => {} },
      },
    }
    plugin.apply(ctx)
    expect(injected?.key).toBe('conversation.session.header.utilities')
    const disposer = injected?.cb()
    expect(typeof disposer).toBe('function')
    expect(registered?.entry).toMatchObject({
      name: 'conversation.session.header.utilities',
      id: 'tariff-status',
      order: 100,
    })
    expect(typeof registered?.component).toBe('function')
  })

  it('wires the /api RPC call when the connection service exists', () => {
    const calls: unknown[] = []
    const fakeConnection = {
      rpc: { call: (channel: string, method: string, payload?: unknown) => { calls.push([channel, method, payload]); return Promise.resolve({ ok: true, value: null }) } },
    }
    let registered: { entry: Record<string, unknown>; component: (props: Record<string, unknown>) => unknown } | undefined
    const ctx: any = {
      get: (name: string) => (name === 'connection' ? fakeConnection : undefined),
      slots: {
        inject: (_key: string, cb: () => unknown) => { cb(); return () => {} },
        register: (entry: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => { registered = { entry, component }; return () => {} },
      },
    }
    plugin.apply(ctx)
    const element = registered?.component({}) as { props: { api: { call: (m: string, a: unknown) => Promise<unknown> } } }
    expect(element.props.api).toBeTruthy()
    void element.props.api.call('tariff/balance')
    // payload 缺省必须显式为 null：host 的 clientRequestSchema 要求 payload
    // 字段必填，undefined 在 JSON 序列化时被丢弃会导致 bad-request。
    expect(calls).toEqual([['/api', 'tariff/balance', null]])
    void element.props.api.call('tariff/status', { force: true })
    expect(calls).toEqual([
      ['/api', 'tariff/balance', null],
      ['/api', 'tariff/status', { force: true }],
    ])
  })

  it('passes api: null when the connection service is absent', () => {
    let registered: { component: (props: Record<string, unknown>) => unknown } | undefined
    const ctx: any = {
      get: () => undefined,
      slots: {
        inject: (_key: string, cb: () => unknown) => { cb(); return () => {} },
        register: (_entry: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => { registered = { component }; return () => {} },
      },
    }
    plugin.apply(ctx)
    const element = registered?.component({}) as { props: { api: unknown } }
    expect(element.props.api).toBeNull()
  })
})
