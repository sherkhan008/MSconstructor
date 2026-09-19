// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WhatsAppFloatingButton } from '@/components/layout/WhatsAppFloatingButton';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('coalesces events, stops after one frame, and disables interaction on edge overlap', () => {
  const frames: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let overlap = false;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute('data-fab-avoid')
      ? { left: overlap ? 99 : 200, right: 160, top: 10, bottom: 20, width: 61, height: 10 }
      : { left: 50, right: 100, top: 0, bottom: 56, width: 50, height: 56 }) as DOMRect;
  });
  const { container } = render(createElement('div', null, createElement('button', { 'data-fab-avoid': true }), createElement(WhatsAppFloatingButton)));
  const fab = container.querySelector('a')!;
  expect(raf).not.toHaveBeenCalled();
  overlap = true;
  act(() => { window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); });
  expect(raf).toHaveBeenCalledTimes(1);
  act(() => frames.shift()!(0));
  expect(raf).toHaveBeenCalledTimes(1);
  expect(fab.getAttribute('aria-hidden')).toBe('true');
  expect(fab.tabIndex).toBe(-1);
  expect(fab.className).toContain('pointer-events-none');
  overlap = false;
  act(() => window.dispatchEvent(new Event('scroll')));
  act(() => frames.shift()!(16));
  expect(raf).toHaveBeenCalledTimes(2);
  expect(fab.getAttribute('aria-hidden')).toBe('false');
});
