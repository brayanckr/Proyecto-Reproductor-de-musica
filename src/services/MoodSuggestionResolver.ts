import type { Song } from '../models/Song';
import type { AIRecommendation } from './MoodRecommendationService';
import { MoodRecommendationService } from './MoodRecommendationService';
import { YouTubeMusicService, YouTubeSearchError } from './YouTubeMusicService';

/** Maximum number of Groq batches requested per user prompt. */
const MAX_BATCHES = 2;

/** A validated suggestion: a real YouTube track plus the AI's explanation. */
export interface ResolvedSuggestion {
    song: Song;
    reason: string;
}

/** Normalizes text for fuzzy matching (lowercase, accent/punctuation-free). */
export function normalizeForMatch(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * True when the suggestion's title appears in the video title, or the suggested
 * artist appears in the video title or the channel name.
 */
export function matchesSuggestion(suggestion: AIRecommendation, song: Song): boolean {
    const title = normalizeForMatch(suggestion.title);
    const artist = normalizeForMatch(suggestion.artist);
    const videoTitle = normalizeForMatch(song.title);
    const channel = normalizeForMatch(song.artist);

    if (title.length > 0 && videoTitle.includes(title)) {
        return true;
    }
    if (artist.length > 0 && (videoTitle.includes(artist) || channel.includes(artist))) {
        return true;
    }
    return false;
}

/** Compares two suggestions by normalized title + artist. */
function sameSuggestion(a: AIRecommendation, b: AIRecommendation): boolean {
    return (
        normalizeForMatch(a.title) === normalizeForMatch(b.title) &&
        normalizeForMatch(a.artist) === normalizeForMatch(b.artist)
    );
}

/**
 * MoodSuggestionResolver
 * ----------------------
 * Bridges the Groq suggestions with the live YouTube catalog.
 *
 * It keeps a queue of pending suggestions so "Generar otra opción" consumes the
 * next one WITHOUT calling Groq again while suggestions remain. Each suggestion
 * is resolved with a single strict YouTube search and results that do not match
 * the suggestion are discarded. Quota/invalid-key errors are propagated so the
 * UI can stop and explain the reason. At most two Groq batches are requested per
 * prompt.
 */
export class MoodSuggestionResolver {
    private pending: AIRecommendation[] = [];
    private readonly shown: AIRecommendation[] = [];
    private readonly shownVideoIds = new Set<string>();
    private batches = 0;

    constructor(
        private readonly moodService: MoodRecommendationService,
        private readonly musicService: YouTubeMusicService,
        private readonly groqKey: string,
        private readonly youtubeKey: string | undefined
    ) {}

    /**
     * Returns the next validated suggestion, fetching a new Groq batch only when
     * the pending queue is empty. Throws `YouTubeSearchError` for quota/invalid
     * key failures.
     */
    public async next(prompt: string): Promise<ResolvedSuggestion | null> {
        while (this.batches < MAX_BATCHES) {
            if (this.pending.length === 0) {
                await this.requestBatch(prompt);
                if (this.pending.length === 0) {
                    return null;
                }
            }

            while (this.pending.length > 0) {
                const suggestion = this.pending.shift()!;
                this.shown.push(suggestion);

                const resolved = await this.resolveSuggestion(suggestion);
                if (resolved) {
                    return resolved;
                }
            }
        }

        return null;
    }

    /** Fetches a new Groq batch, excluding everything shown so far. */
    private async requestBatch(prompt: string): Promise<void> {
        this.batches += 1;
        const suggestions = await this.moodService.fetchAIRecommendations(
            prompt,
            this.groqKey,
            this.shown
        );

        this.pending = suggestions.filter(
            (suggestion) => !this.shown.some((shown) => sameSuggestion(shown, suggestion))
        );
    }

    /** Resolves one suggestion with a single strict YouTube search. */
    private async resolveSuggestion(
        suggestion: AIRecommendation
    ): Promise<ResolvedSuggestion | null> {
        let results: Song[];
        try {
            results = await this.musicService.searchMusicStrict(
                `${suggestion.title} ${suggestion.artist}`,
                this.youtubeKey
            );
        } catch (error) {
            if (
                error instanceof YouTubeSearchError &&
                (error.kind === 'quota' || error.kind === 'invalid_key')
            ) {
                throw error;
            }
            // Network/empty failures: skip this suggestion and try the next one.
            return null;
        }

        for (const candidate of results) {
            if (this.shownVideoIds.has(candidate.videoId)) {
                continue;
            }
            if (matchesSuggestion(suggestion, candidate)) {
                this.shownVideoIds.add(candidate.videoId);
                return { song: candidate, reason: suggestion.reason };
            }
        }

        return null;
    }
}
