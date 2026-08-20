/**
 * 峰谷电价时段纯逻辑（可测试、零依赖）。
 *
 * 时段定义（按小时边界 [start, end) 判定）：
 * - 00:00-09:00 谷时
 * - 09:00-12:00 峰时
 * - 12:00-14:00 谷时
 * - 14:00-18:00 峰时
 * - 18:00-24:00 谷时
 *
 * @module dsh-tool-tariff/tariff
 */
export type TariffPeriod = 'peak' | 'off-peak';
export interface TariffSegment {
    /** 段起始 'HH:MM'。 */
    readonly start: string;
    /** 段结束 'HH:MM'（24:00 表示午夜，属于前一天的段）。 */
    readonly end: string;
    readonly period: TariffPeriod;
    /** 中文标签：'峰时' | '谷时'。 */
    readonly label: string;
}
/** 完整时段表（顺序即一天的时间顺序）。 */
export declare const TARIFF_SEGMENTS: readonly TariffSegment[];
/** 一天 1440 分钟。 */
export declare const MINUTES_PER_DAY: number;
/**
 * 解析 'HH:MM'（0-23 时 / 0-59 分，允许 '24:00'）为分钟数。
 * @param hhmm - 'HH:MM' 字符串。
 * @returns 自午夜起的分钟数（0..1440）。
 * @throws 非法格式时抛 Error。
 */
export declare function toMinutes(hhmm: string): number;
/** 分钟数格式化为 'HH:MM'（1440 → '24:00'）。 */
export declare function fromMinutes(minutes: number): string;
/** 在 'HH:MM' 上加分钟（支持跨午夜，如 23:50 + 20 → '00:10'）。 */
export declare function addMinutes(hhmm: string, minutes: number): string;
/**
 * 判定 'HH:MM' 属于哪个时段段（按 [start, end) 边界）。
 * @param hhmm - 'HH:MM' 时间。
 * @returns 命中的时段段。
 * @throws 时间不在任何段内（理论上不会发生，防御性）。
 */
export declare function classifyTime(hhmm: string): TariffSegment;
/** 一次查询的结果快照。 */
export interface TariffStatus {
    /** 查询的时钟时间 'HH:MM'。 */
    readonly now: string;
    /** 当前所处时段。 */
    readonly current: TariffSegment;
    /** 完整时段表。 */
    readonly segments: readonly TariffSegment[];
    /** 下一次时段切换。 */
    readonly nextSwitch: {
        /** 切换时刻 'HH:MM'（跨午夜时给出 '24:00'）。 */
        readonly at: string;
        /** 切换后的时段标签（如 '峰时'）。 */
        readonly to: string;
        /** 距切换的分钟数（0..1439）。 */
        readonly inMinutes: number;
        /** 是否跨到次日。 */
        readonly tomorrow: boolean;
    };
}
/**
 * 计算某时钟时间下的峰谷状态。
 * @param hhmm - 'HH:MM' 时钟时间。
 * @returns 当前时段、完整时段表与下次切换信息。
 */
export declare function tariffStatus(hhmm: string): TariffStatus;
/**
 * 取某时刻在指定 IANA 时区（或宿主本地时区）下的 'HH:MM' 时钟时间。
 * @param at - 时刻。
 * @param timezone - 可选 IANA 时区名（如 'Asia/Shanghai'）；缺省用宿主本地时间。
 * @returns 'HH:MM'（00:00-23:59，h23 制）。
 */
export declare function clockTimeIn(at: Date, timezone?: string): string;
/** 工具入参里的 time：'HH:MM' 直接使用；ISO 时间先换算成时钟时间。 */
export declare function resolveTimeArg(time: string | undefined, timezone: string | undefined, now: () => Date): string;
