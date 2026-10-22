import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));
import { requestListItem } from '@/lib/request-list-item';

const calls = () => (global.fetch as any).mock.calls.map(([u, o]: [string, any]) => [u, o?.body ? JSON.parse(o.body) : null]);

describe('requestListItem', () => {
    beforeEach(() => { global.fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ volumeId: 77, year: '2013' }) })) as any; });

    it('uses the linked series volume without a lookup', async () => {
        await requestListItem({ title: 'Batman (2011) #24', issue: { series: { metadataId: '42721', metadataSource: 'COMICVINE', year: 2011 } } });
        expect(calls()).toEqual([['/api/request', expect.objectContaining({ cvId: 42721, year: '2011', issueNumber: '24', type: 'issue' })]]);
    });

    it('looks the volume up by the entry\'s issue id, and falls back to a manual GetComics request when refused', async () => {
        (global.fetch as any).mockImplementation(async (url: string) => url === '/api/request'
            ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ volumeId: 77, year: '2013' }) });
        await requestListItem({ title: 'Superman: Doomed #1', cvIssueId: 555 });
        const c = calls();
        expect(c[0][0]).toBe('/api/reading-lists/lookup-volume?issueId=555&provider=COMICVINE');
        expect(c[1][1]).toEqual(expect.objectContaining({ cvId: 77, year: '2013', issueNumber: '1' }));
        expect(c[2]).toEqual(['/api/reading-lists/manual-fallback', expect.objectContaining({ cvId: 77, searchLink: 'https://getcomics.org/?s=Superman+Doomed' })]);
    });
});
