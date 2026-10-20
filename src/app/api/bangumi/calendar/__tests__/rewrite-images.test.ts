import { rewriteBangumiImageUrls } from '@/lib/bangumi-image-rewrite';

describe('rewriteBangumiImageUrls（4.6.3 服务端图片改写）', () => {
  const PREFIX = '/api/image-proxy?url=';

  test('lain.bgm.tv 的地址被改写成站内代理', () => {
    const out = rewriteBangumiImageUrls(
      { images: { large: 'https://lain.bgm.tv/pic/cover/l/abc.jpg' } },
      PREFIX
    ) as { images: { large: string } };

    expect(out.images.large).toBe(
      `${PREFIX}${encodeURIComponent('https://lain.bgm.tv/pic/cover/l/abc.jpg')}`
    );
  });

  test('递归处理嵌套的数组与对象，不假设上游结构', () => {
    const input = [
      {
        weekday: { en: 'Mon' },
        items: [
          { images: { large: 'http://lain.bgm.tv/a.jpg', grid: 'https://lain.bgm.tv/b.jpg' } },
          { images: { large: 'https://lain.bgm.tv/c.jpg' } },
        ],
      },
    ];
    const out = rewriteBangumiImageUrls(input, PREFIX) as Array<{
      items: Array<{ images: Record<string, string> }>;
    }>;

    expect(out[0].items[0].images.large).toContain('/api/image-proxy?url=');
    expect(out[0].items[0].images.grid).toContain('/api/image-proxy?url=');
    expect(out[0].items[1].images.large).toContain('/api/image-proxy?url=');
  });

  test('非 lain.bgm.tv 的字符串原样返回（标题/日期等不受影响）', () => {
    const input = {
      name: '某动画',
      air_date: '2026-01-02',
      url: 'https://bgm.tv/subject/123',
      image: 'https://lain.bgm.tv/pic/cover/l/x.jpg',
    };
    const out = rewriteBangumiImageUrls(input, PREFIX) as Record<string, string>;

    expect(out.name).toBe('某动画');
    expect(out.air_date).toBe('2026-01-02');
    expect(out.url).toBe('https://bgm.tv/subject/123');
    expect(out.image).toContain('/api/image-proxy?url=');
  });

  test('自定义代理前缀也支持（自建反代场景）', () => {
    const out = rewriteBangumiImageUrls(
      { image: 'https://lain.bgm.tv/pic/cover/l/y.jpg' },
      'https://img.example.com/fetch?url='
    ) as Record<string, string>;

    expect(out.image).toBe(
      `https://img.example.com/fetch?url=${encodeURIComponent(
        'https://lain.bgm.tv/pic/cover/l/y.jpg'
      )}`
    );
  });

  test('空前缀回退到站内默认值', () => {
    const out = rewriteBangumiImageUrls(
      { image: 'https://lain.bgm.tv/pic/cover/l/z.jpg' },
      ''
    ) as Record<string, string>;

    expect(out.image).toContain('/api/image-proxy?url=');
  });

  test('数字/布尔/null 等非字符串原样保留', () => {
    const input = { id: 42, ok: true, nothing: null, score: 7.5 };
    expect(rewriteBangumiImageUrls(input, PREFIX)).toEqual(input);
  });

  test('不修改入参（纯函数）', () => {
    const input = { image: 'https://lain.bgm.tv/a.jpg' };
    rewriteBangumiImageUrls(input, PREFIX);
    expect(input.image).toBe('https://lain.bgm.tv/a.jpg');
  });
});
