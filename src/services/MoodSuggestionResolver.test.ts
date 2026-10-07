import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoodRecommendationService } from './MoodRecommendationService';
import { MoodSuggestionResolver } from './MoodSuggestionResolver';
import { YouTubeMusicService, YouTubeSearchError } from './YouTubeMusicService';

/** Minimal fake Response used by the fetch mocks. */
function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    } as unknown as Response;
}

/** Builds an OpenAI-compatible chat completion response with `content`. */
function groqResponse(content: string): Response {
    return jsonResponse({ choices: [{ message: { content } }] });
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

/** Extracts the decoded `q` parameter from a request URL. */
function queryOf(url: string): string {
    try {
        return new URL(url).searchParams.get('q') ?? '';
    } catch {
        return '';
    }
}

/** Installs a fetch mock routed by URL and returns the spy. */
function installFetchMock(
    handler: (url: string) => Response
): ReturnType<typeof vi.fn> {
    const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
    vi.stubGlobal('fetch', spy);
    return spy;
}

/** Counts how many times Groq was called. */
function groqCalls(spy: ReturnType<typeof vi.fn>): number {
    return spy.mock.calls.filter((call) => String(call[0]).includes('api.groq.com')).length;
}

/** Builds a resolver wired to real services with fake keys. */
function buildResolver(): MoodSuggestionResolver {
    return new MoodSuggestionResolver(
        new MoodRecommendationService({ apiKey: 'groq-key' }),
        new YouTubeMusicService({ apiKey: 'yt-key' }),
        'groq-key',
        'yt-key'
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('MoodSuggestionResolver', () => {
    it('discards a non-matching YouTube result and uses the next suggestion', async () => {
        const content = JSON.stringify([
            { title: 'Cancion Inexistente', artist: 'Nadie', reason: 'r1' },
            { title: 'Bohemian Rhapsody', artist: 'Queen', reason: 'r2' }
        ]);

        const fetchMock = installFetchMock((url) => {
            if (url.includes('api.groq.com')) {
                return groqResponse(content);
            }
            if (url.includes('/youtube/v3/search')) {
                const query = queryOf(url);
                if (query.includes('Bohemian')) {
                    return jsonResponse({
                        items: [
                            searchItem('vidB', 'Queen - Bohemian Rhapsody (Official Video)', 'Queen Official')
                        ]
                    });
                }
                // Unrelated result for the first suggestion.
                return jsonResponse({
                    items: [searchItem('vidX', 'Completely Different Song', 'Random Channel')]
                });
            }
            return jsonResponse({ items: [] });
        });

        const resolved = await buildResolver().next('algo triste');

        expect(resolved?.song.videoId).toBe('vidB');
        expect(resolved?.reason).toBe('r2');
        expect(groqCalls(fetchMock)).toBe(1);
    });

    it('does not repeat a video and does not call Groq again while suggestions remain', async () => {
        const content = JSON.stringify([
            { title: 'Song One', artist: 'Artist One', reason: 'r1' },
            { title: 'Song Two', artist: 'Artist Two', reason: 'r2' }
        ]);

        const fetchMock = installFetchMock((url) => {
            if (url.includes('api.groq.com')) {
                return groqResponse(content);
            }
            if (url.includes('/youtube/v3/search')) {
                const query = queryOf(url);
                if (query.includes('Song One')) {
                    return jsonResponse({
                        items: [searchItem('vid1', 'Song One - Artist One', 'Artist One')]
                    });
                }
                if (query.includes('Song Two')) {
                    return jsonResponse({
                        items: [searchItem('vid2', 'Song Two - Artist Two', 'Artist Two')]
                    });
                }
                return jsonResponse({ items: [] });
            }
            return jsonResponse({ items: [] });
        });

        const resolver = buildResolver();
        const first = await resolver.next('prompt');
        const second = await resolver.next('prompt');

        expect(first?.song.videoId).toBe('vid1');
        expect(second?.song.videoId).toBe('vid2');
        expect(second?.song.videoId).not.toBe(first?.song.videoId);
        expect(groqCalls(fetchMock)).toBe(1);
    });

    it('propagates a quota error and never returns offline catalog songs', async () => {
        installFetchMock((url) => {
            if (url.includes('api.groq.com')) {
                return groqResponse(
                    JSON.stringify([{ title: 'Song', artist: 'Artist', reason: 'r' }])
                );
            }
            if (url.includes('/youtube/v3/search')) {
                return jsonResponse(
                    { error: { errors: [{ reason: 'quotaExceeded' }] } },
                    403
                );
            }
            return jsonResponse({ items: [] });
        });

        const error = await buildResolver()
            .next('prompt')
            .catch((caught) => caught);

        expect(error).toBeInstanceOf(YouTubeSearchError);
        expect((error as YouTubeSearchError).kind).toBe('quota');
    });
});
