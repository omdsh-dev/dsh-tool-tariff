# dsh-tool-tariff

DSH（DeepSeek Harness）插件：**峰谷电价时段查询 + DeepSeek API 余额查询 + 峰时切换提醒 + 顶部栏状态徽标**。

- `tariff` 工具：查询当前处于峰时还是谷时、完整时段表、下一次切换时刻；
- `api_balance` 工具：查询 DeepSeek API 账户余额；
- 定时提醒：每天 `08:50`、`13:50`（可配置）自动提醒"10 分钟后进入峰时"；
- **顶部栏状态徽标**（Web GUI 会话头部右侧）：实时显示 `时间 | 当前时段与切换倒计时 | 账户余额`，
  时间与倒计时每秒刷新（本地计算）；余额**不自动轮询**——点击余额徽标查询一次
  （host 侧另有 60s 缓存，频繁点击不会反复打余额接口）；数据经 `/api` RPC 走 host 侧
  （浏览器不接触 API Key）。

## 时段规则（默认）

| 时段 | 类型 |
|---|---|
| 00:00 – 09:00 | 谷时 |
| 09:00 – 12:00 | 峰时 |
| 12:00 – 14:00 | 谷时 |
| 14:00 – 18:00 | 峰时 |
| 18:00 – 24:00 | 谷时 |

边界按"到达即切换"处理（如 09:00 整点进入峰时）。提醒窗口默认
`08:50-09:00`、`13:50-14:00`（提前 10 分钟），每个窗口每天提醒一次。

## 安装（Profile Bundle，推荐）

```sh
dsh plugin --profile web add "C:/Users/autumn/Desktop/deepseekharness-test/dsh-tool-tariff"
# 一次性任务/headless 也要用时：
dsh plugin --profile headless add "C:/Users/autumn/Desktop/deepseekharness-test/dsh-tool-tariff"
```

验证已挂载：

```sh
dsh --profile web --dump-config | grep tool-tariff
```

## 使用

- 在对话中问"现在是什么时段？"或"什么时候进入峰时？"——模型会调用 `tariff` 工具；
- 问"查一下 API 余额"——模型会调用 `api_balance` 工具；
- 每天 08:50 / 13:50 自动收到峰时切换提醒（默认唤醒模型用一句话播报）。

### 余额查询的前提

需要 DeepSeek API Key。两种方式任选其一：

1. 在 DSH 设置页（模型/凭据页）配置凭据 `DEEPSEEK_API_KEY`；
2. 或导出环境变量 `DEEPSEEK_API_KEY`。

端点默认 `https://api.deepseek.com`，可用环境变量 `DEEPSEEK_BASE_URL` 覆盖
（与 DSH 内置 llm-deepseek 适配器一致）。余额结果短缓存 60 秒。

## 配置（cordis.yml / profile 该插件行的 config 字段）

全部可选：

| 字段 | 默认 | 说明 |
|---|---|---|
| `timezone` | 宿主本地时区 | IANA 时区名，如 `Asia/Shanghai` |
| `baseURL` | `$DEEPSEEK_BASE_URL` 或 `https://api.deepseek.com` | 余额查询端点 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 凭据引用名 |
| `reminderTimes` | `["08:50", "13:50"]` | 每天提醒时刻列表（HH:MM） |
| `reminderWindowMinutes` | `10` | 每个提醒的窗口长度（分钟） |
| `reminderTickMs` | `20000` | 提醒调度轮询间隔（毫秒） |
| `reminderWake` | `true` | `true` 唤醒 agent 一轮由模型播报提醒；`false` 仅注入 next-step 上下文（不产生模型调用） |
| `balanceCacheMs` | `60000` | 余额结果缓存毫秒数 |

示例（`$DSH_HOME/profiles/web/cordis.yml` 或 `--patch`）：

```yaml
plugins:
  tool-tariff:
    timezone: Asia/Shanghai
    reminderTimes: ['08:50', '13:50']
    reminderWake: true
```

## 开发

```sh
npm install        # devDependencies 自包含
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tsc 产物到 lib/
npm pack           # 可发布 tarball
```

## 结构

```
src/tariff.ts     峰谷时段纯逻辑（分类/时段表/下次切换/时区换算）
src/balance.ts    DeepSeek /user/balance 查询（可注入 fetch）
src/reminder.ts   提醒调度器（轮询窗口、每日一次、可注入时钟）
src/index.ts      插件入口：注册两个工具 + 提醒接线 + /api RPC 通道（tariff/status、tariff/balance）
client/client.js  浏览器 half（ModuleLoader bundle）：顶部栏状态徽标组件
scripts/          build 时把 client/client.js 拷贝进 lib/
tests/            逻辑测试 + 注册契约测试 + 客户端 bundle 契约测试
```

## 前端徽标说明

- 位置：会话头部（顶部栏）右侧 `conversation.session.header.utilities` 插槽，条目 id `tariff-status`；
- 内容：`[时间] [峰时/谷时 · 倒计时] [余额]`——峰时橙色、谷时绿色，倒计时精确到秒；
- 数据通道：浏览器侧经 `/api` RPC 调 host half（`tariff/status` 取时段配置与宿主时区、
  `tariff/balance` 取余额）；**API Key 只存在于 host 侧**，浏览器永不接触；
- 余额不自动轮询：点击余额徽标查询一次（host 侧另有 60s 缓存）；查询中显示"查询中…"，
  连接不可用或未配置 Key 时显示"余额不可用"（悬停可见原因），点击可重试。

## 边界说明

- 提醒的"每日一次"语义仅存在于进程内存：进程在窗口中途重启会再次触发（符合预期）；
- 提醒只投递给当前存活的顶层 agent（`ctx.agents.roots()`），没有存活 agent 时静默跳过；
- `api_balance` 依赖全局 `fetch`（Node 22+ 自带）；非官方网关若未实现
  `/user/balance` 端点，会返回明确的 HTTP 错误信息；
- 前端徽标需要重启 Web GUI 后生效（web profile 的 HMR 处于关闭状态）；
- headless profile 没有 connection 服务，RPC 通道自动跳过，其余功能不受影响。
