// dsh-tool-tariff browser half（手工编写的 ModuleLoader bundle）。
//
// 由 @deepseek-ai/dsh-client-modules 以经典脚本方式加载：本文件把插件注册进
// window.__ModuleLoader__，加载器在浏览器侧以 CJS 工厂方式物化它。
// 约束：无 import 语句（依赖一律经工厂参数 require() 解析）；组件用
// React.createElement 构建（无 JSX）；CSS 以 <style data-plugin-css> 注入。
//
// 数据通道：浏览器侧无 API Key，余额与时段配置经 /api RPC 调 host half
// （src/index.ts 里 connection.rpc.intercept 注册的 tariff/status、
// tariff/balance），本文件的 apply(ctx) 里用 ctx.get('connection') 取句柄。
//
// 显示内容（conversation.session.header.utilities 插槽，顶部栏右侧）：
//   [14:35:20] [峰时 · 3h24m] [¥2457.33]
//   时间与切换倒计时每秒刷新（本地计算）；余额不轮询——点击一次查询一次
//   （host 侧另有 60s 缓存，频繁点击不会反复打余额接口）。
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-tool-tariff",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // ---------------------------------------------------------------- 样式
    const css = [
      ".dsh-tariff-pill{display:inline-flex;align-items:center;gap:10px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap;user-select:none}",
      ".dsh-tariff-item{display:inline-flex;align-items:center;gap:4px}",
      ".dsh-tariff-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",
      ".dsh-tariff-period{font-weight:500}",
      ".dsh-tariff-peak{color:var(--dsw-alias-state-warn-primary)}",
      ".dsh-tariff-offpeak{color:var(--dsw-alias-state-success-primary)}",
      ".dsh-tariff-balance{font-variant-numeric:tabular-nums}",
      ".dsh-tariff-clickable{cursor:pointer}",
      ".dsh-tariff-clickable:hover{color:var(--dsw-alias-label-primary)}",
      ".dsh-tariff-pill[data-balance-error=true] .dsh-tariff-balance{color:var(--dsw-alias-state-error-primary)}"
    ].join("");
    const styleTagId = "@deepseek-ai/dsh-tool-tariff/status-pill.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@deepseek-ai/dsh-tool-tariff";
      tag.dataset.pluginCss = styleTagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------ 峰谷时段纯逻辑（镜像 src/tariff.ts）
    const MINUTES_PER_DAY = 24 * 60;

    function toMinutes(hhmm) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
      if (match === null) throw new Error("tariff: 非法时间 " + hhmm);
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const total = hour * 60 + minute;
      if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) throw new Error("tariff: 非法时间 " + hhmm);
      return total;
    }

    function fromMinutes(minutes) {
      const clamped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
      const hour = Math.floor(clamped / 60);
      const minute = clamped % 60;
      return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    }

    function addMinutes(hhmm, minutes) {
      return fromMinutes(toMinutes(hhmm) + minutes);
    }

    function classify(segments, hhmm) {
      const minutes = toMinutes(hhmm);
      const segment = segments.find((item) => {
        const start = toMinutes(item.start);
        const end = item.end === "24:00" ? MINUTES_PER_DAY : toMinutes(item.end);
        return minutes >= start && minutes < end;
      });
      if (segment === undefined) throw new Error("tariff: 时间 " + hhmm + " 不在任何时段内");
      return segment;
    }

    function nextSwitchOf(segments, hhmm) {
      const minutes = toMinutes(hhmm);
      const next = segments.find((item) => toMinutes(item.start) > minutes) ?? segments[0];
      const tomorrow = next === segments[0];
      const at = tomorrow ? "24:00" : next.start;
      const inMinutes = tomorrow
        ? (MINUTES_PER_DAY - minutes) + toMinutes(next.start)
        : toMinutes(next.start) - minutes;
      return { at, to: next.label, period: next.period, inMinutes, tomorrow };
    }

    function clockTimeIn(date, timezone) {
      if (timezone === undefined || timezone === null || timezone.length === 0) {
        return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
      }
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date);
      const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
      return pick("hour") + ":" + pick("minute") + ":" + pick("second");
    }

    /** 距下次切换的秒数（含秒级精度，倒计时用）。 */
    function secondsUntilSwitch(now, nextSwitch) {
      const [h, m] = nextSwitch.at === "24:00" ? [24, 0] : nextSwitch.at.split(":").map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (nextSwitch.tomorrow) target.setDate(target.getDate() + 1);
      return Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
    }

    /** 倒计时文案：>=1h 显示 XhYm，>=1m 显示 YmSs，否则显示 Xs。 */
    function countdownText(seconds) {
      if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h + "h" + String(m).padStart(2, "0") + "m";
      }
      if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m + "m" + String(s).padStart(2, "0") + "s";
      }
      return seconds + "s";
    }

    /** 币种符号映射（余额展示用）。 */
    const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€", JPY: "¥", GBP: "£" };

    function formatBalance(balance) {
      const info = Array.isArray(balance?.balance_infos) ? balance.balance_infos[0] : undefined;
      if (info === undefined) return null;
      const symbol = CURRENCY_SYMBOLS[info.currency] ?? (info.currency + " ");
      return symbol + info.total_balance;
    }

    // ---------------------------------------------------------------- 组件
    /**
     * 顶部栏右侧状态徽标：时间 | 峰谷时段与切换倒计时 | 账户余额。
     * @param props - 标准会话套件（sessionId/useSessions/...，本组件不依赖）
     *   + 自定义注入的 api（{ call(method, args) }，null 表示连接不可用）。
     */
    function TariffStatusPill(props) {
      const api = props.api;
      const [now, setNow] = react.useState(() => new Date());
      const [meta, setMeta] = react.useState(null); // { timezone, status }
      const [balance, setBalance] = react.useState(null);
      const [balanceError, setBalanceError] = react.useState(null);
      const [balanceLoading, setBalanceLoading] = react.useState(false);

      react.useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
      }, []);

      // 时段配置（segments + 时区）只在挂载时取一次；时段判定与倒计时
      // 完全在浏览器本地按秒计算。
      react.useEffect(() => {
        if (api === null) return undefined;
        let alive = true;
        api.call("tariff/status").then((result) => {
          if (alive && result.ok) setMeta(result.value);
        }).catch(() => { /* 连接暂不可用：保持上次数据 */ });
        return () => {
          alive = false;
        };
      }, [api]);

      // 余额：不自动轮询——点击一次查询一次（host 侧另有 60s 缓存，
      // 频繁点击不会反复打余额接口）。
      const loadBalance = () => {
        if (api === null || balanceLoading) return;
        setBalanceLoading(true);
        api.call("tariff/balance").then((result) => {
          if (result.ok) {
            setBalance(result.value);
            setBalanceError(null);
          } else {
            setBalanceError(result.error.message);
          }
        }).catch(() => {
          setBalanceError("连接不可用");
        }).finally(() => {
          setBalanceLoading(false);
        });
      };

      const time = clockTimeIn(now, meta === null ? undefined : meta.timezone);
      let periodNode = null;
      let countdownNode = null;
      if (meta !== null && Array.isArray(meta.status.segments)) {
        const hhmm = time.slice(0, 5);
        try {
          const current = classify(meta.status.segments, hhmm);
          const nextSwitch = nextSwitchOf(meta.status.segments, hhmm);
          const seconds = secondsUntilSwitch(now, nextSwitch);
          const peak = current.period === "peak";
          periodNode = react.createElement(
            "span",
            { className: "dsh-tariff-item dsh-tariff-period " + (peak ? "dsh-tariff-peak" : "dsh-tariff-offpeak") },
            current.label
          );
          countdownNode = react.createElement(
            "span",
            { className: "dsh-tariff-item" },
            countdownText(seconds) + "后切" + nextSwitch.to
          );
        } catch { /* 时段解析失败：只显示时间 */ }
      }
      let balanceNode = null;
      if (balanceLoading) {
        balanceNode = react.createElement(
          "span",
          { className: "dsh-tariff-item dsh-tariff-balance dsh-tariff-clickable", title: "查询中…" },
          "查询中…"
        );
      } else if (balance !== null && formatBalance(balance) !== null) {
        balanceNode = react.createElement(
          "span",
          {
            className: "dsh-tariff-item dsh-tariff-balance dsh-tariff-clickable",
            title: "点击重新查询余额",
            onClick: loadBalance,
            role: "button"
          },
          formatBalance(balance)
        );
      } else {
        balanceNode = react.createElement(
          "span",
          {
            className: "dsh-tariff-item dsh-tariff-balance dsh-tariff-clickable",
            title: balanceError ?? "点击查询余额",
            onClick: loadBalance,
            role: "button"
          },
          "余额不可用"
        );
      }

      const parts = [];
      parts.push(react.createElement("span", { className: "dsh-tariff-item dsh-tariff-time", key: "time" }, time));
      if (periodNode !== null) {
        parts.push(react.createElement(react.Fragment, { key: "period" }, periodNode));
        parts.push(react.createElement(react.Fragment, { key: "countdown" }, countdownNode));
      }
      if (balanceNode !== null) parts.push(react.createElement(react.Fragment, { key: "balance" }, balanceNode));

      return react.createElement(
        "div",
        {
          className: "dsh-tariff-pill",
          "data-balance-error": balanceError !== null ? "true" : "false",
          title: "峰谷电价时段 · 点击余额可查询"
        },
        parts
      );
    }

    // ---------------------------------------------------------------- 插件
    const plugin = {
      name: "tool-tariff-client",
      inject: ["slots"],
      /**
       * 注册顶部栏右侧状态徽标。数据经 /api RPC 从 host half 获取：
       * 余额查询在 host 侧持有 API Key，浏览器侧永不接触密钥。
       * @param ctx - 客户端 cordis 上下文。
       */
      apply(ctx) {
        const connection = ctx.get("connection");
        const api = connection === undefined || connection === null
          ? null
          : {
              // host 的 clientRequestSchema 要求 payload 字段必填（JSON 里
              // undefined 会被丢弃，导致 bad-request）——缺省参数一律显式传 null。
              call: (method, args) => connection.rpc.call("/api", method, args === undefined ? null : args)
            };
        return ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "tariff-status",
            order: 100,
            label: "峰谷·余额"
          },
          (props) => react.createElement(TariffStatusPill, Object.assign({ api }, props))
        ));
      }
    };

    module.exports = plugin;
    return module.exports;
  }
});
