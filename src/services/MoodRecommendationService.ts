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

/**
 * Strict JSON object schema requested from Groq via `response_format:
 * { type: 'json_object' }`. Wrapping the list in an object (instead of a bare
 * array) is required by the JSON mode and keeps parsing deterministic.
 */
export interface AIRecommendationPayload {
    songs: AIRecommendation[];
}

/** Optional configuration for the Groq (OpenAI-compatible) integration. */
export interface MoodRecommendationConfig {
    /**
     * Primary API key used by `fetchAIRecommendations` when none is passed per
     * call. The web client injects `import.meta.env.VITE_GROQ_API_KEY` here at
     * construction time so the AI assistant works without manual input.
     */
    apiKey?: string;
    /** Chat completions endpoint (must be OpenAI-compatible). */
    endpoint?: string;
    /** Model name sent to the endpoint. */
    model?: string;
    /** Sampling temperature; higher values diversify the suggestions. */
    temperature?: number;
}

/** Groq chat completions endpoint (OpenAI-compatible). */
const DEFAULT_AI_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Active Groq model used by default. Overridable per instance through
 * `VITE_GROQ_MODEL`. `llama-3.3-70b-versatile` is fast and supports JSON mode.
 */
const DEFAULT_AI_MODEL = 'llama-3.3-70b-versatile';

/**
 * Default sampling temperature. Slightly above 0 keeps the curation lively
 * while JSON mode guarantees a machine-parseable answer.
 */
const DEFAULT_AI_TEMPERATURE = 0.6;

/** Hard cap on how many suggestions are accepted from a single response. */
const MAX_SUGGESTIONS = 5;

/** Object keys the model may use for the suggestions array. */
const SUGGESTION_KEYS = ['songs', 'recommendations', 'results', 'tracks', 'items'] as const;

/**
 * MoodRecommendationService
 * -------------------------
 * Thin client around the Groq chat completions API (OpenAI-compatible).
 *
 * It interprets ANY music request (mood, genre/style/era, activity, artist or
 * free description), asks the LLM for real YouTube Music tracks and returns the
 * parsed JSON. There is no local catalog, fallback array, or tag-matching
 * logic: whenever Groq responds, its suggestion is the one that is used.
 */
export class MoodRecommendationService {
    private readonly apiKey?: string;
    private readonly endpoint: string;
    private readonly model: string;
    private readonly temperature: number;

    constructor(config: MoodRecommendationConfig = {}) {
        this.apiKey = config.apiKey;
        this.endpoint = config.endpoint ?? DEFAULT_AI_ENDPOINT;
        this.model = config.model ?? DEFAULT_AI_MODEL;
        this.temperature = config.temperature ?? DEFAULT_AI_TEMPERATURE;
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
     * @param userMoodInput Mood, genre, era, activity, artist or description.
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
        const request = userMoodInput.trim();
        if (!effectiveKey || !request) {
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
                    temperature: this.temperature,
                    // Guarantees the model emits a single parseable JSON object.
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: this.systemPrompt() },
                        { role: 'user', content: this.buildUserPrompt(request, exclude) }
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
     * It classifies the request into mood, genre/style/era/activity or
     * artist/description and always responds with a single JSON object holding
     * up to five real songs, each with a Spanish `reason`. Mentioning "JSON" is
     * mandatory for `response_format: json_object` to be accepted.
     */
    private systemPrompt(): string {
        return (
            'You are the music-intelligence engine of "UCCplay", an expert music curator. ' +
            'Interpret ANY music request, not only moods. Classify the user intent and act: ' +
            '(1) MOOD/EMOTION (e.g. "estoy triste", "feel energetic"): pick songs that match that emotional state. ' +
            '(2) GENRE / STYLE / ERA / ACTIVITY (e.g. "rock de los 80", "hip hop argentino", ' +
            '"música para programar", "workout music"): filter and suggest songs that strictly belong to ' +
            'that genre/subgenre, decade, country or use case. ' +
            '(3) ARTIST / FREE DESCRIPTION (e.g. "canciones de C.R.O", "temas parecidos a Coldplay"): ' +
            'return the closest real tracks by that artist or matching that description. ' +
            'Rules: suggest REAL, existing songs available on YouTube Music and never invent titles, ' +
            'artists, albums or years; respect every explicit constraint (genre, language, decade, country, ' +
            'activity) in each suggestion; keep each "reason" short and in SPANISH. ' +
            `Return between 1 and ${MAX_SUGGESTIONS} songs (fewer is fine when unsure). ` +
            'OUTPUT FORMAT (strict): respond with ONLY one valid JSON object, no markdown and no extra text, ' +
            'using exactly this schema: ' +
            '{"songs":[{"title":"Exact Song Title","artist":"Exact Artist Name","reason":"Motivo breve en español"}]}'
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

        return (
            `Music request: "${userMoodInput}". Identify the intent ` +
            `(mood, genre/style/era/activity, or artist/description) and return the JSON object ` +
            `with the best matching real songs.${exclusion}`
        );
    }

    /**
     * Parses the JSON returned by Groq. Tolerates stray markdown fences, a bare
     * array (legacy) or the strict `{ "songs": [...] }` object, and discards
     * malformed elements (missing title/artist).
     */
    private parseRecommendations(content: string): AIRecommendation[] {
        const rawEntries = this.extractEntries(content);
        const suggestions: AIRecommendation[] = [];

        for (const entry of rawEntries) {
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
                reason: reason || 'Sugerida por la IA según tu búsqueda.'
            });

            if (suggestions.length >= MAX_SUGGESTIONS) {
                break;
            }
        }

        return suggestions;
    }

    /** Extracts the suggestions array from any tolerated response shape. */
    private extractEntries(content: string): unknown[] {
        const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        if (!cleaned) {
            return [];
        }

        const parsed =
            this.tryParse(cleaned) ?? this.tryParse(this.extractJsonBlock(cleaned));

        if (Array.isArray(parsed)) {
            return parsed;
        }

        if (parsed !== null && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            const key = SUGGESTION_KEYS.find((candidate) => Array.isArray(record[candidate]));
            if (key) {
                return record[key] as unknown[];
            }
        }

        return [];
    }

    /** Parses JSON, returning null instead of throwing on malformed input. */
    private tryParse(value: string | null): unknown {
        if (!value) {
            return null;
        }

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    /**
     * Falls back to the outermost JSON object or array embedded in the text,
     * used only when the raw content is not valid JSON on its own.
     */
    private extractJsonBlock(text: string): string | null {
        const objectMatch = /\{[\s\S]*\}/.exec(text);
        if (objectMatch) {
            return objectMatch[0];
        }

        const arrayMatch = /\[[\s\S]*\]/.exec(text);
        return arrayMatch ? arrayMatch[0] : null;
    }
}
