/**
 * A single line of synchronized lyrics.
 *
 * `time` is the offset, in seconds, at which the line becomes active. The line
 * stays active until the next line's `time` is reached.
 */
export interface LyricLine {
    time: number;
    text: string;
}

/** Subset of the LRCLIB `/api/get` and `/api/search` payloads we rely on. */
interface LrclibRecord {
    id: number;
    trackName?: string;
    artistName?: string;
    albumName?: string;
    duration?: number;
    instrumental?: boolean;
    hasWordSync?: boolean;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
}

/** Base endpoint for the free, public LRCLIB synced-lyrics service. */
const LRCLIB_BASE_URL = 'https://lrclib.net/api';

/** Abort a request if it takes longer than this (ms) to avoid hanging the UI. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * LyricsService
 * -------------
 * Fetches REAL synchronized lyrics from LRCLIB (https://lrclib.net), a free and
 * open public API, and converts the LRC timeline into the app's `LyricLine[]`.
 *
 * No lyric text is embedded in this source file: everything is retrieved at
 * runtime, which keeps the repository free of copyrighted content while the UI
 * still displays real synced lines.
 */
export class LyricsService {
    /** In-memory cache keyed by "track|artist" to avoid repeat network calls. */
    private readonly cache = new Map<string, LyricLine[]>();

    /**
     * Fetches synchronized lyrics for a track from LRCLIB.
     *
     * Strategy:
     *  1. Exact lookup via `/api/get` (track + artist, plus duration when known).
     *  2. If that misses (missing `syncedLyrics` or HTTP 404), search via
     *     `/api/search` and use the closest matching result.
     *
     * @param trackName  Cleaned track title.
     * @param artistName Cleaned artist / channel name.
     * @param duration   Optional track length in seconds (improves matching).
     * @returns Ordered timed lines, or null when nothing is found.
     */
    public async fetchSyncedLyrics(
        trackName: string,
        artistName: string,
        duration?: number
    ): Promise<LyricLine[] | null> {
        const track = trackName.trim();
        const artist = artistName.trim();
        if (track === '') {
            return null;
        }

        const cacheKey = `${track.toLowerCase()}|${artist.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return this.clone(cached);
        }

        let lines = await this.requestExactMatch(track, artist, duration);

        if (lines === null) {
            lines = await this.requestSearch(track, artist, duration);
        }

        if (lines === null || lines.length === 0) {
            return null;
        }

        this.cache.set(cacheKey, lines);
        return this.clone(lines);
    }

    /* ----------------------------- Requests ----------------------------- */

    /** Exact match through `/api/get`. */
    private async requestExactMatch(
        track: string,
        artist: string,
        duration?: number
    ): Promise<LyricLine[] | null> {
        const params = new URLSearchParams({ track_name: track, artist_name: artist });
        if (typeof duration === 'number' && duration > 0) {
            params.set('duration', String(Math.round(duration)));
        }

        const payload = await this.requestJson<LrclibRecord>(
            `${LRCLIB_BASE_URL}/get?${params.toString()}`
        );

        return this.extractSyncedLyrics(payload);
    }

    /** Partial match through `/api/search`, preferring the closest duration. */
    private async requestSearch(
        track: string,
        artist: string,
        duration?: number
    ): Promise<LyricLine[] | null> {
        const query = `${track} ${artist}`.trim();
        const results = await this.requestJson<LrclibRecord[]>(
            `${LRCLIB_BASE_URL}/search?q=${encodeURIComponent(query)}`
        );

        if (!Array.isArray(results)) {
            return null;
        }

        const candidates = results.filter(
            (record) =>
                record.instrumental !== true &&
                typeof record.syncedLyrics === 'string' &&
                record.syncedLyrics.trim() !== ''
        );

        if (candidates.length === 0) {
            return null;
        }

        const best = this.pickClosestDuration(candidates, duration) ?? candidates[0];
        return this.extractSyncedLyrics(best);
    }

    /** Picks the search result whose duration is closest to the target. */
    private pickClosestDuration(
        records: LrclibRecord[],
        duration?: number
    ): LrclibRecord | null {
        if (typeof duration !== 'number' || duration <= 0) {
            return null;
        }

        let best: LrclibRecord | null = null;
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const record of records) {
            if (typeof record.duration !== 'number') {
                continue;
            }
            const delta = Math.abs(record.duration - duration);
            if (delta < bestDelta) {
                best = record;
                bestDelta = delta;
            }
        }

        // Reject wildly different matches (more than 10 seconds apart).
        return bestDelta <= 10 ? best : null;
    }

    /**
     * GETs JSON with a timeout, swallowing network/parse errors as null so the
     * caller can fall back gracefully.
     */
    private async requestJson<T>(url: string): Promise<T | null> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                headers: { Accept: 'application/json' },
                signal: controller.signal
            });

            if (!response.ok) {
                return null;
            }

            return (await response.json()) as T;
        } catch {
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /** Reads `syncedLyrics` from a record and parses it, when present. */
    private extractSyncedLyrics(record: LrclibRecord | null): LyricLine[] | null {
        if (!record || record.instrumental === true) {
            return null;
        }

        if (typeof record.syncedLyrics !== 'string' || record.syncedLyrics.trim() === '') {
            return null;
        }

        const lines = this.parseLrc(record.syncedLyrics);
        return lines.length > 0 ? lines : null;
    }

    /* ---------------------------- LRC parsing --------------------------- */

    /**
     * Parses an LRC timeline (`[mm:ss.xx] Lyric line`) into timed entries.
     *
     * Supports multiple timestamps per line and the `[offset:±ms]` metadata tag.
     * Metadata-only tags (`ar`, `ti`, `al`, `by`, ...) are ignored.
     */
    private parseLrc(lrc: string): LyricLine[] {
        const timestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

        // Global offset applied to every timestamp, expressed in milliseconds.
        const offsetMatch = lrc.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
        const offsetSeconds = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;

        const lines: LyricLine[] = [];

        for (const rawLine of lrc.split(/\r?\n/)) {
            // Skip metadata-only tags such as [ar:...], [ti:...], [offset:...].
            if (/^\s*\[(ar|ti|al|by|offset|re|ve|length|au|tool):/i.test(rawLine)) {
                continue;
            }

            timestampPattern.lastIndex = 0;
            const times: number[] = [];
            let match: RegExpExecArray | null;

            while ((match = timestampPattern.exec(rawLine)) !== null) {
                const minutes = Number(match[1]);
                const seconds = Number(match[2]);
                const fractionDigits = match[3] ?? '';
                const fraction = fractionDigits
                    ? Number(fractionDigits) / 10 ** fractionDigits.length
                    : 0;

                times.push(minutes * 60 + seconds + fraction - offsetSeconds);
            }

            if (times.length === 0) {
                continue;
            }

            const text = rawLine.replace(timestampPattern, '').trim();
            if (text === '') {
                continue;
            }

            for (const time of times) {
                lines.push({ time: Math.round(time * 1000) / 1000, text });
            }
        }

        return lines.sort((a, b) => a.time - b.time);
    }

    /** Returns a defensive copy so callers cannot mutate cached arrays. */
    private clone(lines: LyricLine[]): LyricLine[] {
        return lines.map((line) => ({ time: line.time, text: line.text }));
    }
}
