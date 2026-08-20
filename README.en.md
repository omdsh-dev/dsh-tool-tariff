# dsh-tool-tariff

[中文](README.md)

A DeepSeek Harness (DSH) plugin: **peak/off-peak electricity tariff lookup + DeepSeek API balance lookup + peak-hour switch reminders + a status badge in the top bar**.

- `tariff` tool: tells you whether the current time is a peak or off-peak period, the full tariff schedule, and when the next switch happens;
- `api_balance` tool: queries your DeepSeek API account balance;
- Scheduled reminders: automatically reminds you "peak hour starts in 10 minutes" every day at `08:50` and `13:50` (configurable);
- **Top-bar status badge** (right side of the session header in the Web GUI): shows `time | current period and countdown to the next switch | account balance`.
  Time and countdown refresh every second (computed locally); the balance is **not polled automatically** — click the balance badge to query once
  (the host side additionally caches for 60 s, so frequent clicks do not hit the balance endpoint repeatedly); data flows over the `/tariff` RPC channel to the host side
  (the browser never touches the API key).

## Tariff rules (default)

| Period | Type |
|---|---|
| 00:00 – 09:00 | Off-peak |
| 09:00 – 12:00 | Peak |
| 12:00 – 14:00 | Off-peak |
| 14:00 – 18:00 | Peak |
| 18:00 – 24:00 | Off-peak |

Boundaries switch at the exact minute (e.g. 09:00:00 enters the peak period). The reminder windows default to
`08:50-09:00` and `13:50-14:00` (10 minutes ahead); each window reminds at most once per day.

## Installation (Profile Bundle, recommended)

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-tool-tariff
# Also install for one-off tasks / headless if needed:
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-tariff
```

Verify that it is mounted:

```sh
dsh --profile web --dump-config | grep tool-tariff
```

## Usage

- Ask "what period is it right now?" or "when does the peak hour start?" — the model calls the `tariff` tool;
- Ask "check my API balance" — the model calls the `api_balance` tool;
- Every day at 08:50 / 13:50 you automatically receive a peak-hour switch reminder (by default the agent wakes for one turn to announce it in one sentence).

### Prerequisites for the balance query

A DeepSeek API key is required. Either of the following works:

1. Configure the credential `DEEPSEEK_API_KEY` in the DSH settings page (model/credentials page);
2. Or export the environment variable `DEEPSEEK_API_KEY`.

The endpoint defaults to `https://api.deepseek.com` and can be overridden with the environment variable `DEEPSEEK_BASE_URL`
(the same convention as the built-in llm-deepseek adapter). Balance results are short-cached for 60 seconds.

## Configuration (cordis.yml / the `config` field of this plugin's row in a profile)

All fields are optional:

| Field | Default | Description |
|---|---|---|
| `timezone` | host local timezone | IANA timezone name, e.g. `Asia/Shanghai` |
| `baseURL` | `$DEEPSEEK_BASE_URL` or `https://api.deepseek.com` | balance query endpoint |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | credential reference name |
| `reminderTimes` | `["08:50", "13:50"]` | daily reminder times (HH:MM) |
| `reminderWindowMinutes` | `10` | reminder window length in minutes |
| `reminderTickMs` | `20000` | reminder scheduler poll interval (ms) |
| `reminderWake` | `true` | `true` wakes the agent for one turn so the model announces the reminder; `false` only injects next-step context (no model call) |
| `balanceCacheMs` | `60000` | balance result cache duration (ms) |

Example (`$DSH_HOME/profiles/web/cordis.yml` or `--patch`):

```yaml
plugins:
  tool-tariff:
    timezone: Asia/Shanghai
    reminderTimes: ['08:50', '13:50']
    reminderWake: true
```

## Development

```sh
npm install        # self-contained devDependencies
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tsc emits to lib/
npm pack           # publishable tarball
```

## Structure

```
src/tariff.ts     Peak/off-peak period pure logic (classification / schedule / next switch / timezone conversion)
src/balance.ts    DeepSeek /user/balance query (injectable fetch)
src/reminder.ts   Reminder scheduler (window polling, once per day, injectable clock)
src/index.ts      Plugin entry: registers both tools + reminder wiring + /tariff RPC channel (status, balance)
client/client.js  Browser half (ModuleLoader bundle): top-bar status badge component
scripts/          Copies client/client.js into lib/ at build time
tests/            Logic tests + registration contract tests + client bundle contract tests
```

## Frontend badge notes

- Location: `conversation.session.header.utilities` slot on the right of the session header (top bar), entry id `tariff-status`;
- Content: `[time] [peak/off-peak · countdown] [balance]` — peak is orange, off-peak is green, countdown is second-precise;
- Data channel: the browser side calls the host half over the dedicated `/tariff` RPC channel (`status` for the period config and host timezone,
  `balance` for the balance); **the API key exists only on the host side and never reaches the browser**. Do not occupy the `/api` channel —
  it is the shared channel reserved for the DSH gateway (Typert Remotes); a third-party plugin that intercepts it silently breaks the plugin
  list, command execution, and every other Remote;
- The balance is not polled: click the balance badge to query once (the host side caches for 60 s); it shows "querying…" while in flight,
  and "balance unavailable" (hover for the reason) when the connection is down or no key is configured — click to retry.

## Edge cases

- The "once per day" reminder semantics live only in process memory: a process restart in the middle of a window will fire again (as expected);
- Reminders are only delivered to currently alive top-level agents (`ctx.agents.roots()`); if no agent is alive they are silently skipped;
- `api_balance` relies on the global `fetch` (built into Node 22+); non-official gateways that do not implement the
  `/user/balance` endpoint will return an explicit HTTP error message;
- The frontend badge takes effect after restarting the Web GUI (HMR is disabled for the web profile);
- The headless profile has no connection service, so the RPC channel is skipped automatically; everything else is unaffected.

## License

MIT
