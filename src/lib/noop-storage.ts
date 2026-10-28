/**
 * 「无存储」实现（4.8.3）。
 *
 * ## 为什么需要它
 *
 * `NEXT_PUBLIC_STORAGE_TYPE=localstorage`（或未配置时的默认值）下，
 * 数据本来存在**浏览器**里（见 `db.client.ts`），服务端不该也没有地方存。
 *
 * 但原实现是 `return null as unknown as IStorage`，于是服务端任何一次
 * `db.getAllFollowings(...)` 都会抛
 * `TypeError: Cannot read properties of null (reading 'getAllFollowings')`，
 * 接口统一变成 500。线上表现为：
 *
 *   /api/followings      500
 *   /api/today-updated   500
 *   /api/admin/subscription 500
 *
 * 而 `/api/search`、`/api/detail`、`/api/login` 因为不碰 db，一切正常 ——
 * 用户看到的是「能搜能播，但追更/今日新更一直报错」。
 *
 * ## 语义
 *
 * 用空实现代替 null 不是为了"把错误藏起来"，而是**如实表达**：
 * 「这个部署没有服务端存储」。于是
 * - 读操作返回空（`{}` / `[]` / `null`）→ 接口 200 + 空数据，前端退回本地数据
 * - 写操作静默成功 → 数据仍然只存在浏览器，与 localstorage 模式的预期一致
 *
 * ⚠️ 它**不会**掩盖真实故障：配了 d1/redis 但连不上时 storage 非 null，
 * 仍然会按原样报错。只有"确实没有服务端存储"这一种情况才走到这里。
 */

import type { IStorage } from './types';

/**
 * 按方法名推断返回的空值。
 *
 * 集中在一处，比手写 40 多个空方法更不容易漏 —— 但**必须**用测试锁住
 * 几个关键返回值（`getUserSettings` 要空数组、`verifyUser` 要 false），
 * 否则以后给 IStorage 加方法时容易返回错类型。
 */
function emptyValueFor(method: string): unknown {
  // 明确约定"不可用时返回空数组"的两个（见 IStorage 注释）
  if (method === 'getAllUsers' || method === 'getUserSettings') return [];
  if (method.startsWith('getAll')) return {};
  if (method === 'verifyUser' || method === 'checkUserExist') return false;
  if (method.startsWith('get')) return null;
  // 其余都是写入/清理类，返回 void
  return undefined;
}

/**
 * 创建一个"什么都不做、但类型完整"的存储实现。
 *
 * 用 Proxy 而不是手写 40 多个方法：IStorage 会随版本增长，
 * 手写版每次加方法都得记得补一个，漏了就是运行时 `not a function`。
 */
export function createNoopStorage(): IStorage {
  return new Proxy({} as IStorage, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      // 每个方法都是 async —— 调用方都 await，必须返回 Promise
      return async () => emptyValueFor(prop);
    },
  });
}

/** 仅供测试：暴露空值推断规则 */
export const __emptyValueFor = emptyValueFor;
