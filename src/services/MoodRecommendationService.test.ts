import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoodRecommendationService } from './MoodRecommendationService';

/** Builds an OpenAI-compatible chat completion response with `content`. */
function groqResponse(content: string): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] })
    } as unknown as Response;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('MoodRecommendationService.fetchAIRecommendations', () => {
    it('parses a fenced JSON array and discards invalid elements', async () => {
        const content =
            '```json\n' +
            '[{"title":"Cancion","artist":"Artista","reason":"ok"},' +
            '{"title":"","artist":"X"},42,"garbage"]\n```';

        vi.stubGlobal('fetch', vi.fn(async () => groqResponse(content)));

        const service = new MoodRecommendationService({ apiKey: 'key' });
        const suggestions = await service.fetchAIRecommendations('triste');

        expect(suggestions).toEqual([{ title: 'Cancion', artist: 'Artista', reason: 'ok' }]);
    });

    it('returns an empty array when there is no API key', async () => {
        const service = new MoodRecommendationService();
        await expect(service.fetchAIRecommendations('triste')).resolves.toEqual([]);
    });

    it('parses the strict json_object schema returned by Groq', async () => {
        const content =
            '{"songs":[{"title":"Cancion","artist":"Artista","reason":"porque coincide"}]}';
        vi.stubGlobal('fetch', vi.fn(async () => groqResponse(content)));

        const service = new MoodRecommendationService({ apiKey: 'key' });
        const suggestions = await service.fetchAIRecommendations('canciones de C.R.O');

        expect(suggestions).toEqual([
            { title: 'Cancion', artist: 'Artista', reason: 'porque coincide' }
        ]);
    });

    it('requests a JSON object and a multi-intent system prompt', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) => groqResponse('{"songs":[]}')
        );
        vi.stubGlobal('fetch', fetchMock);

        const service = new MoodRecommendationService({ apiKey: 'key' });
        await service.fetchAIRecommendations('rock de los 80');

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(init.body)) as {
            response_format: { type: string };
            messages: Array<{ role: string; content: string }>;
        };

        expect(body.response_format).toEqual({ type: 'json_object' });

        const system = body.messages.find((message) => message.role === 'system')!.content;
        expect(system.toUpperCase()).toContain('JSON');
        expect(system.toLowerCase()).toContain('genre');
        expect(system.toLowerCase()).toContain('artist');
    });

    it('sends the configured temperature and lists every excluded song', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) => groqResponse('{"songs":[]}')
        );
        vi.stubGlobal('fetch', fetchMock);

        const service = new MoodRecommendationService({ apiKey: 'key' });
        await service.fetchAIRecommendations('triste', undefined, [
            { title: 'Primera', artist: 'Uno', reason: '' },
            { title: 'Segunda', artist: 'Dos', reason: '' }
        ]);

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(init.body)) as {
            temperature: number;
            messages: Array<{ role: string; content: string }>;
        };

        expect(body.temperature).toBe(0.6);
        const userMessage = body.messages.find((message) => message.role === 'user')!.content;
        expect(userMessage).toContain('"Primera" by "Uno"');
        expect(userMessage).toContain('"Segunda" by "Dos"');
    });

    it('caps the suggestions at five items', async () => {
        const many = Array.from({ length: 8 }, (_, index) => ({
            title: `T${index}`,
            artist: `A${index}`,
            reason: 'r'
        }));
        vi.stubGlobal('fetch', vi.fn(async () => groqResponse(JSON.stringify(many))));

        const service = new MoodRecommendationService({ apiKey: 'key' });
        const suggestions = await service.fetchAIRecommendations('fiesta');

        expect(suggestions).toHaveLength(5);
    });
});
