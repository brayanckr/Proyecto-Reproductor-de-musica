import { describe, expect, it } from 'vitest';
import { PlayerController } from './PlayerController';
import type { Song } from '../models/Song';

/** Builds a minimal valid `Song` for the tests. */
function song(id: string, title = id, artist = `Artist ${id}`, duration = 100): Song {
    return {
        id,
        videoId: id,
        title,
        artist,
        albumCover: '',
        audioUrl: '',
        duration
    };
}

/** Creates a controller seeded with the provided ids (append order). */
function controllerOf(...ids: string[]): PlayerController {
    return new PlayerController(ids.map((id) => song(id)));
}

/** Snapshot of the queue ids (read-only helper, never rebuilds the queue). */
function ids(controller: PlayerController): string[] {
    return controller.playlist.map((entry) => entry.id);
}

describe('PlayerController', () => {
    describe('previous()', () => {
        it('returns null at the head and keeps the cursor', () => {
            const controller = controllerOf('a', 'b');
            controller.playTrackAt(0);

            expect(controller.previous()).toBeNull();
            expect(controller.currentSong?.id).toBe('a');
            expect(controller.currentIndex).toBe(0);
        });

        it('returns null on a single-node list', () => {
            const controller = controllerOf('a');

            expect(controller.previous()).toBeNull();
            expect(controller.currentSong?.id).toBe('a');
        });

        it('moves to the previous node from the middle', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2);

            expect(controller.previous()?.id).toBe('b');
            expect(controller.currentIndex).toBe(1);
        });
    });

    describe('next() at the tail per loopMode', () => {
        it('off: returns null and keeps the cursor at the tail', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2);

            expect(controller.hasNext).toBe(false);
            expect(controller.next()).toBeNull();
            expect(controller.currentSong?.id).toBe('c');
        });

        it('track: automatic advance repeats the current song', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2);
            controller.toggleLoopMode(); // off -> track

            expect(controller.next({ auto: true })?.id).toBe('c');
            expect(controller.currentSong?.id).toBe('c');
            expect(controller.currentIndex).toBe(2);
        });

        it('track: manual advance at the tail has no real next', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2);
            controller.toggleLoopMode(); // off -> track

            expect(controller.hasNext).toBe(false);
            expect(controller.next({ auto: false })).toBeNull();
            expect(controller.currentSong?.id).toBe('c');
        });

        it('track: manual advance from the middle still moves forward', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1);
            controller.toggleLoopMode(); // off -> track

            expect(controller.next({ auto: false })?.id).toBe('c');
            // Automatic advance then repeats the newly reached tail.
            expect(controller.next({ auto: true })?.id).toBe('c');
        });

        it('playlist: wraps from the tail back to the head', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2);
            controller.toggleLoopMode(); // off -> track
            controller.toggleLoopMode(); // track -> playlist

            expect(controller.hasNext).toBe(true);
            expect(controller.next()?.id).toBe('a');
            expect(controller.currentIndex).toBe(0);
        });
    });

    describe('removeTrackById of the current song', () => {
        it('advances the cursor to the successor when removing a middle node', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b

            expect(controller.removeTrackById('b')).toBe(true);
            expect(ids(controller)).toEqual(['a', 'c']);
            expect(controller.currentSong?.id).toBe('c');
            expect(controller.currentIndex).toBe(1);
        });

        it('falls back to the new tail when removing the tail node', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2); // c

            expect(controller.removeTrackById('c')).toBe(true);
            expect(ids(controller)).toEqual(['a', 'b']);
            expect(controller.currentSong?.id).toBe('b');
            expect(controller.currentIndex).toBe(1);
        });

        it('clears the cursor when removing the only node', () => {
            const controller = controllerOf('a');
            controller.playTrackAt(0);

            expect(controller.removeTrackById('a')).toBe(true);
            expect(ids(controller)).toEqual([]);
            expect(controller.currentSong).toBeNull();
            expect(controller.currentNode).toBeNull();
            expect(controller.length).toBe(0);
        });

        it('keeps the cursor on the current node when removing another track', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b
            const cursor = controller.currentNode;

            expect(controller.removeTrackById('a')).toBe(true);
            expect(ids(controller)).toEqual(['b', 'c']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('b');
            expect(controller.currentIndex).toBe(0);
        });
    });

    describe('cursor after moveTrack', () => {
        it('follows the moved node when the current track is moved forward', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b

            expect(controller.moveTrack(1, 2)).toBe(true);
            expect(ids(controller)).toEqual(['a', 'c', 'b']);
            expect(controller.currentSong?.id).toBe('b');
            expect(controller.currentIndex).toBe(2);
        });

        it('keeps the cursor on the current node when another track is moved', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b
            const cursor = controller.currentNode;

            expect(controller.moveTrack(0, 2)).toBe(true);
            expect(ids(controller)).toEqual(['b', 'c', 'a']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('b');
            expect(controller.currentIndex).toBe(0);
        });

        it('leaves the cursor untouched on invalid indices', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b
            const cursor = controller.currentNode;

            expect(controller.moveTrack(-1, 0)).toBe(false);
            expect(controller.moveTrack(0, 5)).toBe(false);
            expect(ids(controller)).toEqual(['a', 'b', 'c']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentIndex).toBe(1);
        });
    });

    describe('cursor after reverse', () => {
        it('keeps the cursor pointing at the same song from the middle', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(1); // b
            const cursor = controller.currentNode;

            controller.reversePlaylist();
            expect(ids(controller)).toEqual(['c', 'b', 'a']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('b');
            expect(controller.currentIndex).toBe(1);
        });

        it('moves the cursor index from head to tail when the head is playing', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(0); // a

            controller.reversePlaylist();
            expect(ids(controller)).toEqual(['c', 'b', 'a']);
            expect(controller.currentSong?.id).toBe('a');
            expect(controller.currentIndex).toBe(2);
        });
    });

    describe('sort', () => {
        it('keeps the cursor on the same node instance', () => {
            const controller = controllerOf('c', 'a', 'b');
            controller.playTrackAt(1); // a
            const cursor = controller.currentNode;

            controller.sort((x, y) => x.id.localeCompare(y.id));

            expect(ids(controller)).toEqual(['a', 'b', 'c']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('a');
            expect(controller.currentIndex).toBe(0);
        });
    });

    describe('shuffle', () => {
        it('preserves the cursor and the set of songs', () => {
            const controller = controllerOf('a', 'b', 'c', 'd');
            controller.playTrackAt(2); // c
            const cursor = controller.currentNode;

            controller.shuffle();

            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('c');
            expect([...ids(controller)].sort()).toEqual(['a', 'b', 'c', 'd']);
        });
    });

    describe('removeDuplicates', () => {
        it('moves the cursor to the surviving first occurrence', () => {
            const controller = new PlayerController([
                song('1', 'Same', 'Artist'),
                song('2', 'same', 'artist'),
                song('3', 'Other', 'Artist')
            ]);
            controller.playTrackAt(1); // duplicate gets removed

            expect(controller.removeDuplicates()).toBe(1);
            expect(ids(controller)).toEqual(['1', '3']);
            expect(controller.currentSong?.id).toBe('1');
            expect(controller.currentIndex).toBe(0);
        });

        it('keeps the cursor when the current node is not removed', () => {
            const controller = new PlayerController([
                song('1', 'Same', 'Artist'),
                song('2', 'same', 'artist'),
                song('3', 'Other', 'Artist')
            ]);
            controller.playTrackAt(2); // survives
            const cursor = controller.currentNode;

            expect(controller.removeDuplicates()).toBe(1);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('3');
        });

        it('leaves an empty list untouched', () => {
            const controller = controllerOf();
            expect(controller.removeDuplicates()).toBe(0);
            expect(controller.currentSong).toBeNull();
        });
    });

    describe('searchByText / totalDuration', () => {
        it('finds matches and sums durations', () => {
            const controller = new PlayerController([
                song('1', 'Amor', 'A', 30),
                song('2', 'Desamor', 'B', 45),
                song('3', 'Otro', 'C', 25)
            ]);

            expect(controller.searchByText('amor')).toEqual([0, 1]);
            expect(controller.totalDuration()).toBe(100);
        });
    });

    describe('moveUp / moveDown', () => {
        it('keeps the cursor on the moved track', () => {
            const controller = controllerOf('a', 'b', 'c');
            controller.playTrackAt(2); // c
            const cursor = controller.currentNode;

            expect(controller.moveUp(2)).toBe(true);
            expect(ids(controller)).toEqual(['a', 'c', 'b']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentIndex).toBe(1);
        });

        it('rejects boundary moves', () => {
            const controller = controllerOf('a', 'b');
            expect(controller.moveUp(0)).toBe(false);
            expect(controller.moveDown(1)).toBe(false);
        });
    });

    describe('insertNext', () => {
        it('inserts after the current track without changing it', () => {
            const controller = controllerOf('a', 'c');
            controller.playTrackAt(0); // a
            const cursor = controller.currentNode;

            controller.insertNext(song('b'));

            expect(ids(controller)).toEqual(['a', 'b', 'c']);
            expect(controller.currentNode).toBe(cursor);
            expect(controller.currentSong?.id).toBe('a');
        });

        it('sets the cursor when inserting into an empty queue', () => {
            const controller = controllerOf();
            const node = controller.insertNext(song('first'));

            expect(controller.length).toBe(1);
            expect(controller.currentNode).toBe(node);
            expect(controller.currentSong?.id).toBe('first');
        });
    });
});
