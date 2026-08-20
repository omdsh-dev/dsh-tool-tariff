/**
 * DSH 峰谷电价 + API 余额插件。
 *
 * 提供两个工具：
 * - `tariff`：查询峰谷电价时段（当前时段 / 完整时段表 / 下次切换），支持
 *   'HH:MM' 或 ISO 时间入参，默认当前时间。
 * - `api_balance`：查询 DeepSeek API 账户余额（凭据 `DEEPSEEK_API_KEY`，
 *   端点默认 https://api.deepseek.com，可用 DEEPSEEK_BASE_URL 覆盖）。
 *
 * 并内置峰时切换提醒：默认每天 08:50-09:00、13:50-14:00 各提醒一次
 * "10 分钟后进入峰时"。提醒通过 agent 的 followup（唤醒一轮，模型代为
 * 播报）或 next-step 上下文注入（不唤醒）投递到所有顶层 agent。
 *
 * 接入方式：dsh plugin --profile <name> add <本包路径>（bundle 形态，
 * cordis.patch.yml 自动挂载）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { clockTimeIn, resolveTimeArg, tariffStatus } from './tariff.js';
import { fetchBalance } from './balance.js';
import { startReminderScheduler } from './reminder.js';
export const name = '@deepseek-ai/dsh-tool-tariff';
export const inject = ['tools'];
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
const DEFAULT_REMINDER_TIMES = ['08:50', '13:50'];
const DEFAULT_REMINDER_WINDOW_MINUTES = 10;
const DEFAULT_REMINDER_TICK_MS = 20_000;
const DEFAULT_REMINDER_WAKE = true;
const DEFAULT_BALANCE_CACHE_MS = 60_000;
/** 归一化并校验配置（纯函数，不含环境变量；环境默认值在 apply 内解析）。 */
export function resolveConfig(raw = {}) {
    const reminderTimes = raw.reminderTimes === undefined || raw.reminderTimes.length === 0
        ? [...DEFAULT_REMINDER_TIMES]
        : [...raw.reminderTimes];
    for (const time of reminderTimes) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            throw new Error(`dsh-tool-tariff: 非法提醒时刻 "${time}"，应为 HH:MM（如 08:50）`);
        }
    }
    const reminderWindowMinutes = raw.reminderWindowMinutes ?? DEFAULT_REMINDER_WINDOW_MINUTES;
    if (!Number.isInteger(reminderWindowMinutes) || reminderWindowMinutes <= 0) {
        throw new Error('dsh-tool-tariff: reminderWindowMinutes 必须是正整数');
    }
    const reminderTickMs = raw.reminderTickMs ?? DEFAULT_REMINDER_TICK_MS;
    if (!Number.isInteger(reminderTickMs) || reminderTickMs <= 0) {
        throw new Error('dsh-tool-tariff: reminderTickMs 必须是正整数');
    }
    const balanceCacheMs = raw.balanceCacheMs ?? DEFAULT_BALANCE_CACHE_MS;
    if (!Number.isInteger(balanceCacheMs) || balanceCacheMs <= 0) {
        throw new Error('dsh-tool-tariff: balanceCacheMs 必须是正整数');
    }
    const apiKeyEnv = raw.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
    if (apiKeyEnv.length === 0)
        throw new Error('dsh-tool-tariff: apiKeyEnv 不能为空');
    return {
        timezone: raw.timezone,
        baseURL: raw.baseURL,
        apiKeyEnv,
        reminderTimes,
        reminderWindowMinutes,
        reminderTickMs,
        reminderWake: raw.reminderWake ?? DEFAULT_REMINDER_WAKE,
        balanceCacheMs,
    };
}
export function apply(ctx, rawConfig = {}) {
    const resolved = resolveConfig(rawConfig);
    // 端点默认：配置 > $DEEPSEEK_BASE_URL（launch 环境）> 官方端点。
    const env = launchEnvironmentOf(ctx);
    const baseURL = resolved.baseURL ?? env.get('DEEPSEEK_BASE_URL')?.value ?? DEFAULT_BASE_URL;
    const config = { ...resolved, baseURL };
    // ---- 余额（带短缓存，避免频繁打余额接口） ----
    let balanceCache;
    const getBalance = async (signal) => {
        const now = Date.now();
        if (balanceCache !== undefined && now - balanceCache.at < config.balanceCacheMs) {
            return balanceCache.value;
        }
        const credentials = ctx.get('credentials');
        const ref = credentialRef(config.apiKeyEnv);
        const hit = credentials === undefined ? undefined : await credentials.resolve(ref);
        const apiKey = hit?.value ?? env.get(config.apiKeyEnv)?.value ?? process.env[config.apiKeyEnv];
        if (apiKey === undefined || apiKey.length === 0) {
            throw new Error(`api_balance: 未找到 API Key；请在设置页配置凭据 ${config.apiKeyEnv}` +
                `（或导出环境变量 ${config.apiKeyEnv}）后重试`);
        }
        const value = await fetchBalance({ baseURL: config.baseURL, apiKey, signal });
        balanceCache = { at: now, value };
        return value;
    };
    ctx.tools.register(defineTool({
        name: 'tariff',
        description: '查询峰谷电价时段：当前处于峰时还是谷时、完整时段表、下一次时段切换时刻。' +
            '时段规则：00:00-09:00 谷时，09:00-12:00 峰时，12:00-14:00 谷时，14:00-18:00 峰时，18:00-24:00 谷时。' +
            'time 可选：HH:MM（如 08:30，按配置时区解释）或 ISO 8601 时间戳，缺省当前时间。',
        parameters: {
            time: {
                type: 'string',
                description: '可选。HH:MM 或 ISO 8601 时间戳，缺省当前时间。',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: (args) => {
            const hhmm = resolveTimeArg(args.time, config.timezone, () => new Date());
            return Promise.resolve(tariffStatus(hhmm));
        },
        timeoutMs: 1000,
    }));
    ctx.tools.register(defineTool({
        name: 'api_balance',
        description: '查询 DeepSeek API 账户余额（is_available 与各币种余额）。' +
            '需要已配置凭据 DEEPSEEK_API_KEY（或用 apiKeyEnv 指定的凭据）。' +
            '结果短缓存约 1 分钟，不会每次调用都打余额接口。',
        parameters: {},
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (_args, exec) => {
            const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(15_000)]);
            const value = await getBalance(signal);
            return value;
        },
        timeoutMs: 16_000,
    }));
    // ---- Web UI 数据通道（browser half 经专用 /tariff RPC 通道读取） ----
    // 注意：`/api` 是 DSH 网关（Typert Remote）独占的共享通道，第三方插件
    // 不可 intercept('/api')，否则会抢占网关注册、静默弄坏插件列表/命令等
    // 所有 Remote。正确做法是 rpc.handle() 注册自己的通道前缀。
    // connection 服务只存在于 web 类 profile（headless 没有）；用 ctx.inject
    // 延迟挂载：服务可用时才注册通道，服务消失时自动卸载。
    ctx.inject(['connection'], (scopedCtx) => {
        const connection = scopedCtx.connection;
        const handler = async (endpoint, _payload, signal) => {
            try {
                switch (endpoint) {
                    case 'status': {
                        const hhmm = clockTimeIn(new Date(), config.timezone);
                        return { ok: true, value: { timezone: config.timezone ?? null, status: tariffStatus(hhmm) } };
                    }
                    case 'balance': {
                        const value = await getBalance(signal);
                        return { ok: true, value };
                    }
                    default:
                        return rpcError(`tariff: 未知端点 ${endpoint}`);
                }
            }
            catch (error) {
                return rpcError(error instanceof Error ? error.message : String(error));
            }
        };
        const dispose = connection.rpc.handle('/tariff', handler, { authority: 'loopback' });
        scopedCtx.effect(() => dispose, 'dsh-tool-tariff: /tariff RPC 通道');
    });
    // ---- 峰时切换提醒 ----
    const agents = ctx.get('agents');
    if (agents !== undefined) {
        const deliverReminder = (time) => {
            const hhmm = clockTimeIn(new Date(), config.timezone);
            const status = tariffStatus(hhmm);
            const { nextSwitch } = status;
            const ahead = nextSwitch.inMinutes > 0 ? `${nextSwitch.inMinutes} 分钟后（${nextSwitch.at}）` : `即将（${nextSwitch.at}）`;
            const price = nextSwitch.to === '峰时' ? '电价上涨' : '电价下降';
            const text = config.reminderWake
                ? `【峰谷电价提醒】${ahead}进入${nextSwitch.to}（${price}）。当前时段：${status.current.label}。请用一句话简要提醒用户。`
                : `【峰谷电价提醒】${ahead}进入${nextSwitch.to}（${price}）。当前时段：${status.current.label}。`;
            const summary = `峰时切换提醒：${nextSwitch.at} 进入${nextSwitch.to}`;
            for (const agent of agents.roots()) {
                const message = createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'tariff-reminder', form: 'notice', summary },
                });
                if (config.reminderWake) {
                    agent.followup(message);
                }
                else {
                    agent.inbox.prepend('next-step', message);
                }
            }
        };
        const scheduler = startReminderScheduler({
            timezone: config.timezone,
            reminderTimes: config.reminderTimes,
            reminderWindowMinutes: config.reminderWindowMinutes,
            tickMs: config.reminderTickMs,
            onFire: (time) => {
                deliverReminder(time);
            },
        });
        ctx.effect(() => () => scheduler.dispose());
    }
}
/** 构造一个 RpcResult 错误分支（code 用兜底的 internal）。 */
function rpcError(message) {
    return { ok: false, error: { code: 'internal', message, details: {} } };
}
