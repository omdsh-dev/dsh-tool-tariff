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
import type { Context } from '@deepseek-ai/cordis';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
export declare const name = "@deepseek-ai/dsh-tool-tariff";
export declare const inject: string[];
/** 提醒消息的 provenance（merge-extensible 的 MessageSourceMap 扩展）。 */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'tariff-reminder': {
            kind: 'tariff-reminder';
        } & ContextFormed;
    }
}
/** 插件配置（cordis.yml 该行的 config 字段，全部可选）。 */
export interface TariffPluginConfig {
    /** IANA 时区名（如 'Asia/Shanghai'）；缺省宿主本地时间。 */
    timezone?: string;
    /** 余额查询端点；缺省 $DEEPSEEK_BASE_URL 或 https://api.deepseek.com。 */
    baseURL?: string;
    /** API Key 凭据引用名；缺省 'DEEPSEEK_API_KEY'。 */
    apiKeyEnv?: string;
    /** 每天触发峰时切换提醒的时刻列表 'HH:MM'；缺省 ['08:50', '13:50']。 */
    reminderTimes?: string[];
    /** 提醒窗口分钟数；缺省 10（08:50-09:00 均视为窗口内）。 */
    reminderWindowMinutes?: number;
    /** 提醒调度轮询间隔毫秒；缺省 20000。 */
    reminderTickMs?: number;
    /** true=唤醒 agent 一轮由模型播报；false=仅注入 next-step 上下文。缺省 true。 */
    reminderWake?: boolean;
    /** 余额结果缓存毫秒数；缺省 60000。 */
    balanceCacheMs?: number;
}
interface ResolvedConfig {
    timezone?: string;
    /** 配置显式指定的端点；未指定时由 apply 用环境默认值补齐。 */
    baseURL?: string;
    apiKeyEnv: string;
    reminderTimes: string[];
    reminderWindowMinutes: number;
    reminderTickMs: number;
    reminderWake: boolean;
    balanceCacheMs: number;
}
/** 归一化并校验配置（纯函数，不含环境变量；环境默认值在 apply 内解析）。 */
export declare function resolveConfig(raw?: Partial<TariffPluginConfig>): ResolvedConfig;
export declare function apply(ctx: Context, rawConfig?: Partial<TariffPluginConfig>): void;
export {};
