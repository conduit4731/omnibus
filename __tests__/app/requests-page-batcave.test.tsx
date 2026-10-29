// @vitest-environment jsdom
// Fork: My Requests → "Alle … über Batcave" queues every shown request no source delivered, one entry per series;
// "Group by series" shows one row per series that expands to its issues.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ok, stubFetchRouter } from '../helpers/fetch';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

const toast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
const sessionValue = vi.hoisted(() => ({ data: { user: { id: 'admin_1', role: 'ADMIN' } }, status: 'authenticated' }));
vi.mock('next-auth/react', () => ({ useSession: () => sessionValue }));

import RequestsPage from '@/app/requests/page';

const req = (id: string, status: string, seriesName: string, volumeId: string, issueNumber: string | null) => ({
    id, status, seriesName, activeDownloadName: seriesName, volumeId, metadataSource: 'COMICVINE', issueNumber,
    createdAt: '2026-10-12T12:00:00.000Z', imageUrl: null,
});

describe('My Requests: Batcave for many at once', () => {
    let queued: any[];

    beforeEach(() => {
        toast.mockClear();
        queued = [];
        stubFetchRouter([
            ['/api/batcave/queue', (_u, init) => { queued.push(JSON.parse(String(init?.body))); return ok({ queued: 3 }); }],
            ['/api/request', () => ok([
                req('a', 'AWAITING_RELEASE', 'Batman (1940) #1', '42', null),
                req('b', 'AWAITING_RELEASE', 'Batman (1940) #2', '42', '2'),
                req('c', 'DOWNLOADING', 'Batman (1940) #3', '42', '3'),
                req('d', 'AWAITING_RELEASE', 'Steel (2011) #1', '0', '1'),
            ])],
        ]);
    });

    it('"Alle" in No source queues the shown no-source issues, one entry per series', async () => {
        await act(async () => { render(<RequestsPage />); });
        await act(async () => { fireEvent.mouseDown(screen.getByRole('tab', { name: /No source/ })); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Alle 3 angezeigten Hefte über Batcave laden' })); });

        expect(queued).toEqual([{ batch: [
            { cvId: '42', metadataSource: 'COMICVINE', issues: [{ number: '1' }, { number: '2' }] },
            { title: 'Steel (2011)', issues: [{ number: '1' }] },
        ] }]);
    });

    it('Group by series: one row per series, expands to its issues', async () => {
        await act(async () => { render(<RequestsPage />); });
        await act(async () => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }); });
        await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Group by series' })); });

        const batman = screen.getByRole('button', { name: /Batman \(1940\).*3 issues/ });
        expect(screen.queryByText('Batman (1940) #3')).toBeNull();
        await act(async () => { fireEvent.click(batman); });
        screen.getByText('Batman (1940) #3');
        // the series button leaves the downloading #3 alone
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '2 offene Hefte über Batcave laden' })); });
        expect(queued).toEqual([{ cvId: '42', metadataSource: 'COMICVINE', issues: [{ number: '1' }, { number: '2' }] }]);
    });
});
