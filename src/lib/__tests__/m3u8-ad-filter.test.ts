import {
  filterAdSegments,
  parseM3u8Segments,
} from '../m3u8-ad-filter';

/** 拼一个最小可用的媒体播放列表 */
function build(segments: string[], opts: { endlist?: boolean } = {}) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-MEDIA-SEQUENCE:0',
    ...segments,
    ...(opts.endlist === false ? [] : ['#EXT-X-ENDLIST']),
    '',
  ].join('\n');
}

const seg = (dur: number, uri: string, extra: string[] = []) => [
  ...extra,
  `#EXTINF:${dur},`,
  uri,
];

describe('parseM3u8Segments', () => {
  test('分出 header / segments / footer', () => {
    const text = build([...seg(10, 'a.ts'), ...seg(10, 'b.ts')]);
    const parsed = parseM3u8Segments(text);

    expect(parsed.header).toContain('#EXTM3U');
    expect(parsed.header).toContain('#EXT-X-TARGETDURATION:10');
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toMatchObject({ uri: 'a.ts', duration: 10 });
    expect(parsed.footer).toContain('#EXT-X-ENDLIST');
  });

  test('标签归属于紧随其后的分片', () => {
    const text = build([
      ...seg(10, 'a.ts', ['#EXT-X-DISCONTINUITY']),
      ...seg(10, 'b.ts'),
    ]);
    const parsed = parseM3u8Segments(text);
    expect(parsed.segments[0].tags).toContain('#EXT-X-DISCONTINUITY');
    expect(parsed.segments[1].tags).not.toContain('#EXT-X-DISCONTINUITY');
  });

  test('兼容 CRLF', () => {
    const text = build([...seg(10, 'a.ts')]).replace(/\n/g, '\r\n');
    const parsed = parseM3u8Segments(text);
    expect(parsed.segments[0].uri).toBe('a.ts');
  });
});

describe('filterAdSegments', () => {
  test('没有广告时原样返回（连换行都不改）', () => {
    const text = build([...seg(10, 'a.ts'), ...seg(10, 'b.ts')]);
    const out = filterAdSegments(text);
    expect(out.content).toBe(text);
    expect(out.removedSegments).toBe(0);
  });

  test('SCTE-35 广告窗：CUE-OUT 到 CUE-IN 之间的分片被剔除', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts', ['#EXT-X-CUE-OUT:30']),
      ...seg(10, 'ad2.ts'),
      ...seg(10, 'content2.ts', ['#EXT-X-CUE-IN']),
      ...seg(10, 'content3.ts'),
    ]);
    const out = filterAdSegments(text);

    expect(out.removedSegments).toBe(2);
    expect(out.removedDuration).toBe(20);
    expect(out.reasons.scte35).toBe(2);
    expect(out.content).toContain('content1.ts');
    expect(out.content).not.toContain('ad1.ts');
    expect(out.content).not.toContain('ad2.ts');
    expect(out.content).toContain('content2.ts');
    expect(out.content).toContain('content3.ts');
  });

  test('CUE-OUT-CONT 也算广告窗内', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts', ['#EXT-X-CUE-OUT-CONT:10/30']),
      ...seg(10, 'content2.ts', ['#EXT-X-CUE-IN']),
    ]);
    expect(filterAdSegments(text).removedSegments).toBe(1);
  });

  test('广告特征 URL 被剔除', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'https://cdn.example.com/ad/seg1.ts'),
      ...seg(10, 'preroll_2.ts'),
      ...seg(10, 'content2.ts'),
    ]);
    const out = filterAdSegments(text);
    expect(out.removedSegments).toBe(2);
    expect(out.reasons.urlPattern).toBe(2);
  });

  test('广告 URL 规则不误伤正常文件名', () => {
    const text = build([
      ...seg(10, 'download.ts'), // 含 "ad" 但不在词边界
      ...seg(10, 'adapter-1.ts'),
      ...seg(10, 'shadows.ts'),
    ]);
    expect(filterAdSegments(text).removedSegments).toBe(0);
  });

  test('短中插块：默认关闭时不剔除', () => {
    const text = build([
      ...seg(30, 'c1.ts'),
      ...seg(3, 's1.ts'),
      ...seg(3, 's2.ts'),
      ...seg(30, 'c2.ts'),
    ]);
    expect(filterAdSegments(text).removedSegments).toBe(0);
  });

  test('短中插块：显式开启后剔除被长内容夹住的短块', () => {
    const text = build([
      ...seg(30, 'c1.ts'),
      ...seg(3, 's1.ts'),
      ...seg(3, 's2.ts'),
      ...seg(30, 'c2.ts'),
    ]);
    const out = filterAdSegments(text, { shortBlock: true });
    expect(out.removedSegments).toBe(2);
    expect(out.reasons.shortBlock).toBe(2);
    expect(out.content).not.toContain('s1.ts');
  });

  test('短中插块：片头/片尾的短分片不动（那通常是正片）', () => {
    const head = build([...seg(3, 'intro1.ts'), ...seg(3, 'intro2.ts'), ...seg(30, 'c1.ts')]);
    expect(filterAdSegments(head, { shortBlock: true }).removedSegments).toBe(0);

    const tail = build([...seg(30, 'c1.ts'), ...seg(3, 'outro1.ts'), ...seg(3, 'outro2.ts')]);
    expect(filterAdSegments(tail, { shortBlock: true }).removedSegments).toBe(0);
  });

  test('短中插块：块太长或分片太多不判定（避免误伤正片段落）', () => {
    // 总时长 60s > 阈值 30s
    const long = build([
      ...seg(30, 'c1.ts'),
      ...seg(5, 's1.ts'),
      ...seg(5, 's2.ts'),
      ...seg(5, 's3.ts'),
      ...seg(5, 's4.ts'),
      ...seg(5, 's5.ts'),
      ...seg(5, 's6.ts'),
      ...seg(5, 's7.ts'),
      ...seg(30, 'c2.ts'),
    ]);
    expect(filterAdSegments(long, { shortBlock: true }).removedSegments).toBe(0);
  });

  test('删除分片时 KEY 下沉到下一个保留分片（否则后续无法解密）', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts', ['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"']),
      ...seg(10, 'content2.ts'),
      ...seg(10, 'content3.ts'),
    ]);
    const out = filterAdSegments(text);

    expect(out.removedSegments).toBe(1);
    expect(out.content).toContain('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"');
    // KEY 必须出现在 content2 之前
    const keyIdx = out.content.indexOf('#EXT-X-KEY');
    const c2Idx = out.content.indexOf('content2.ts');
    expect(keyIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeLessThan(c2Idx);
  });

  test('删除分片时 MAP 下沉（fMP4 init 段不能丢）', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts', ['#EXT-X-MAP:URI="init.mp4"']),
      ...seg(10, 'content2.ts'),
    ]);
    const out = filterAdSegments(text);
    expect(out.content).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(out.content.indexOf('#EXT-X-MAP')).toBeLessThan(
      out.content.indexOf('content2.ts')
    );
  });

  test('被删分片的 EXTINF 不会跟到下一个分片（否则时长翻倍）', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts'),
      ...seg(10, 'content2.ts'),
    ]);
    const out = filterAdSegments(text);
    const extinfCount = (out.content.match(/#EXTINF:/g) || []).length;
    expect(extinfCount).toBe(2); // 只剩两个内容分片
  });

  test('DISCONTINUITY 标记保留（删分片后前后确实不连续）', () => {
    const text = build([
      ...seg(10, 'content1.ts'),
      ...seg(10, 'ad1.ts', ['#EXT-X-DISCONTINUITY']),
      ...seg(10, 'content2.ts'),
    ]);
    const out = filterAdSegments(text);
    expect(out.content).toContain('#EXT-X-DISCONTINUITY');
  });

  test('header 与 ENDLIST 完整保留', () => {
    const text = build([...seg(10, 'c1.ts'), ...seg(10, 'ad1.ts')]);
    const out = filterAdSegments(text);
    expect(out.content).toContain('#EXTM3U');
    expect(out.content).toContain('#EXT-X-VERSION:3');
    expect(out.content).toContain('#EXT-X-TARGETDURATION:10');
    expect(out.content).toContain('#EXT-X-ENDLIST');
  });

  test('两种规则重叠时只统计一次分片数', () => {
    const text = build([
      ...seg(10, 'c1.ts'),
      ...seg(10, 'https://x/ad/s.ts', ['#EXT-X-CUE-OUT:10']),
      ...seg(10, 'c2.ts', ['#EXT-X-CUE-IN']),
    ]);
    const out = filterAdSegments(text);
    expect(out.removedSegments).toBe(1);
  });

  test('空内容 / 非 m3u8 内容原样返回', () => {
    expect(filterAdSegments('').content).toBe('');
    expect(filterAdSegments('<html></html>').content).toBe('<html></html>');
    expect(filterAdSegments('').removedSegments).toBe(0);
  });

  test('不修改入参', () => {
    const text = build([...seg(10, 'c1.ts'), ...seg(10, 'ad1.ts', ['#EXT-X-CUE-OUT:10'])]);
    const snapshot = text;
    filterAdSegments(text);
    expect(text).toBe(snapshot);
  });
});
