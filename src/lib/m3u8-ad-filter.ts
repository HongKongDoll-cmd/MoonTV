/**
 * m3u8 广告分片剔除（4.7.1）。
 *
 * ## 为什么重写
 *
 * 旧实现（`play-utils.ts` 里的 `filterAdsFromM3U8`）只做一件事：
 * **删掉所有 `#EXT-X-DISCONTINUITY` 行**。广告分片一条没少，
 * 反而把「这里不连续」的语义抹掉了 —— 那正是上游说的**时间轴空洞**：
 * 播放器以为前后是连续流，实际却跳过了一段，容易出现音画不同步。
 *
 * ## 新实现
 *
 * 真正解析出分片列表，按三条规则判定广告并**整段剔除**，
 * 同时把「状态性标签」（KEY / MAP / DISCONTINUITY / PROGRAM-DATE-TIME）
 * 下沉到下一个保留的分片 —— 这几个标签作用于**后续所有分片**，
 * 跟着被删分片一起丢掉的话，后面的分片会解密失败或找不到 init 段。
 *
 * 判定规则（可分别开关）：
 * 1. **SCTE-35 广告窗**：`#EXT-X-CUE-OUT` 到 `#EXT-X-CUE-IN` 之间的分片
 * 2. **广告特征 URL**：URI 里出现 `/ad/`、`advert`、`preroll` 等特征
 * 3. **短中插块**（启发式，默认关闭）：被长内容夹住的短分片小块
 *
 * 第 3 条最容易误伤（正片片头片尾也常是短分片），所以默认关闭，
 * 由调用方显式开启。
 */

/** 单个分片 */
export interface M3u8Segment {
  /** 该分片之前的标签行（含 EXTINF / KEY / MAP / DISCONTINUITY 等） */
  tags: string[];
  /** 分片 URI（原样，未转绝对地址） */
  uri: string;
  /** 时长（秒），来自 #EXTINF；缺失时为 0 */
  duration: number;
}

/** 解析结果 */
export interface ParsedM3u8 {
  /** 第一个分片之前的标签（#EXTM3U、VERSION、TARGETDURATION 等） */
  header: string[];
  segments: M3u8Segment[];
  /** 最后一个分片之后的标签（通常是 #EXT-X-ENDLIST） */
  footer: string[];
}

/** 剔除选项 */
export interface AdFilterOptions {
  /** 按 SCTE-35 CUE-OUT / CUE-IN 剔除，默认 true */
  scte35?: boolean;
  /** 按广告特征 URL 剔除，默认 true */
  urlPattern?: boolean;
  /** 按「被长内容夹住的短中插块」剔除，默认 **false**（易误伤） */
  shortBlock?: boolean;
  /** 短分片阈值（秒），duration ≤ 此值算短分片 */
  shortSegmentMax?: number;
  /** 单个短块的最大总时长（秒） */
  shortBlockMaxTotal?: number;
  /** 单个短块的最大分片数 */
  shortBlockMaxSegments?: number;
}

/** 剔除结果 */
export interface AdFilterResult {
  /** 过滤后的 m3u8 文本 */
  content: string;
  /** 被剔除的分片数 */
  removedSegments: number;
  /** 被剔除的总时长（秒） */
  removedDuration: number;
  /** 每种规则各命中多少分片，便于排障 */
  reasons: { scte35: number; urlPattern: number; shortBlock: number };
}

const DEFAULTS = {
  scte35: true,
  urlPattern: true,
  shortBlock: false,
  shortSegmentMax: 6,
  shortBlockMaxTotal: 30,
  shortBlockMaxSegments: 6,
};

/** 广告 URL 特征。刻意用边界，避免误伤 `download`、`adapter` 这类正常词 */
const AD_URL_RE =
  /(^|[/_\-.])(ad|ads|adv|advert\w*|preroll|midroll|postroll|commercial|sponsor)\d*([/_\-.]|$|[?&#])/i;

/**
 * 文件级标签：整份播放列表共用，不属于任何单个分片。
 *
 * 刻意**不含** `#EXTINF`（那是分片自己的时长）与 `#EXT-X-DISCONTINUITY` /
 * `#EXT-X-KEY` / `#EXT-X-MAP`（这几个作用于"后续分片"，必须跟着分片走）。
 */
const FILE_LEVEL_TAG_RE =
  /^#EXTM3U|^#EXT-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|START|I-FRAMES-ONLY|ALLOW-CACHE)/i;

/** 作用于「后续所有分片」的状态性标签，删分片时要下沉 */
const STATEFUL_TAG_RE =
  /^#EXT-X-(KEY|MAP|DISCONTINUITY|PROGRAM-DATE-TIME|GAP|SESSION-KEY|SESSION-DATA)/i;

function isUriLine(line: string): boolean {
  const s = line.trim();
  return !!s && !s.startsWith('#');
}

function isStatefulTag(line: string): boolean {
  return STATEFUL_TAG_RE.test(line.trim());
}

/**
 * 把 m3u8 文本解析成 header / segments / footer。
 *
 * 只做结构性解析，不做任何判定，便于单测各条规则。
 * 兼容 CRLF；空行会被丢弃（对播放没有意义，且会让拼接结果不稳定）。
 */
export function parseM3u8Segments(content: string): ParsedM3u8 {
  const lines = (content || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');

  const header: string[] = [];
  const segments: M3u8Segment[] = [];
  let pending: string[] = [];
  let pendingDuration = 0;
  let seenSegment = false;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      // #EXTINF:<duration>,[<title>]
      const raw = line.slice('#EXTINF:'.length).split(',')[0];
      const parsed = Number.parseFloat(raw);
      pendingDuration = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      pending.push(line);
      continue;
    }

    if (isUriLine(line)) {
      /**
       * 第一个分片：它前面的标签要按类型拆开 ——
       * 文件级标签（EXTM3U / VERSION / TARGETDURATION / MEDIA-SEQUENCE…）归 header，
       * 其余（EXTINF、DISCONTINUITY、KEY、MAP）属于这个分片。
       * ⚠️ 不能按「EXTINF 之前全归 header」硬切：那样第一个分片前的
       * DISCONTINUITY 会被当成文件头丢掉，语义就变了。
       *
       * 不拆开的话 header 永远是空数组，删分片时整份播放列表会丢掉
       * TARGETDURATION 之类的必填项。
       */
      let tags = pending;
      if (!seenSegment) {
        const fileLevel: string[] = [];
        const segmentLevel: string[] = [];
        for (const l of pending) {
          if (FILE_LEVEL_TAG_RE.test(l)) fileLevel.push(l);
          else segmentLevel.push(l);
        }
        header.push(...fileLevel);
        tags = segmentLevel;
        seenSegment = true;
      }
      segments.push({
        tags,
        uri: line.trim(),
        duration: pendingDuration,
      });
      pending = [];
      pendingDuration = 0;
      continue;
    }

    pending.push(line);
  }

  // 还没归入任何分片的标签：开头算 header，结尾算 footer
  if (!seenSegment) {
    header.push(...pending);
    pending = [];
  }
  const footer = pending;

  return { header, segments, footer };
}

/** 按 SCTE-35 标记标出广告分片 */
function markScte35(segments: M3u8Segment[]): boolean[] {
  const flags = segments.map(() => false);
  let inAd = false;

  segments.forEach((seg, i) => {
    for (const tag of seg.tags) {
      if (/^#EXT-X-CUE-OUT\b/i.test(tag)) inAd = true;
      else if (/^#EXT-X-CUE-IN\b/i.test(tag)) inAd = false;
    }
    // CUE-OUT 之后、CUE-IN 之前的分片算广告；CUE-IN 所在分片已是内容
    flags[i] = inAd;
  });

  return flags;
}

/** 按 URI 特征标出广告分片 */
function markUrlPattern(segments: M3u8Segment[]): boolean[] {
  return segments.map((seg) => AD_URL_RE.test(seg.uri));
}

/**
 * 标出「被长内容夹住的短中插块」。
 *
 * 保守策略，四条同时满足才算：
 *   1. 块内每个分片都 ≤ shortSegmentMax
 *   2. 块总时长 ≤ shortBlockMaxTotal
 *   3. 块内分片数 ≤ shortBlockMaxSegments
 *   4. 块**前后都紧邻长分片**（在片头/片尾的短块不碰 —— 那多半是正片本身）
 */
function markShortBlocks(
  segments: M3u8Segment[],
  opts: Required<Pick<AdFilterOptions, 'shortSegmentMax' | 'shortBlockMaxTotal' | 'shortBlockMaxSegments'>>
): boolean[] {
  const flags = segments.map(() => false);
  const isShort = (s: M3u8Segment) =>
    s.duration > 0 && s.duration <= opts.shortSegmentMax;

  let i = 0;
  while (i < segments.length) {
    if (!isShort(segments[i])) {
      i += 1;
      continue;
    }

    // 找到连续短分片块的右边界
    let end = i;
    while (end + 1 < segments.length && isShort(segments[end + 1])) end += 1;

    const blockLen = end - i + 1;
    const totalDuration = segments
      .slice(i, end + 1)
      .reduce((sum, s) => sum + s.duration, 0);

    const hasContentBefore = i > 0 && !isShort(segments[i - 1]);
    const hasContentAfter = end + 1 < segments.length && !isShort(segments[end + 1]);

    if (
      hasContentBefore &&
      hasContentAfter &&
      blockLen <= opts.shortBlockMaxSegments &&
      totalDuration <= opts.shortBlockMaxTotal
    ) {
      for (let k = i; k <= end; k++) flags[k] = true;
    }

    i = end + 1;
  }

  return flags;
}

/** 收集所有命中广告的分片下标 → 命中原因 */
function collectAdIndexes(
  segments: M3u8Segment[],
  options: AdFilterOptions
): { flags: boolean[]; reasons: AdFilterResult['reasons'] } {
  const opts = { ...DEFAULTS, ...options };
  const reasons = { scte35: 0, urlPattern: 0, shortBlock: 0 };
  const flags = segments.map(() => false);

  const mark = (source: boolean[], key: keyof typeof reasons) => {
    source.forEach((hit, i) => {
      if (!hit) return;
      if (!flags[i]) reasons[key] += 1;
      flags[i] = true;
    });
  };

  if (opts.scte35) mark(markScte35(segments), 'scte35');
  if (opts.urlPattern) mark(markUrlPattern(segments), 'urlPattern');
  if (opts.shortBlock) {
    mark(
      markShortBlocks(segments, {
        shortSegmentMax: opts.shortSegmentMax,
        shortBlockMaxTotal: opts.shortBlockMaxTotal,
        shortBlockMaxSegments: opts.shortBlockMaxSegments,
      }),
      'shortBlock'
    );
  }

  return { flags, reasons };
}

/**
 * 剔除广告分片，返回新的 m3u8 文本。
 *
 * **没有命中任何广告时原样返回入参**（连换行符都不改），
 * 避免无谓地改动播放列表。
 */
export function filterAdSegments(
  content: string,
  options: AdFilterOptions = {}
): AdFilterResult {
  const empty: AdFilterResult = {
    content,
    removedSegments: 0,
    removedDuration: 0,
    reasons: { scte35: 0, urlPattern: 0, shortBlock: 0 },
  };
  if (!content || !/^#EXTM3U/i.test(content.trim())) return empty;

  const parsed = parseM3u8Segments(content);
  if (parsed.segments.length === 0) return empty;

  const { flags, reasons } = collectAdIndexes(parsed.segments, options);
  if (!flags.some(Boolean)) return empty;

  const out: string[] = [...parsed.header];
  /** 被删分片上的状态性标签，下沉给下一个保留分片 */
  let carry: string[] = [];
  let removedSegments = 0;
  let removedDuration = 0;

  parsed.segments.forEach((seg, i) => {
    if (flags[i]) {
      removedSegments += 1;
      removedDuration += seg.duration;
      // 只带走状态性标签：EXTINF / BYTERANGE 属于被删分片，不能跟过去
      carry.push(...seg.tags.filter(isStatefulTag));
      return;
    }
    if (carry.length > 0) {
      out.push(...carry);
      carry = [];
    }
    out.push(...seg.tags, seg.uri);
  });

  // 末尾可能还留着要下沉的标签（广告出现在片尾），接在 footer 前
  out.push(...carry);
  out.push(...parsed.footer);

  return {
    content: out.join('\n'),
    removedSegments,
    removedDuration,
    reasons,
  };
}
