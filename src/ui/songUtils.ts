import type { Song } from '../models/Song';

/**
 * Builds a unique playlist id for a song, appending a numeric suffix when the
 * base id is already taken. It only touches `id`; `videoId` is never modified,
 * so the embedded player always receives a valid YouTube id.
 */
export function uniqueSongId(baseId: string, existingIds: Iterable<string>): string {
    const existing = new Set(existingIds);
    if (!existing.has(baseId)) {
        return baseId;
    }

    let suffix = 2;
    while (existing.has(`${baseId}-${suffix}`)) {
        suffix++;
    }
    return `${baseId}-${suffix}`;
}

/** Returns a copy of the song with a unique `id`, preserving `videoId`. */
export function withUniqueId(song: Song, existingIds: Iterable<string>): Song {
    return { ...song, id: uniqueSongId(song.id, existingIds) };
}

/**
 * Lower-resolution YouTube thumbnail used once as a fallback when the cover
 * image fails to load.
 */
export function coverFallbackUrl(videoId: string): string {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
