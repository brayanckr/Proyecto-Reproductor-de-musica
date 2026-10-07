import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeMusicService, YouTubeSearchError } from './YouTubeMusicService';

/** Minimal fake Response used by the fetch mocks. */
function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    } as unknown as Response;
}

/** Builds a single YouTube search item. */
function searchItem(videoId: string, title: string, channel: string): unknown {
    return {
        id: { kind: 'youtube#video', videoId },
        snippet: {
            title,
            channelTitle: channel,
            publishedAt: '2024-01-01T00:00:00Z',
            thumbnails: { high: { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` } }
        }
    };
}

/** Installs a fetch mock routed by URL and returns the spy. */
function installFetchMock(handler: (url: string) => Response): ReturnType<typeof vi.fn> {
    const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
    vi.stubGlobal('fetch', spy);
    return spy;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('YouTubeMusicService.searchMusicStrict', () => {
    it('returns real results and never the offline catalog', async () => {
        installFetchMock((url) => {
            if (url.includes('/youtube/v3/search')) {
                return jsonResponse({ items: [searchItem('vid1', 'Real Song', 'Real Channel')] });
            }
            return jsonResponse({ items: [] });
        });

        const service = new YouTubeMusicService({ apiKey: 'key' });
        const songs = await service.searchMusicStrict('Real Song Real Channel');

        expect(songs).toHaveLength(1);
        expect(songs[0].videoId).toBe('vid1');
        expect(songs[0].title).toBe('Real Song');
    });

    it('throws an "empty" error when the search has no items', async () => {
        installFetchMock((url) =>
            url.includes('/youtube/v3/search')
                ? jsonResponse({ items: [] })
                : jsonResponse({ items: [] })
        );

        const service = new YouTubeMusicService({ apiKey: 'key' });
        await expect(service.searchMusicStrict('nothing')).rejects.toMatchObject({
            kind: 'empty'
        });
    });

    it('throws a "quota" error on 403 quotaExceeded', async () => {
        installFetchMock((url) =>
            url.includes('/youtube/v3/search')
                ? jsonResponse(
                      { error: { errors: [{ reason: 'quotaExceeded' }] } },
                      403
                  )
                : jsonResponse({ items: [] })
        );

        const service = new YouTubeMusicService({ apiKey: 'key' });
        const error = await service.searchMusicStrict('anything').catch((e) => e);
        expect(error).toBeInstanceOf(YouTubeSearchError);
        expect((error as YouTubeSearchError).kind).toBe('quota');
    });

    it('throws an "invalid_key" error when the key is rejected', async () => {
        installFetchMock((url) =>
            url.includes('/youtube/v3/search')
                ? jsonResponse({ error: { errors: [{ reason: 'keyInvalid' }] } }, 400)
                : jsonResponse({ items: [] })
        );

        const service = new YouTubeMusicService({ apiKey: 'bad' });
        await expect(service.searchMusicStrict('anything')).rejects.toMatchObject({
            kind: 'invalid_key'
        });
    });

    it('throws an "invalid_key" error when no key is configured', async () => {
        const service = new YouTubeMusicService();
        await expect(service.searchMusicStrict('anything')).rejects.toMatchObject({
            kind: 'invalid_key'
        });
    });

    it('throws a "network" error when fetch rejects', async () => {
        const spy = vi.fn(async () => {
            throw new Error('offline');
        });
        vi.stubGlobal('fetch', spy);

        const service = new YouTubeMusicService({ apiKey: 'key' });
        await expect(service.searchMusicStrict('anything')).rejects.toMatchObject({
            kind: 'network'
        });
    });
});
