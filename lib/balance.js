/**
 * DeepSeek API 余额查询。
 *
 * 走官方 OpenAI 兼容端点 `GET {baseURL}/user/balance`，Bearer 鉴权。
 * 纯逻辑 + 可注入 fetch，便于测试。
 *
 * @module dsh-tool-tariff/balance
 */
/**
 * 查询 DeepSeek API 账户余额。
 * @param options - 端点、密钥与可选信号。
 * @returns 标准化余额快照。
 * @throws 网络/HTTP/结构错误时抛 Error（描述可直接展示给用户）。
 */
export async function fetchBalance(options) {
    const { baseURL, apiKey, signal, fetchImpl } = options;
    const doFetch = fetchImpl ?? globalThis.fetch;
    let response;
    try {
        response = await doFetch(`${baseURL.replace(/\/+$/, '')}/user/balance`, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${apiKey}`,
                accept: 'application/json',
            },
            signal,
        });
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        throw new Error(`api_balance: 请求 ${baseURL}/user/balance 失败（${String(error instanceof Error ? error.message : error)}）`);
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        body = undefined;
    }
    if (!response.ok) {
        const detail = typeof body === 'object' && body !== null && 'error' in body
            && typeof body.error?.message === 'string'
            ? body.error.message
            : '';
        throw new Error(`api_balance: HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }
    return parseBalanceBody(body, baseURL);
}
/**
 * 解析并校验余额响应体。
 * @param body - 原始响应 JSON。
 * @param baseURL - 端点（原样回填到结果）。
 * @returns 标准化余额快照。
 * @throws 结构不符时抛 Error。
 */
export function parseBalanceBody(body, baseURL) {
    if (typeof body !== 'object' || body === null) {
        throw new Error('api_balance: 响应不是 JSON 对象');
    }
    const record = body;
    const infos = record.balance_infos;
    if (!Array.isArray(infos))
        throw new Error('api_balance: 响应缺少 balance_infos 数组');
    const balanceInfos = infos.map((item, index) => {
        if (typeof item !== 'object' || item === null)
            throw new Error(`api_balance: balance_infos[${index}] 不是对象`);
        const info = item;
        for (const field of ['currency', 'total_balance', 'granted_balance', 'topped_up_balance']) {
            if (typeof info[field] !== 'string')
                throw new Error(`api_balance: balance_infos[${index}] 缺少字符串字段 ${field}`);
        }
        return {
            currency: info.currency,
            total_balance: info.total_balance,
            granted_balance: info.granted_balance,
            topped_up_balance: info.topped_up_balance,
        };
    });
    return {
        baseURL,
        is_available: record.is_available !== false,
        balance_infos: balanceInfos,
        fetchedAt: new Date().toISOString(),
    };
}
