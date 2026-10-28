/**
 * 播放器提示队列（4.7.2）。
 *
 * 为什么不用 ArtPlayer 内置的 `art.notice.show`：它是**单条**、显示在画面
 * 左下角，后一条会直接覆盖前一条。本项目有 20 多处调用点（弹幕加载、
 * 缓存状态、自动切源、画质降级、快捷键反馈…），其中不少是**连续发生**的，
 * 比如「画质降级」紧跟着「已切到备用源」——用内置 notice 时前一条等于白提示。
 *
 * 这里做成一个独立的订阅式队列：
 * - 最新提示显示在**最上方**，旧的往下排；
 * - 同一 `key` 的提示是**更新**而不是新增（避免「缓存中 3/50」刷屏）；
 * - 最多同时 4 条，超出把最旧的挤掉；
 * - 每条带自动过期，过期的从队列里移除后，下面的自动补位。
 *
 * 与 React 解耦（不依赖任何框架），渲染交给
 * `app/play/components/PlayerNoticeStack`，便于单测。
 */

/** 提示级别，只影响配色，不改变排序 */
export type PlayerNoticeLevel = 'info' | 'warn' | 'error';

export interface PlayerNoticeItem {
  /** 内部唯一 id（同键更新时保持不变，避免 React key 抖动导致动画重播） */
  id: string;
  /** 去重键 */
  key: string;
  text: string;
  level: PlayerNoticeLevel;
  createdAt: number;
}

export interface PlayerNoticeOptions {
  /**
   * 去重键。同一个 key 的提示会**就地更新**文本并重置过期计时器，
   * 而不是堆成两条。默认用 text 本身。
   */
  key?: string;
  level?: PlayerNoticeLevel;
  /** 存活时间（毫秒），默认 {@link PLAYER_NOTICE_DURATION_MS} */
  duration?: number;
}

/** 最多同时显示的条数。再多会盖住画面，且用户根本来不及看。 */
export const PLAYER_NOTICE_MAX = 4;

/** 默认存活时间：够看完一句 20 字左右的提示，又不至于一直挡着画面 */
export const PLAYER_NOTICE_DURATION_MS = 4000;

type Listener = (items: PlayerNoticeItem[]) => void;

export class PlayerNoticeStore {
  /** 按时间升序，渲染时倒序取（最新在最上） */
  private items: PlayerNoticeItem[] = [];
  private listeners = new Set<Listener>();
  private expiry = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  getItems(): PlayerNoticeItem[] {
    return this.items;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 推入一条提示。
   *
   * @returns 该提示的 id
   */
  push(text: string, options: PlayerNoticeOptions = {}): string {
    const trimmed = text.trim();
    if (!trimmed) return '';

    const key = options.key ?? trimmed;
    const level = options.level ?? 'info';
    const duration = Math.max(500, options.duration ?? PLAYER_NOTICE_DURATION_MS);

    const existing = this.items.find((i) => i.key === key);
    if (existing) {
      // 同键：只更新文本与时间戳，id 不变（React 不会重建节点，动画不重播）
      existing.text = trimmed;
      existing.level = level;
      existing.createdAt = Date.now();
      // 更新后挪到队尾 = 最新的位置
      this.items = [...this.items.filter((i) => i.key !== key), existing];
      this.scheduleExpiry(existing.id, key, duration);
      this.emit();
      return existing.id;
    }

    const id = `pn_${++this.seq}`;
    this.items.push({ id, key, text: trimmed, level, createdAt: Date.now() });

    // 超出上限：从最旧的开始挤掉（先清它的计时器，避免回调再触发一次 emit）
    while (this.items.length > PLAYER_NOTICE_MAX) {
      const dropped = this.items.shift();
      if (dropped) this.cancelExpiry(dropped.id);
    }

    this.scheduleExpiry(id, key, duration);
    this.emit();
    return id;
  }

  /** 按 id 或 key 移除 */
  dismiss(idOrKey: string): void {
    const next = this.items.filter(
      (i) => i.id !== idOrKey && i.key !== idOrKey
    );
    if (next.length === this.items.length) return;
    for (const item of this.items) {
      if (!next.includes(item)) this.cancelExpiry(item.id);
    }
    this.items = next;
    this.emit();
  }

  /** 清空（换片、销毁播放器时调用） */
  clear(): void {
    for (const item of this.items) this.cancelExpiry(item.id);
    if (this.items.length === 0) return;
    this.items = [];
    this.emit();
  }

  private scheduleExpiry(id: string, key: string, duration: number): void {
    this.cancelExpiry(id);
    this.expiry.set(
      id,
      setTimeout(() => {
        this.expiry.delete(id);
        this.items = this.items.filter((i) => i.id !== id);
        this.emit();
        // key 不参与清理逻辑，保留形参是为了可读性
        void key;
      }, duration)
    );
  }

  private cancelExpiry(id: string): void {
    const timer = this.expiry.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.expiry.delete(id);
    }
  }

  private emit(): void {
    const snapshot = this.items;
    // 用 forEach 而不是 for...of：tsconfig 的 target 不保证支持 Set 迭代
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

/** 全局单例：播放页只有一个播放器，无需多实例 */
export const playerNotices = new PlayerNoticeStore();

/**
 * 推入一条播放器提示（便捷入口，调用点最多）。
 *
 * 用法与原 `art.notice.show = '...'` 一一对应：
 * ```ts
 * showPlayerNotice('音量: 80%');
 * showPlayerNotice('缓冲中…', { key: 'buffer', duration: 0 });
 * ```
 */
export function showPlayerNotice(
  text: string,
  options?: PlayerNoticeOptions
): string {
  return playerNotices.push(text, options);
}
