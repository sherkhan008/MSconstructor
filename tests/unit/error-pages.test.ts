// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/i18n/LocaleProvider';
import type { Locale } from '@/lib/i18n/locales';

/**
 * The public error boundary ([locale]/error.tsx), the public 404
 * ([locale]/not-found.tsx) and the root-layout fallback (global-error.tsx):
 * customer wording in the page's language, a way back that keeps the
 * language, and never the error itself (no message, digest or stack).
 */

const refresh = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => pathname }));
// next/font is a build-time transform; the class names do not matter here.
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));
vi.mock('@/app/globals.css', () => ({}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  pathname = '/';
});

const SECRET = 'ECONNREFUSED postgres://ms_shelving:secret@db:5432 at renderCatalog (/app/src/lib/data/db-repository.ts:42)';
const failure = Object.assign(new Error(SECRET), { digest: 'digest-1234567890' });

const links = (container: HTMLElement) => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

async function renderInLocale(locale: Locale, element: ReturnType<typeof createElement>) {
  // children arrive as createElement's third argument; the cast only satisfies its props type.
  return render(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, element));
}

describe('public error boundary', () => {
  it.each([
    ['ru', 'Что-то пошло не так', 'Повторить', ['/ru/catalog', '/ru']],
    ['kk', 'Бірдеңе дұрыс болмады', 'Қайталау', ['/catalog', '/']],
  ] as const)('%s: localized heading, retry and locale-preserving links, no diagnostics', async (locale, title, retry, hrefs) => {
    const { default: PublicPageError } = await import('@/app/[locale]/error');
    const reset = vi.fn();
    const { container, getByRole } = await renderInLocale(locale, createElement(PublicPageError, { error: failure, reset }));

    expect(getByRole('heading', { level: 1 }).textContent).toBe(title);
    expect(links(container)).toEqual(hrefs);
    expect(container.textContent).not.toContain('ECONNREFUSED');
    expect(container.textContent).not.toContain('digest-1234567890');
    expect(container.textContent).not.toContain('db-repository');

    act(() => getByRole('button', { name: retry }).click());
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('public 404', () => {
  it.each([
    ['ru', 'Страница не найдена', ['/ru/catalog', '/ru']],
    ['kk', 'Бет табылмады', ['/catalog', '/']],
  ] as const)('%s: localized heading and locale-preserving links', async (locale, title, hrefs) => {
    const { default: NotFound } = await import('@/app/[locale]/not-found');
    const { container, getByRole } = await renderInLocale(locale, createElement(NotFound));
    expect(getByRole('heading', { level: 1 }).textContent).toBe(title);
    expect(container.textContent).toContain('404');
    expect(links(container)).toEqual(hrefs);
  });
});

describe('root-layout fallback', () => {
  it.each([
    ['/ru/configurator', 'ru', 'Что-то пошло не так', ['/ru/catalog', '/ru']],
    ['/configurator', 'kk', 'Бірдеңе дұрыс болмады', ['/catalog', '/']],
    ['/admin/orders', 'ru', 'Что-то пошло не так', ['/ru/catalog', '/ru']],
  ] as const)('%s → %s, never the error itself', async (path, lang, title, hrefs) => {
    pathname = path;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: GlobalError } = await import('@/app/global-error');
    const html = renderToStaticMarkup(createElement(GlobalError, { error: failure, reset: vi.fn() }));
    expect(html).toContain(`<html lang="${lang}"`);
    expect(html).toContain(`>${title}</h1>`);
    for (const href of hrefs) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain('ECONNREFUSED');
    expect(html).not.toContain('digest-1234567890');
  });
});
