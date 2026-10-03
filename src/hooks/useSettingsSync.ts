'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SyncedSetting } from '@/lib/settings-sync';
import {
  collectSyncableSettings,
  findLocalKey,
  isValidValue,
  mergeSettings,
  SYNCABLE_SETTINGS,
} from '@/lib/settings-sync';

/** 上传防抖间隔（毫秒）——设置项常是连续拖动调值的，不防抖会打爆接口 */
const UPLOAD_DEBOUNCE = 3000;
/** 本地变更的合并窗口：这段时间内的多次写入只上传一次最终值 */
const LOCAL_CHANGE_FLUSH = 800;

export interface SettingsSyncState {
  /** 云端同步是否可用（存储类型支持 + 管理员没关） */
  enabled: boolean;
  /** 拉取阶段 */
  loading: boolean;
  /** 最近一次同步的结果，给设置页显示用 */
  lastResult: 'idle' | 'pulled' | 'pushed' | 'failed' | 'unsupported';
  /** 从云端拉回并应用的设置项数量 */
  appliedCount: number;
  /** 手动触发一次全量同步 */
  syncNow: () => Promise<void>;
  /** 清空云端副本 */
  resetCloud: () => Promise<void>;
}

/**
 * 设置跨设备同步（4.6.1）
 *
 * 策略（你确认过的「进页面拉 + 改动自动推」）：
 *   1. 进页面先探一次可用性，避免不支持时反复请求；
 *   2. 可用则拉云端副本，比本地新的就写回 localStorage 并派发事件；
 *   3. 监听 localStorage 变更（同一标签页内的写入），防抖后上传。
 *
 * ## 为什么用「事件」而不是直接改状态
 * 主题、侧边栏折叠这些设置在**各自的组件**里读 localStorage 并自己 setState，
 * 同步层去改它们的 state 做不到（跨组件）。所以写完 localStorage 后派发
 * `moontv-settings-synced` 事件，由关心的组件自己重读 —— 见 useSyncedSetting。
 */
export function useSettingsSync(): SettingsSyncState {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<SettingsSyncState['lastResult']>('idle');
  const [appliedCount, setAppliedCount] = useState(0);

  /** 本地最后一次改动的时间（毫秒），用于冲突判定 */
  const localUpdatedAtRef = useRef(0);
  const uploadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, string>>({});

  const readLocal = useCallback(() => {
    if (typeof window === 'undefined') return {};
    return collectSyncableSettings(window.localStorage);
  }, []);

  /** 把「云端没有、本地有」的项拼上时间戳后上传 */
  const upload = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const local = { ...pendingRef.current, ...readLocal() };
    pendingRef.current = {};
    if (Object.keys(local).length === 0) return;

    const now = Date.now();
    // 待上传项用「现在」作时间戳：本地刚改的本来就比云端新
    const payload: SyncedSetting[] = Object.entries(local).map(([key, value]) => ({
      key,
      value,
      updatedAt: now,
    }));
    localUpdatedAtRef.current = now;

    try {
      const res = await fetch('/api/user-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });
      setLastResult(res.ok ? 'pushed' : 'failed');
    } catch {
      // 静默失败：同步是「锦上添花」，不能因为它打断用户操作
      setLastResult('failed');
    }
  }, [readLocal]);

  /** 从云端拉取并应用 */
  const pull = useCallback(async () => {
    if (typeof window === 'undefined') return 0;
    try {
      const res = await fetch('/api/user-settings', { cache: 'no-store' });
      if (!res.ok) {
        setLastResult('failed');
        return 0;
      }
      const data = (await res.json()) as {
        enabled?: boolean;
        settings?: SyncedSetting[];
      };
      if (data.enabled === false) {
        setEnabled(false);
        setLastResult('unsupported');
        return 0;
      }

      const remote = Array.isArray(data.settings) ? data.settings : [];
      const local = readLocal();
      // 复用纯函数的合并逻辑，保证「拉」和「推」用同一套冲突规则
      const { merged, changed } = mergeSettings(
        local,
        remote,
        localUpdatedAtRef.current
      );
      if (changed.length === 0) {
        setLastResult('pulled');
        return 0;
      }

      // 只把「云端确实有的项」写回；本地独有项保持不动
      const toApply: Record<string, string> = {};
      for (const key of changed) {
        if (remote.some((r) => r.key === key)) toApply[key] = merged[key];
      }
      for (const [cloudKey, value] of Object.entries(toApply)) {
        const localKey = findLocalKey(cloudKey);
        if (!localKey) continue;
        try {
          window.localStorage.setItem(localKey, value);
        } catch {
          /* 无痕模式写不进去，忽略 */
        }
      }

      // 通知关心的组件重读（主题/侧边栏等自己管 state 的地方）
      window.dispatchEvent(
        new CustomEvent('moontv-settings-synced', { detail: toApply })
      );
      setAppliedCount(Object.keys(toApply).length);
      setLastResult('pulled');
      return Object.keys(toApply).length;
    } catch {
      setLastResult('failed');
      return 0;
    }
  }, [readLocal]);

  const syncNow = useCallback(async () => {
    await pull();
    await upload();
  }, [pull, upload]);

  const resetCloud = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/user-settings', { method: 'DELETE' });
      localUpdatedAtRef.current = 0;
      setAppliedCount(0);
      setLastResult('pulled');
    } catch {
      setLastResult('failed');
    }
  }, []);

  /* 1. 初始化：探可用性 → 拉云端 */
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (typeof window === 'undefined') return;
      try {
        const probe = await fetch('/api/user-settings?probe=1', {
          cache: 'no-store',
        });
        if (!probe.ok) {
          if (!cancelled) {
            setEnabled(false);
            setLoading(false);
            setLastResult('unsupported');
          }
          return;
        }
        const info = (await probe.json()) as {
          supported?: boolean;
          enabled?: boolean;
        };
        const ok = info.supported !== false && info.enabled !== false;
        if (cancelled) return;
        setEnabled(ok);
        if (!ok) {
          setLoading(false);
          setLastResult('unsupported');
          return;
        }
        await pull();
      } catch {
        if (!cancelled) {
          setEnabled(false);
          setLastResult('failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [pull]);

  /* 2. 监听 localStorage 变更 → 防抖上传
     storage 事件**不会**在同标签页内触发，所以还要挂一个包装：组件里改设置时
     主动派发 `moontv-settings-changed`，两边都监听才不漏。 */
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onLocalChanged = () => {
      // 合并窗口内的连续写入只记一次
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        localUpdatedAtRef.current = Date.now();
        if (uploadTimerRef.current) clearTimeout(uploadTimerRef.current);
        uploadTimerRef.current = setTimeout(() => {
          uploadTimerRef.current = null;
          void upload();
        }, UPLOAD_DEBOUNCE);
      }, LOCAL_CHANGE_FLUSH);
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key && Object.keys(SYNCABLE_SETTINGS).includes(e.key)) onLocalChanged();
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string>>).detail;
      if (detail && typeof detail === 'object') {
        pendingRef.current = { ...pendingRef.current, ...detail };
      }
      onLocalChanged();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('moontv-settings-changed', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('moontv-settings-changed', onCustom);
      if (uploadTimerRef.current) clearTimeout(uploadTimerRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [enabled, upload]);

  return { enabled, loading, lastResult, appliedCount, syncNow, resetCloud };
}

/**
 * 订阅某个设置项的云端变化。
 *
 * 同步层改了 localStorage 之后，主题色这类「自己 setState 的组件」不会自动更新，
 * 用这个 hook 让它们在同步发生时重读一次。
 *
 * @param localKey localStorage 里的键名
 * @param apply    拿到新值时怎么用（一般是 setState）
 */
export function useSyncedSetting(
  localKey: string,
  apply: (value: string) => void
): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, string>>).detail;
      if (!detail) return;
      const cloudKey = findLocalKey(localKey);
      if (cloudKey && detail[cloudKey] !== undefined && isValidValue(detail[cloudKey])) {
        apply(detail[cloudKey]);
      }
    };
    window.addEventListener('moontv-settings-synced', handler);
    return () => window.removeEventListener('moontv-settings-synced', handler);
    // apply 通常是内联的 setState 包装，故意不进依赖：
    // 否则调用方每次渲染都会重新订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localKey]);
}

/** 组件里改完设置后调它，通知同步层「我改了」 */
export function notifySettingsChanged(
  localKey: string,
  value: string
): void {
  if (typeof window === 'undefined') return;
  const cloudKey = findLocalKey(localKey);
  if (!cloudKey) return;
  window.dispatchEvent(
    new CustomEvent('moontv-settings-changed', { detail: { [cloudKey]: value } })
  );
}
