import { Song } from '../models/Song';

/** Base endpoint for the YouTube Data API v3 search resource. */
const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

/** Base endpoint for the YouTube Data API v3 videos resource (used for durations). */
const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

/** YouTube category 10 corresponds to "Music". */
const MUSIC_CATEGORY_ID = '10';

/** Suffix appended to every query to bias results toward official audio uploads. */
const OFFICIAL_AUDIO_SUFFIX = 'official audio music';

/** Maximum number of search results requested per call. */
const MAX_RESULTS = '10';

/* -------------------------------------------------------------------------- */
/* YouTube Data API v3 response shapes (only the fields we consume)           */
/* -------------------------------------------------------------------------- */

interface YouTubeThumbnail {
    url: string;
    width?: number;
    height?: number;
}

interface YouTubeSearchSnippet {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
        default?: YouTubeThumbnail;
        medium?: YouTubeThumbnail;
        high?: YouTubeThumbnail;
    };
}

interface YouTubeSearchItem {
    id: { kind: string; videoId?: string };
    snippet: YouTubeSearchSnippet;
}

interface YouTubeSearchResponse {
    items?: YouTubeSearchItem[];
}

interface YouTubeVideoItem {
    id: string;
    contentDetails?: { duration?: string };
}

interface YouTubeVideosResponse {
    items?: YouTubeVideoItem[];
}

/**
 * YouTubeMusicService
 * -------------------
 * Handles YouTube Music search and metadata fetching for the player.
 *
 * Behaviour:
 * - Always appends "official audio music" to the query so official uploads rank first.
 * - When an API key is supplied, queries the YouTube Data API v3
 *   search endpoint filtered to the Music category (`videoCategoryId=10`),
 *   then enriches results with real track durations.
 * - When no key is supplied (or the request fails), it serves a curated
 *   offline catalog so the application works out-of-the-box.
 */
/** Reasons a strict YouTube search can fail (surfaced to the UI in Spanish). */
export type YouTubeSearchErrorKind = 'quota' | 'invalid_key' | 'network' | 'empty';

/**
 * Typed error thrown by `searchMusicStrict`. Unlike `searchMusic`, the strict
 * variant never falls back to the offline catalog, so the caller can decide
 * exactly what to show the user.
 */
export class YouTubeSearchError extends Error {
    public readonly kind: YouTubeSearchErrorKind;

    constructor(kind: YouTubeSearchErrorKind, message: string) {
        super(message);
        this.name = 'YouTubeSearchError';
        this.kind = kind;
    }
}

/** Optional configuration for the service. */
export interface YouTubeMusicServiceConfig {
    /**
     * Default YouTube Data API v3 key. The web client injects
     * `import.meta.env.VITE_YOUTUBE_API_KEY` here at construction time so live
     * search works without manual input. A per-call key still takes priority.
     */
    apiKey?: string;
}

export class YouTubeMusicService {
    /** Key applied when no per-call key is provided (e.g. from `.env`). */
    private readonly defaultApiKey?: string;

    constructor(config: YouTubeMusicServiceConfig = {}) {
        this.defaultApiKey = config.apiKey;
    }

    /**
     * Offline fallback catalog of popular YouTube Music tracks.
     * Every `id` is a real YouTube Video ID; artwork is derived from the
     * standard YouTube thumbnail CDN so no extra requests are required.
     */
    private readonly fallbackCatalog: Song[] = [
        this.buildCatalogSong('4NRXx6U8ABQ', 'Blinding Lights', 'The Weeknd', 200, ['happy', 'energetic', 'synthwave']),
        this.buildCatalogSong('XXYlFuWEuKI', 'Save Your Tears', 'The Weeknd', 215, ['chill', 'synthwave']),
        this.buildCatalogSong('7wtfhZwyrcc', 'Believer', 'Imagine Dragons', 204, ['energetic', 'rock']),
        this.buildCatalogSong('fKopy74weus', 'Thunder', 'Imagine Dragons', 187, ['energetic', 'rock']),
        this.buildCatalogSong('ktvTqknDobU', 'Radioactive', 'Imagine Dragons', 187, ['energetic', 'dark']),
        this.buildCatalogSong('JGwWNGJdvx8', 'Shape of You', 'Ed Sheeran', 233, ['happy', 'dance']),
        this.buildCatalogSong('2Vv-BfVoq4g', 'Perfect', 'Ed Sheeran', 263, ['romantic', 'chill']),
        this.buildCatalogSong('lp-EO5I60KA', 'Thinking Out Loud', 'Ed Sheeran', 281, ['romantic', 'chill']),
        this.buildCatalogSong('kJQP7kiw5Fk', 'Despacito', 'Luis Fonsi', 229, ['happy', 'dance', 'latin']),
        this.buildCatalogSong('OPf0YbXqDm0', 'Uptown Funk', 'Mark Ronson ft. Bruno Mars', 270, ['happy', 'funk', 'dance']),
        this.buildCatalogSong('DyDfgMOUjCI', 'bad guy', 'Billie Eilish', 194, ['dark', 'chill']),
        this.buildCatalogSong('RgKAFK5djSk', 'See You Again', 'Wiz Khalifa ft. Charlie Puth', 229, ['sad', 'chill']),
        this.buildCatalogSong('hT_nvWreIhg', 'Counting Stars', 'OneRepublic', 257, ['happy', 'energetic']),
        this.buildCatalogSong('YQHsXMglC9A', 'Hello', 'Adele', 295, ['sad', 'emotional']),
        this.buildCatalogSong('CevxZvSJLk8', 'Roar', 'Katy Perry', 223, ['happy', 'energetic']),
        this.buildCatalogSong('60ItHLz5WEA', 'Faded', 'Alan Walker', 212, ['chill', 'electronic']),
        this.buildCatalogSong('9bZkp7q19f0', 'Gangnam Style', 'PSY', 219, ['happy', 'dance']),
        this.buildCatalogSong('09R8_2nJtjg', 'Sugar', 'Maroon 5', 235, ['happy', 'pop']),
        this.buildCatalogSong('e-ORhEE9VVg', 'Blank Space', 'Taylor Swift', 231, ['happy', 'pop']),
        this.buildCatalogSong('nfWlot6h_JM', 'Shake It Off', 'Taylor Swift', 219, ['happy', 'dance']),
        this.buildCatalogSong('uelHwf8o7_U', 'Love The Way You Lie', 'Eminem ft. Rihanna', 263, ['dark', 'emotional']),
        this.buildCatalogSong('pRpeEdMmmQ0', 'Waka Waka (This Time for Africa)', 'Shakira', 202, ['happy', 'dance'])
    ];

    /**
     * Searches YouTube Music for the given query.
     *
     * @param query  Free-text search (song, artist, or mood).
     * @param apiKey Optional per-call YouTube Data API v3 key. When omitted,
     *               the constructor's default key (from `.env`) is used; if
     *               neither is set, the offline catalog is searched instead.
     * @returns A promise resolving to an array of mapped `Song` objects.
     */
    public async searchMusic(query: string, apiKey?: string): Promise<Song[]> {
        const effectiveKey = apiKey ?? this.defaultApiKey;
        const normalizedQuery = this.normalizeQuery(query);

        if (!effectiveKey) {
            return this.searchFallbackCatalog(query);
        }

        try {
            const requestUrl = new URL(YOUTUBE_SEARCH_ENDPOINT);
            requestUrl.searchParams.set('part', 'snippet');
            requestUrl.searchParams.set('type', 'video');
            requestUrl.searchParams.set('videoCategoryId', MUSIC_CATEGORY_ID);
            requestUrl.searchParams.set('maxResults', MAX_RESULTS);
            requestUrl.searchParams.set('q', normalizedQuery);
            requestUrl.searchParams.set('key', effectiveKey);

            const response = await fetch(requestUrl.toString());
            if (!response.ok) {
                throw new Error(`YouTube Data API responded with status ${response.status}`);
            }

            const payload = (await response.json()) as YouTubeSearchResponse;
            const songs = (payload.items ?? [])
                .filter((item) => Boolean(item.id?.videoId))
                .map((item) => this.mapSearchItemToSong(item));

            if (songs.length === 0) {
                return this.searchFallbackCatalog(query);
            }

            return await this.attachDurations(songs, effectiveKey);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`[YouTubeMusicService] Request failed (${reason}). Using offline catalog.`);
            return this.searchFallbackCatalog(query);
        }
    }

    /**
     * Searches YouTube Music WITHOUT falling back to the offline catalog.
     *
     * Used by the AI assistant so a missing/over-quota key is reported instead
     * of silently showing unrelated local tracks. Failures throw a typed
     * `YouTubeSearchError` (`quota`, `invalid_key`, `network` or `empty`).
     *
     * @param query  Free-text search (typically "<title> <artist>").
     * @param apiKey Optional per-call key; falls back to the constructor key.
     * @returns The real YouTube results, enriched with durations.
     */
    public async searchMusicStrict(query: string, apiKey?: string): Promise<Song[]> {
        const effectiveKey = apiKey ?? this.defaultApiKey;
        if (!effectiveKey) {
            throw new YouTubeSearchError('invalid_key', 'Missing YouTube Data API key');
        }

        const requestUrl = new URL(YOUTUBE_SEARCH_ENDPOINT);
        requestUrl.searchParams.set('part', 'snippet');
        requestUrl.searchParams.set('type', 'video');
        requestUrl.searchParams.set('videoCategoryId', MUSIC_CATEGORY_ID);
        requestUrl.searchParams.set('maxResults', MAX_RESULTS);
        requestUrl.searchParams.set('q', this.normalizeQuery(query));
        requestUrl.searchParams.set('key', effectiveKey);

        let response: Response;
        try {
            response = await fetch(requestUrl.toString());
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new YouTubeSearchError('network', reason);
        }

        if (!response.ok) {
            const reason = await this.readErrorReason(response);
            if (response.status === 403 && reason === 'quotaExceeded') {
                throw new YouTubeSearchError('quota', 'YouTube quota exceeded');
            }
            if (response.status === 400 || response.status === 401 || response.status === 403) {
                throw new YouTubeSearchError(
                    'invalid_key',
                    `YouTube API key rejected (status ${response.status})`
                );
            }
            throw new YouTubeSearchError('network', `YouTube API status ${response.status}`);
        }

        const payload = (await response.json()) as YouTubeSearchResponse;
        const songs = (payload.items ?? [])
            .filter((item) => Boolean(item.id?.videoId))
            .map((item) => this.mapSearchItemToSong(item));

        if (songs.length === 0) {
            throw new YouTubeSearchError('empty', 'No results for the query');
        }

        return await this.attachDurations(songs, effectiveKey);
    }

    /** Reads the YouTube API error `reason` (e.g. `quotaExceeded`) safely. */
    private async readErrorReason(response: Response): Promise<string | undefined> {
        try {
            const body = (await response.json()) as {
                error?: { errors?: Array<{ reason?: string }> };
            };
            return body.error?.errors?.[0]?.reason;
        } catch {
            return undefined;
        }
    }

    /** Appends the official-audio suffix to the raw query. */
    private normalizeQuery(query: string): string {
        return `${query} ${OFFICIAL_AUDIO_SUFFIX}`.trim();
    }

    /** Maps a single YouTube search item into the app's `Song` shape. */
    private mapSearchItemToSong(item: YouTubeSearchItem): Song {
        const videoId = item.id.videoId!;
        const snippet = item.snippet;
        const albumCover =
            snippet.thumbnails.high?.url ??
            snippet.thumbnails.medium?.url ??
            snippet.thumbnails.default?.url ??
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
            id: videoId,
            videoId,
            title: snippet.title,
            artist: snippet.channelTitle,
            albumCover,
            audioUrl: `https://music.youtube.com/watch?v=${videoId}`,
            // Search results do not include duration; attachDurations fills it in.
            duration: 0,
            moodTags: []
        };
    }

    /**
     * Enriches songs with real durations via the videos endpoint
     * (`contentDetails.duration`, ISO 8601). Best-effort: failures keep 0.
     */
    private async attachDurations(songs: Song[], apiKey: string): Promise<Song[]> {
        try {
            const requestUrl = new URL(YOUTUBE_VIDEOS_ENDPOINT);
            requestUrl.searchParams.set('part', 'contentDetails');
            requestUrl.searchParams.set('id', songs.map((song) => song.id).join(','));
            requestUrl.searchParams.set('key', apiKey);

            const response = await fetch(requestUrl.toString());
            if (!response.ok) {
                return songs;
            }

            const payload = (await response.json()) as YouTubeVideosResponse;
            const durations = new Map<string, number>();
            for (const item of payload.items ?? []) {
                if (item.contentDetails?.duration) {
                    durations.set(item.id, parseIso8601Duration(item.contentDetails.duration));
                }
            }

            return songs.map((song) => ({
                ...song,
                duration: durations.get(song.id) ?? song.duration
            }));
        } catch {
            return songs;
        }
    }

    /**
     * Searches the offline catalog using fuzzy matching.
     *
     * - An empty query returns the whole catalog (browsing mode).
     * - Tokens are matched against title, artist and mood tags; a subsequence
     *   fallback tolerates typos and partial words.
     * - Results are ranked by relevance so the best match appears first.
     */
    private searchFallbackCatalog(query: string): Song[] {
        const needle = query.trim().toLowerCase();
        if (needle === '') {
            return this.cloneCatalog();
        }

        const tokens = needle.split(/\s+/).filter((token) => token.length > 0);
        return this.fallbackCatalog
            .map((song) => ({ song, score: this.fuzzyScore(song, tokens) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((entry) => this.cloneSong(entry.song));
    }

    /**
     * Scores how well a song matches the search tokens.
     * Exact substring hits weigh more than loose subsequence hits.
     */
    private fuzzyScore(song: Song, tokens: string[]): number {
        const title = this.normalizeForSearch(song.title);
        const artist = this.normalizeForSearch(song.artist);
        const tags = (song.moodTags ?? []).map((tag) => this.normalizeForSearch(tag)).join(' ');
        let score = 0;

        for (const token of tokens) {
            if (title.includes(token)) {
                score += 4;
            } else if (isSubsequence(token, title)) {
                score += 1;
            }

            if (artist.includes(token)) {
                score += 4;
            } else if (isSubsequence(token, artist)) {
                score += 1;
            }

            if (tags.includes(token)) {
                score += 2;
            }
        }

        return score;
    }

    /** Lowercases and strips accents for accent-insensitive matching. */
    private normalizeForSearch(value: string): string {
        return value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    /** Builds a catalog entry from a real YouTube Video ID. */
    private buildCatalogSong(
        id: string,
        title: string,
        artist: string,
        duration: number,
        moodTags: string[]
    ): Song {
        return {
            id,
            videoId: id,
            title,
            artist,
            albumCover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            audioUrl: `https://music.youtube.com/watch?v=${id}`,
            duration,
            moodTags
        };
    }

    /** Returns a deep-enough copy of the catalog so callers cannot mutate it. */
    private cloneCatalog(): Song[] {
        return this.fallbackCatalog.map((song) => this.cloneSong(song));
    }

    /** Clones a song and its mutable `moodTags` array. */
    private cloneSong(song: Song): Song {
        return { ...song, moodTags: song.moodTags ? [...song.moodTags] : undefined };
    }
}

/**
 * Parses an ISO 8601 duration (e.g. "PT3M45S") into total seconds.
 * Returns 0 when the value is missing or malformed.
 */
function parseIso8601Duration(isoDuration: string): number {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(isoDuration);
    if (!match) {
        return 0;
    }

    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const seconds = Number(match[3] ?? 0);
    return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Returns true when every character of `needle` appears in `haystack` in
 * order (not necessarily contiguously). Used for typo/partial fuzzy matching.
 */
function isSubsequence(needle: string, haystack: string): boolean {
    if (needle.length === 0) {
        return true;
    }

    let needleIndex = 0;
    for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
        if (haystack[i] === needle[needleIndex]) {
            needleIndex++;
        }
    }

    return needleIndex === needle.length;
}
