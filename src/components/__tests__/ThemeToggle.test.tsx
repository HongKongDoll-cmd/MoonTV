import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

function setSystemDark(dark: boolean) {
  // jsdom 不实现 matchMedia，jest.spyOn 会报 "not a function"，必须先定义
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) =>
      ({
        matches: dark,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }) as unknown as MediaQueryList,
  });
}

describe('ThemeToggle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.documentElement.classList.remove('dark');
    window.localStorage.removeItem('theme');
  });

  it('点击后 html 加上 dark 类', () => {
    setSystemDark(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const btn = screen.getByLabelText('Toggle theme');
    fireEvent.click(btn);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('暗色下点击后移除 dark 类', () => {
    setSystemDark(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    // 先确认起始态确实是暗色
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    const btn = screen.getByLabelText('Toggle theme');
    fireEvent.click(btn);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('theme')).toBe('light');
  });

  it('即使浏览器支持 startViewTransition 也不走该分支', () => {
    // 回归：曾经包了一层 startViewTransition，而 next-themes 的 setTheme 是
    // 异步写 class 的，VT 会在 class 落地前捕获快照 → 点击后主题不变。
    // jsdom 没有这个 API 所以旧测试一直是绿的，真机才暴露。
    setSystemDark(false);
    const spy = jest.fn(() => ({ finished: Promise.resolve() }));
    Object.defineProperty(document, 'startViewTransition', {
      writable: true,
      configurable: true,
      value: spy,
    });

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByLabelText('Toggle theme'));

    expect(spy).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    delete (document as unknown as { startViewTransition?: unknown })
      .startViewTransition;
  });
});
