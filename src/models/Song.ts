/**
 * Represents a single playable track.
 *
 * The `id` is intentionally provider-agnostic so it can hold a Spotify track ID,
 * a YouTube video ID, or any other external music API identifier. This keeps the
 * linked list decoupled from a specific music provider and ready for the AI Mood
 * Recommendation module (which can filter using `moodTags`).
 */
export interface Song {
    /**
     * Unique identifier inside a playlist. It may receive a numeric suffix when
     * the same track is added more than once, so it is NOT a valid YouTube id.
     */
    id: string;

    /**
     * Real YouTube video id used by the embedded player. It always stays stable
     * even when `id` is suffixed for duplicated list entries.
     */
    videoId: string;

    /** Track title shown in the UI. */
    title: string;

    /** Performing artist or band. */
    artist: string;

    /** Absolute URL to the album artwork image. */
    albumCover: string;

    /** Stream/preview URL, or a YouTube video ID, used by the audio player. */
    audioUrl: string;

    /** Track length in seconds. */
    duration: number;

    /**
     * Optional mood descriptors used by the AI recommendation engine.
     * Example: ['happy', 'chill'].
     */
    moodTags?: string[];
}
