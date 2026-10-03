/**
 * 设置跨设备同步（4.6.1）
 *
 * ## 为什么需要
 * 现在所有偏好都只存 localStorage（换浏览器/换设备/清缓存就全没了），
 * 而收藏、播放记录这些**数据**已经有服务端 API 兜底。
 * 所以同步的只有「偏好」这一类。
 *
 * ## 关键边界：偏好 vs 数据
 * 不是所有 localStorage key 都该同步，硬同步会出两类问题：
 *   - **数据类**（`moontv_favorites`/`moontv_play_records` 等）本来就有服务端，
 *     再同步一遍会和服务端打架，还可能把旧数据覆盖回去；
 *   - **临时类**（`test:1`、图片回退标记 `imgFallbackStep`）同步过去毫无意义。
 * 下面的 `SYNCABLE_KEYS` 是**白名单**，不在名单里的一律不同步。
 *
 * ## 冲突策略：服务端时间戳较新者胜
 * 同一个设置在两台设备上都改过时，以「最后写入的一方」为准。
 * 靠 `updatedAt` 时间戳判断，简单且可预测 —— 不做 CRDT，
 * 因为设置项都是「单值偏好」而非可合并的结构。
 */

/** 允许跨设备同步的偏好项 → 云端存储用的键名（去掉 moontv_ 前缀噪声） */
export const SYNCABLE_SETTINGS: Record<string, string> = {
  // 主题与外观
  moontv_theme_palette: 'themePalette',
  moontv_sidenav_collapsed: 'sidenavCollapsed',
  simpleMode: 'simpleMode',
  // 影库浏览偏好
  moontv_library_view: 'libraryView',
  moontv_library_sort: 'librarySort',
  // 播放偏好
  moontv_preferred_quality_height: 'preferredQualityHeight',
  moontv_preferred_playback_rate: 'preferredPlaybackRate',
  moontv_preferred_volume: 'preferredVolume',
  moontv_episode_filter: 'episodeFilter',
  moontv_danmaku_filter_rules: 'danmakuFilterRules',
  // 弹幕
  autoDanmakuEnabled: 'autoDanmakuEnabled',
  danmakuRetryCount: 'danmakuRetryCount',
  enable_blockad: 'blockAdsEnabled',
  // 搜索
  enableSearchSuggestions: 'searchSuggestions',
  defaultAggregateSearch: 'defaultAggregateSearch',
  defaultStreamSearch: 'defaultStreamSearch',
  preferredDanmakuPlatform: 'preferredDanmakuPlatform',
  doubanDataSource: 'doubanDataSource',
};

/**
 * 明确**不**同步的 key，附原因。
 *
 * 留着这份清单不是为了运行时报错，而是为了让后来人（和未来的我）
 * 看到「为什么收藏/播放记录不在名单里」，不必重新踩一遍坑。
 */
export const NON_SYNCABLE_REASONS: Record<string, string> = {
  moontv_favorites: '收藏已有服务端 API，同步会与服务端数据冲突',
  moontv_play_records: '播放记录已有服务端 API，且体量大（每集一条）',
  moontv_search_history: '搜索历史属于个人行为数据，不该跨设备',
  moontv_followings: '追更已有服务端 API',
  moontv_today_updated: '每日更新是当天的一次性缓存，换设备无意义',
  downloadTasks: '下载任务绑定本机浏览器（StreamSaver 落本地）',
  savedSources: '自定义源常含本机内网地址，跨设备未必可用',
  imgFallbackStep: '图片回退进度标记，纯运行期状态',
  imgFallbackFor: '图片回退进度标记，纯运行期状态',
  'test:1': '测试残留 key',
  moontv_intro_skip: '片头跳过按「源+集」记录，应留在本机（不同设备网盘源可能不同）',
};

/** 单个设置项的云端副本 */
export interface SyncedSetting {
  /** 云端存储的键名（见 SYNCABLE_SETTINGS 的 value） */
  key: string;
  /** 值一律存字符串：localStorage 只能存字符串，统一类型省掉转换分支 */
  value: string;
  /** 最后修改时间（毫秒） */
  updatedAt: number;
}

/** 一份设置快照 */
export interface SettingsSnapshot {
  settings: Record<string, string>;
  updatedAt: number;
}

/**
 * 从 localStorage 读出所有可同步项。
 *
 * `storage` 做成参数而不是直接摸 window —— 这样纯函数可单测，
 * 也不依赖运行环境（edge / jsdom / 浏览器都能用）。
 */
export function collectSyncableSettings(
  storage: Pick<Storage, 'getItem'>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [localKey, cloudKey] of Object.entries(SYNCABLE_SETTINGS)) {
    const value = safeGet(storage, localKey);
    if (value === null) continue;
    // 解析失败的值（比如 JSON 写坏了）跳过，别把垃圾同步上去
    if (!isValidValue(value)) continue;
    out[cloudKey] = value;
  }
  return out;
}

/** 判断一个原始字符串是否是可接受的设置值 */
export function isValidValue(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  // 空字符串通常代表「用户清空了这个设置」，不参与同步，
  // 否则会把所有设备都刷成空值。
  if (value === '') return false;
  // 过长的值基本是脏数据（正常设置都在几百字节内）
  if (value.length > 64 * 1024) return false;
  return true;
}

function safeGet(storage: Pick<Storage, 'getItem'>, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    // Safari 无痕模式等场景读 localStorage 会抛
    return null;
  }
}

/**
 * 合并本地与云端设置。
 *
 * 只有带 `updatedAt` 的云端项参与冲突判定；纯字符串 map（没有时间戳）
 * 视为「无条件覆盖」—— 那是老版本客户端上传的数据，没有时间信息可用。
 */
export function mergeSettings(
  local: Record<string, string>,
  remote: SyncedSetting[] | null,
  localUpdatedAt = 0
): { merged: Record<string, string>; changed: string[] } {
  const merged: Record<string, string> = { ...local };
  const changed: string[] = [];
  if (!remote || remote.length === 0) return { merged, changed };

  for (const item of remote) {
    if (!item || typeof item.key !== 'string' || !isValidValue(item.value)) continue;
    // 不在白名单里的远端键一律忽略（防止旧客户端/手工构造塞脏数据进来）
    if (!isKnownCloudKey(item.key)) continue;
    // 远端更旧 → 保留本地
    if (item.updatedAt && item.updatedAt < localUpdatedAt) continue;
    if (merged[item.key] === item.value) continue;
    merged[item.key] = item.value;
    changed.push(item.key);
  }
  return { merged, changed };
}

/** 云端键是否在白名单里（反向查 SYNCABLE_SETTINGS） */
export function isKnownCloudKey(cloudKey: string): boolean {
  return Object.values(SYNCABLE_SETTINGS).includes(cloudKey);
}

/**
 * 把云端设置写回 localStorage。
 * 返回真正写入的键（用于提示用户「已同步 N 项」）。
 */
export function applySettingsToStorage(
  storage: Pick<Storage, 'setItem'>,
  cloudSettings: Record<string, string>
): string[] {
  const written: string[] = [];
  for (const [cloudKey, value] of Object.entries(cloudSettings)) {
    if (!isValidValue(value)) continue;
    const localKey = findLocalKey(cloudKey);
    if (!localKey) continue;
    try {
      storage.setItem(localKey, value);
      written.push(localKey);
    } catch {
      // 无痕模式写不进去，跳过
    }
  }
  return written;
}

/** 云端键 → localStorage 键（反向查白名单） */
export function findLocalKey(cloudKey: string): string | null {
  for (const [localKey, cloud] of Object.entries(SYNCABLE_SETTINGS)) {
    if (cloud === cloudKey) return localKey;
  }
  return null;
}

/** 合并并写回的完整流程 */
export function syncSettings(opts: {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  remote: SyncedSetting[] | null;
  localUpdatedAt?: number;
}): { changed: string[]; uploaded: Record<string, string> } {
  const { storage, remote, localUpdatedAt = 0 } = opts;
  const local = collectSyncableSettings(storage);
  const { merged, changed } = mergeSettings(local, remote, localUpdatedAt);
  // 待上传 = **本地有、云端没有**的项。
  // 不能用「合并后与本地不同」来判：那只会得到被云端覆盖的项，
  // 而云端缺失的项（正是新装设备首次同步的场景）恰恰不会出现在里面，
  // 结果就是新设备的偏好永远传不上去。
  const remoteKeys = new Set(
    (remote ?? []).map((r) => (r && typeof r.key === 'string' ? r.key : ''))
  );
  const uploaded: Record<string, string> = {};
  for (const [cloudKey, value] of Object.entries(local)) {
    if (!remoteKeys.has(cloudKey)) uploaded[cloudKey] = value;
  }
  if (changed.length > 0) applySettingsToStorage(storage, Object.fromEntries(changed.map((k) => [k, merged[k]])));
  return { changed, uploaded };
}
