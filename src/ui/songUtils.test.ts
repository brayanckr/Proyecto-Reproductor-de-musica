import { describe, expect, it } from 'vitest';
import type { Song } from '../models/Song';
import { coverFallbackUrl, uniqueSongId, withUniqueId } from './songUtils';

/** Builds a minimal `Song` with a distinct playlist id and video id. */
function song(id: string, videoId: string): Song {
    return {
        id,
        videoId,
        title: 'Title',
        artist: 'Artist',
        albumCover: '',
        audioUrl: '',
        duration: 10
    };
}

describe('uniqueSongId', () => {
    it('returns the base id when it is free', () => {
        expect(uniqueSongId('vid', ['other'])).toBe('vid');
    });

    it('appends a numeric suffix when the id is taken', () => {
        expect(uniqueSongId('vid', ['vid'])).toBe('vid-2');
        expect(uniqueSongId('vid', ['vid', 'vid-2'])).toBe('vid-3');
    });
});

describe('withUniqueId', () => {
    it('changes only the playlist id and keeps videoId intact', () => {
        const original = song('vid', 'real-video-id');
        const copy = withUniqueId(original, ['vid']);

        expect(copy.id).toBe('vid-2');
        expect(copy.videoId).toBe('real-video-id');
        expect(original.id).toBe('vid');
        expect(original.videoId).toBe('real-video-id');
    });
});

describe('coverFallbackUrl', () => {
    it('builds the lower-resolution YouTube thumbnail URL', () => {
        expect(coverFallbackUrl('abc123')).toBe('https://i.ytimg.com/vi/abc123/mqdefault.jpg');
    });
});
