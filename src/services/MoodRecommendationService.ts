/**
 * Minimal shape of an OpenAI-compatible chat completion response.
 */
interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Single track suggested by the LLM. It is intentionally provider-agnostic:
 * the caller resolves the real YouTube Music metadata (video id, thumbnail,
 * duration) through `YouTubeMusicService.searchMusic`.
 */
export interface AIRecommendation {
    /** Suggested song title. */
    title: string;
    /** Suggested artist or channel name. */
    artist: string;
    /** Short explanation of why it fits, written in Spanish. */
    reason: string;
}

/** Optional configuration for the Groq (OpenAI-compatible) integration. */
export interface MoodRecommendationConfig {
    /**
     * Primary API key used by `fetchAIRecommendation` when none is passed per
     * call. The web client injects `import.meta.env.VITE_GROQ_API_KEY` here at
     * construction time so the AI assistant works without manual input.
     */
    apiKey?: string;
    /** Chat completions endpoint (must be OpenAI-compatible). */
    endpoint?: string;
    /** Model name sent to the endpoint. */
    model?: string;
}

/** Groq chat completions endpoint (OpenAI-compatible). */
const DEFAULT_AI_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Active Groq model used by default. Overridable per instance through
 * `VITE_GROQ_MODEL`. Other currently supported Groq models include
 * `llama3-8b-8192` and `mixtral-8x7b-32768`.
 */
const DEFAULT_AI_MODEL = 'llama-3.3-70b-versatile';

/**
 * MoodRecommendationService
 * -------------------------
 * Thin client around the Groq chat completions API (OpenAI-compatible).
 *
 * It ONLY asks the LLM for a real, globally available YouTube Music track that
 * matches the user's mood or request, and returns the parsed JSON. There is no
 * local catalog, fallback array, or tag-matching logic: whenever Groq responds,
 * its suggestion is the one that is used.
 */
export class MoodRecommendationService {
    private readonly apiKey?: string;
    private readonly endpoint: string;
    private readonly model: string;

    constructor(config: MoodRecommendationConfig = {}) {
        this.apiKey = config.apiKey;
        this.endpoint = config.endpoint ?? DEFAULT_AI_ENDPOINT;
        this.model = config.model ?? DEFAULT_AI_MODEL;
    }

    /**
     * Calls Groq directly and returns up to five real track suggestions.
     *
     * The model is free to suggest any real song by any artist; no local list is
     * consulted and no fallback ever overrides the model output. When the model
     * cannot be reached (no key, network error or invalid JSON) this returns an
     * empty array so the caller can surface a clear message instead of a static
     * list.
     *
     * @param userMoodInput Mood or request text in Spanish or English.
     * @param apiKey        Optional key overriding the constructor value.
     * @param exclude       Already shown suggestions; the prompt tells the model
     *                      not to recommend any of them again.
     * @returns The parsed, validated suggestions (possibly empty).
     */
    public async fetchAIRecommendations(
        userMoodInput: string,
        apiKey?: string,
        exclude: AIRecommendation[] = []
    ): Promise<AIRecommendation[]> {
        const effectiveKey = apiKey ?? this.apiKey;
        if (!effectiveKey) {
            return [];
        }

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${effectiveKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    temperature: 0.4,
                    messages: [
                        { role: 'system', content: this.systemPrompt() },
                        { role: 'user', content: this.buildUserPrompt(userMoodInput, exclude) }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Groq API responded with status ${response.status}`);
            }

            const payload = (await response.json()) as ChatCompletionResponse;
            const content = payload.choices?.[0]?.message?.content ?? '';
            return this.parseRecommendations(content);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`[MoodRecommendationService] Groq request failed (${reason}).`);
            return [];
        }
    }

    /* ------------------------------------------------------------------ */
    /* Groq prompt + parsing                                              */
    /* ------------------------------------------------------------------ */

    /**
     * System persona and strict output contract for the Groq model.
     *
     * It pins the JSON array shape (up to five items), forces the `reason` to be
     * written in Spanish, demands real existing songs and enforces genre/language
     * fidelity, while forbidding any markdown wrapper.
     */
    private systemPrompt(): string {
        return (
            'You are an expert music curator API. You ONLY respond with raw valid JSON. ' +
            'Suggest up to 5 REAL, existing songs (never invent titles or artists) that best ' +
            'match the user request and are available on YouTube Music. Respond with ONLY a ' +
            'JSON array (no markdown, no code fences, no extra text) where every element uses ' +
            'exactly this shape: ' +
            '{"title":"Exact Song Title","artist":"Exact Artist Name",' +
            '"reason":"Explicación breve en español de por qué coincide exactamente con lo pedido."}. ' +
            'Rules: if the user asks for a specific genre (for example "reggaeton"), every song ' +
            'MUST belong to that genre; if the user asks for a specific language (for example ' +
            '"español"), every song MUST be in that language. Return only the raw JSON array.'
        );
    }

    /** Builds the user message, listing every already shown suggestion. */
    private buildUserPrompt(userMoodInput: string, exclude: AIRecommendation[]): string {
        const exclusion =
            exclude.length > 0
                ? ` Do not recommend any of these songs again: ${exclude
                      .map((entry) => `"${entry.title}" by "${entry.artist}"`)
                      .join(', ')}.`
                : '';

        return `User request: "${userMoodInput}".${exclusion}`;
    }

    /**
     * Parses the JSON array returned by Groq. Tolerates stray markdown fences
     * and discards malformed elements (missing title/artist).
     */
    private parseRecommendations(content: string): AIRecommendation[] {
        // Remove markdown code fences if the model ignored the instruction.
        const cleaned = content.replace(/```json/gi, '').replace(/```/g, '');
        const arrayMatch = /\[[\s\S]*\]/.exec(cleaned);
        if (!arrayMatch) {
            return [];
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(arrayMatch[0]);
        } catch {
            return [];
        }

        if (!Array.isArray(parsed)) {
            return [];
        }

        const suggestions: AIRecommendation[] = [];
        for (const entry of parsed) {
            if (typeof entry !== 'object' || entry === null) {
                continue;
            }

            const candidate = entry as Partial<AIRecommendation>;
            const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
            const artist = typeof candidate.artist === 'string' ? candidate.artist.trim() : '';
            const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';

            if (!title || !artist) {
                continue;
            }

            suggestions.push({
                title,
                artist,
                reason: reason || 'Sugerida por la IA según tu estado de ánimo.'
            });

            if (suggestions.length >= 5) {
                break;
            }
        }

        return suggestions;
    }
}
