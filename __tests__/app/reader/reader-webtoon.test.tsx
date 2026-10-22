// @vitest-environment jsdom
// Fork: webtoon mode tracks the page in view, offers end-of-issue buttons, and an unmark on the last page sticks.
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReaderPage from '@/app/reader/page';

vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams('?path=/comics/S/s-001.cbz&series=/comics/S'),
    useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { role: 'USER' } } }) }));
vi.mock('localforage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as any;
window.HTMLElement.prototype.scrollIntoView = vi.fn();

let observed: { cb: IntersectionObserverCallback, els: Element[] } | null = null;
global.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) { observed = { cb, els: [] }; }
    observe(el: Element) { observed!.els.push(el); }
    disconnect() {}
    unobserve() {}
} as any;

const progressPosts = () => (global.fetch as any).mock.calls
    .filter(([u, o]: [string, any]) => u === '/api/progress' && o?.method === 'POST').map(([, o]: [string, any]) => JSON.parse(o.body));

function mockApi(isCompleted: boolean) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/reader/pages')) return Promise.resolve({ ok: true, json: async () => ({ pages: ['1.jpg', '2.jpg', '3.jpg'] }) });
        if (url.includes('/api/progress?')) return Promise.resolve({ ok: true, json: async () => ({ currentPage: 0, isCompleted, bookmarks: [], issueId: 'i1' }) });
        if (url.includes('/api/library/series')) return Promise.resolve({ ok: true, json: async () => ({ id: 's1', isManga: false, downloadedIssues: [] }) });
        if (url.includes('/api/reader/preferences')) return Promise.resolve({ ok: true, json: async () => ({ settings: { readingMode: 'webtoon' } }) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
}

async function scrollTo(page: number) {
    await waitFor(() => expect(observed?.els.length).toBe(3), { timeout: 3000 });
    act(() => observed!.cb([{ isIntersecting: true, boundingClientRect: { height: 800 }, target: observed!.els[page] } as any], {} as any));
}

describe('Reader webtoon mode (fork)', () => {
    beforeEach(() => { observed = null; });

    it('saves the page scrolled into view and shows the end-of-issue buttons', async () => {
        mockApi(false);
        render(<ReaderPage />);
        await scrollTo(1);
        await waitFor(() => expect(progressPosts()).toContainEqual(expect.objectContaining({ currentPage: 1, keepCompleted: true })), { timeout: 3000 });
        expect(screen.getByText('Mark as read & back to series')).toBeInTheDocument();
    });

    it('a not-yet-loaded page (no height) never becomes the current page', async () => {
        mockApi(false);
        render(<ReaderPage />);
        await waitFor(() => expect(observed?.els.length).toBe(3), { timeout: 3000 });
        act(() => observed!.cb([{ isIntersecting: true, boundingClientRect: { height: 0 }, target: observed!.els[2] } as any], {} as any));
        await new Promise(r => setTimeout(r, 1800));
        expect(progressPosts().some((p: any) => p.currentPage === 2)).toBe(false);
    });

    it('"Mark as unread" right on reaching the last page is not undone by the pending page save', async () => {
        mockApi(true);
        render(<ReaderPage />);
        await waitFor(() => expect(screen.getByText('Mark as unread')).toBeInTheDocument(), { timeout: 3000 });
        await scrollTo(2);
        (global.fetch as any).mockClear();
        fireEvent.click(screen.getByText('Mark as unread'));   // within the 1.5 s before the page save fires
        await new Promise(r => setTimeout(r, 1800));
        expect(progressPosts()).toEqual([{ filePath: '/comics/S/s-001.cbz', currentPage: 0, totalPages: 3 }]);
    });
});
