/**
 * DeepSeek API 余额查询。
 *
 * 走官方 OpenAI 兼容端点 `GET {baseURL}/user/balance`，Bearer 鉴权。
 * 纯逻辑 + 可注入 fetch，便于测试。
 *
 * @module dsh-tool-tariff/balance
 */
/** 官方余额响应里的一条币种余额。 */
export interface BalanceInfo {
    readonly currency: string;
    readonly total_balance: string;
    readonly granted_balance: string;
    readonly topped_up_balance: string;
}
/** 标准化后的余额查询结果。 */
export interface BalanceResult {
    readonly baseURL: string;
    readonly is_available: boolean;
    readonly balance_infos: readonly BalanceInfo[];
    readonly fetchedAt: string;
}
export interface FetchBalanceOptions {
    /** API 端点（如 https://api.deepseek.com）。 */
    readonly baseURL: string;
    /** Bearer API Key。 */
    readonly apiKey: string;
    /** 取消信号。 */
    readonly signal?: AbortSignal;
    /** 可注入的 fetch（默认全局 fetch）。 */
    readonly fetchImpl?: typeof fetch;
}
/**
 * 查询 DeepSeek API 账户余额。
 * @param options - 端点、密钥与可选信号。
 * @returns 标准化余额快照。
 * @throws 网络/HTTP/结构错误时抛 Error（描述可直接展示给用户）。
 */
export declare function fetchBalance(options: FetchBalanceOptions): Promise<BalanceResult>;
/**
 * 解析并校验余额响应体。
 * @param body - 原始响应 JSON。
 * @param baseURL - 端点（原样回填到结果）。
 * @returns 标准化余额快照。
 * @throws 结构不符时抛 Error。
 */
export declare function parseBalanceBody(body: unknown, baseURL: string): BalanceResult;
