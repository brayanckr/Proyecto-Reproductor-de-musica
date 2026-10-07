import { describe, expect, it } from 'vitest';
import { DoublyLinkedList } from './DoublyLinkedList';
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

/** Builds a list seeded with the provided ids (append order). */
function listOf(...ids: string[]): DoublyLinkedList {
    const list = new DoublyLinkedList();
    for (const id of ids) {
        list.append(song(id));
    }
    return list;
}

/** Walks the list forward from the head and returns the visited ids. */
function forwardIds(list: DoublyLinkedList): string[] {
    const ids: string[] = [];
    let node = list.head;
    while (node !== null) {
        ids.push(node.value.id);
        node = node.next;
    }
    return ids;
}

/** Walks the list backward from the tail and returns the visited ids. */
function backwardIds(list: DoublyLinkedList): string[] {
    const ids: string[] = [];
    let node = list.tail;
    while (node !== null) {
        ids.push(node.value.id);
        node = node.prev;
    }
    return ids;
}

/**
 * Asserts every linked-list invariant after an operation:
 * - forward traversal equals the expected order;
 * - backward traversal is the exact reverse;
 * - `length` matches the number of traversed nodes;
 * - `head.prev` and `tail.next` are null;
 * - neighbor pointers are consistent (`node.next.prev === node`, etc.).
 */
function expectInvariants(list: DoublyLinkedList, expectedIds: string[]): void {
    expect(forwardIds(list)).toEqual(expectedIds);
    expect(backwardIds(list)).toEqual([...expectedIds].reverse());
    expect(list.length).toBe(expectedIds.length);

    if (expectedIds.length === 0) {
        expect(list.head).toBeNull();
        expect(list.tail).toBeNull();
        return;
    }

    expect(list.head?.prev).toBeNull();
    expect(list.tail?.next).toBeNull();

    let node = list.head;
    let visited = 0;
    while (node !== null) {
        if (node.next !== null) {
            expect(node.next.prev).toBe(node);
        }
        if (node.prev !== null) {
            expect(node.prev.next).toBe(node);
        }
        node = node.next;
        visited++;
    }
    expect(visited).toBe(list.length);
}

describe('DoublyLinkedList', () => {
    describe('empty list', () => {
        it('starts with null endpoints and zero length', () => {
            const list = new DoublyLinkedList();
            expectInvariants(list, []);
            expect(list.toArray()).toEqual([]);
        });

        it('rejects deletions and out-of-range inserts', () => {
            const list = new DoublyLinkedList();
            expect(list.deleteAt(0)).toBe(false);
            expect(list.deleteById('missing')).toBe(false);
            expect(list.insertAt(1, song('x'))).toBe(false);
            expectInvariants(list, []);
        });

        it('reverse and moveTrack are no-ops on an empty list', () => {
            const list = new DoublyLinkedList();
            list.reverse();
            expect(list.moveTrack(0, 0)).toBe(false);
            expectInvariants(list, []);
        });
    });

    describe('single node', () => {
        it('is both head and tail with stable pointers', () => {
            const list = new DoublyLinkedList();
            const only = song('only');
            list.append(only);

            expect(list.head).toBe(list.tail);
            expect(list.head?.value).toBe(only);
            expectInvariants(list, ['only']);
        });
    });

    describe('append / prepend / insertAt', () => {
        it('append adds nodes at the tail in order', () => {
            const list = listOf('a', 'b', 'c');
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('prepend adds nodes at the head in reverse order', () => {
            const list = new DoublyLinkedList();
            list.prepend(song('a'));
            list.prepend(song('b'));
            list.prepend(song('c'));
            expectInvariants(list, ['c', 'b', 'a']);
        });

        it('insertAt(0) prepends and insertAt(length) appends', () => {
            const list = listOf('b');
            expect(list.insertAt(0, song('a'))).toBe(true);
            expect(list.insertAt(list.length, song('c'))).toBe(true);
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('insertAt in the middle splices between neighbors', () => {
            const list = listOf('a', 'c');
            expect(list.insertAt(1, song('b'))).toBe(true);
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('rejects invalid indices without mutating the list', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.insertAt(-1, song('x'))).toBe(false);
            expect(list.insertAt(list.length + 1, song('x'))).toBe(false);
            expectInvariants(list, ['a', 'b', 'c']);
        });
    });

    describe('deleteAt', () => {
        it('removes the head and moves head forward', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.deleteAt(0)).toBe(true);
            expectInvariants(list, ['b', 'c']);
            expect(list.head?.prev).toBeNull();
        });

        it('removes the tail and moves tail backward', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.deleteAt(2)).toBe(true);
            expectInvariants(list, ['a', 'b']);
            expect(list.tail?.next).toBeNull();
        });

        it('removes a middle node and bridges its neighbors', () => {
            const list = listOf('a', 'b', 'c');
            const before = list.head!.next!;
            expect(list.deleteAt(1)).toBe(true);
            expect(before.next).toBeNull();
            expect(before.prev).toBeNull();
            expectInvariants(list, ['a', 'c']);
        });

        it('empties the list when deleting the only node', () => {
            const list = listOf('a');
            expect(list.deleteAt(0)).toBe(true);
            expectInvariants(list, []);
        });

        it('rejects out-of-range indices', () => {
            const list = listOf('a', 'b');
            expect(list.deleteAt(-1)).toBe(false);
            expect(list.deleteAt(2)).toBe(false);
            expectInvariants(list, ['a', 'b']);
        });
    });

    describe('deleteById', () => {
        it('removes the node holding the id at the head', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.deleteById('a')).toBe(true);
            expectInvariants(list, ['b', 'c']);
        });

        it('removes the node holding the id at the tail', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.deleteById('c')).toBe(true);
            expectInvariants(list, ['a', 'b']);
        });

        it('removes the node holding the id in the middle', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.deleteById('b')).toBe(true);
            expectInvariants(list, ['a', 'c']);
        });

        it('empties the list when deleting the only node', () => {
            const list = listOf('only');
            expect(list.deleteById('only')).toBe(true);
            expectInvariants(list, []);
        });

        it('returns false for an unknown id', () => {
            const list = listOf('a', 'b');
            expect(list.deleteById('missing')).toBe(false);
            expectInvariants(list, ['a', 'b']);
        });
    });

    describe('reverse', () => {
        it('keeps the empty list empty', () => {
            const list = new DoublyLinkedList();
            list.reverse();
            expectInvariants(list, []);
        });

        it('keeps a single node unchanged', () => {
            const list = listOf('a');
            list.reverse();
            expectInvariants(list, ['a']);
        });

        it('reverses the order of multiple nodes in place', () => {
            const list = listOf('a', 'b', 'c', 'd');
            const headNode = list.head;
            list.reverse();
            expectInvariants(list, ['d', 'c', 'b', 'a']);
            // The same node instances are relinked, not reallocated.
            expect(list.tail).toBe(headNode);
        });
    });

    describe('moveTrack', () => {
        it('moves a node forward', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveTrack(0, 2)).toBe(true);
            expectInvariants(list, ['b', 'c', 'a']);
        });

        it('moves a node backward', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveTrack(2, 0)).toBe(true);
            expectInvariants(list, ['c', 'a', 'b']);
        });

        it('reinserts the same node instance, keeping the payload', () => {
            const list = listOf('a', 'b', 'c');
            const moved = list.head!.next!.value;
            expect(list.moveTrack(1, 2)).toBe(true);
            expect(list.tail?.value).toBe(moved);
            expectInvariants(list, ['a', 'c', 'b']);
        });

        it('returns true when fromIndex equals toIndex without changes', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveTrack(1, 1)).toBe(true);
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('rejects out-of-range indices', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveTrack(-1, 0)).toBe(false);
            expect(list.moveTrack(0, 3)).toBe(false);
            expectInvariants(list, ['a', 'b', 'c']);
        });
    });

    describe('sort', () => {
        it('orders by duration ascending without reallocating nodes', () => {
            const list = new DoublyLinkedList();
            list.append(song('a', 'A', 'X', 300));
            list.append(song('b', 'B', 'X', 100));
            list.append(song('c', 'C', 'X', 200));
            const bNode = list.head!.next!;

            list.sort((x, y) => x.duration - y.duration);

            expectInvariants(list, ['b', 'c', 'a']);
            // The same node instance moved to the head.
            expect(list.head).toBe(bNode);
            expect(bNode.value.id).toBe('b');
        });

        it('orders by title with a string comparator', () => {
            const list = new DoublyLinkedList();
            list.append(song('a', 'Zeta', 'Ana'));
            list.append(song('b', 'Alfa', 'Zoe'));
            list.append(song('c', 'Beta', 'Luis'));

            list.sort((x, y) => x.title.localeCompare(y.title));
            expectInvariants(list, ['b', 'c', 'a']);
        });

        it('supports descending order via a negated comparator', () => {
            const list = new DoublyLinkedList();
            list.append(song('a', 'A', 'X', 1));
            list.append(song('b', 'B', 'X', 3));
            list.append(song('c', 'C', 'X', 2));

            list.sort((x, y) => y.duration - x.duration);
            expectInvariants(list, ['b', 'c', 'a']);
        });

        it('is a no-op on empty and single-node lists', () => {
            const empty = new DoublyLinkedList();
            empty.sort((x, y) => x.duration - y.duration);
            expectInvariants(empty, []);

            const single = listOf('only');
            single.sort((x, y) => x.duration - y.duration);
            expectInvariants(single, ['only']);
        });
    });

    describe('shuffle', () => {
        it('keeps every node and the invariants', () => {
            const list = listOf('a', 'b', 'c', 'd', 'e');
            const expected = ['a', 'b', 'c', 'd', 'e'].sort();

            list.shuffle();

            expect([...forwardIds(list)].sort()).toEqual(expected);
            expectInvariants(list, forwardIds(list));
        });

        it('preserves node instances and payloads', () => {
            const list = new DoublyLinkedList();
            list.append(song('a'));
            list.append(song('b'));
            list.append(song('c'));
            const middle = list.head!.next!;

            list.shuffle();

            expect(middle.value.id).toBe('b');
            let node = list.head;
            let found = false;
            while (node !== null) {
                if (node === middle) {
                    found = true;
                }
                node = node.next;
            }
            expect(found).toBe(true);
        });

        it('is a no-op on empty and single-node lists', () => {
            const empty = new DoublyLinkedList();
            empty.shuffle();
            expectInvariants(empty, []);

            const single = listOf('only');
            single.shuffle();
            expectInvariants(single, ['only']);
        });
    });

    describe('removeDuplicates', () => {
        it('keeps the first occurrence ignoring case and accents', () => {
            const list = new DoublyLinkedList();
            list.append(song('1', 'Canción', 'Artista'));
            list.append(song('2', 'cancion', 'artista')); // duplicado (tildes/mayúsculas)
            list.append(song('3', 'Otra', 'Artista'));
            list.append(song('4', 'CANCION', 'ARTISTA')); // otro duplicado

            expect(list.removeDuplicates()).toBe(2);
            expectInvariants(list, ['1', '3']);
        });

        it('returns 0 when there are no duplicates', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.removeDuplicates()).toBe(0);
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('collapses a list made only of duplicates', () => {
            const list = new DoublyLinkedList();
            list.append(song('1', 'Same', 'Artist'));
            list.append(song('2', 'same', 'artist'));
            list.append(song('3', 'SAME', 'ARTIST'));

            expect(list.removeDuplicates()).toBe(2);
            expectInvariants(list, ['1']);
        });

        it('is a no-op on an empty list', () => {
            const list = new DoublyLinkedList();
            expect(list.removeDuplicates()).toBe(0);
            expectInvariants(list, []);
        });
    });

    describe('searchByText', () => {
        it('matches title or artist ignoring case and accents', () => {
            const list = new DoublyLinkedList();
            list.append(song('1', 'Corazón', 'Rosa'));
            list.append(song('2', 'Noche', 'Radio'));
            list.append(song('3', 'Día', 'Sol'));

            expect(list.searchByText('corazon')).toEqual([0]);
            expect(list.searchByText('radio')).toEqual([1]);
            expect(list.searchByText('sol')).toEqual([2]);
        });

        it('returns every match in head-to-tail order', () => {
            const list = new DoublyLinkedList();
            list.append(song('1', 'Amor', 'A'));
            list.append(song('2', 'Desamor', 'B'));
            list.append(song('3', 'Otro', 'C'));

            expect(list.searchByText('amor')).toEqual([0, 1]);
        });

        it('returns an empty array for blank text or no matches', () => {
            const list = listOf('a', 'b');
            expect(list.searchByText('')).toEqual([]);
            expect(list.searchByText('   ')).toEqual([]);
            expect(list.searchByText('zzz')).toEqual([]);
        });
    });

    describe('totalDuration', () => {
        it('sums every track duration', () => {
            const list = new DoublyLinkedList();
            list.append(song('a', 'A', 'X', 30));
            list.append(song('b', 'B', 'X', 45));
            list.append(song('c', 'C', 'X', 25));

            expect(list.totalDuration()).toBe(100);
        });

        it('returns 0 for an empty list', () => {
            expect(new DoublyLinkedList().totalDuration()).toBe(0);
        });
    });

    describe('moveUp / moveDown', () => {
        it('swaps a node with its previous neighbor', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveUp(2)).toBe(true);
            expectInvariants(list, ['a', 'c', 'b']);
        });

        it('swaps a node with its next neighbor', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveDown(0)).toBe(true);
            expectInvariants(list, ['b', 'a', 'c']);
        });

        it('rejects boundary indices', () => {
            const list = listOf('a', 'b', 'c');
            expect(list.moveUp(0)).toBe(false);
            expect(list.moveDown(2)).toBe(false);
            expect(list.moveUp(-1)).toBe(false);
            expect(list.moveDown(3)).toBe(false);
            expectInvariants(list, ['a', 'b', 'c']);
        });
    });

    describe('insertNext', () => {
        it('inserts right after the anchor', () => {
            const list = listOf('a', 'c');
            list.insertNext(song('b'), list.head!);
            expectInvariants(list, ['a', 'b', 'c']);
        });

        it('appends when the anchor is null', () => {
            const list = listOf('a');
            list.insertNext(song('b'), null);
            expectInvariants(list, ['a', 'b']);
        });

        it('inserts into an empty list when the anchor is null', () => {
            const list = new DoublyLinkedList();
            const node = list.insertNext(song('x'), null);
            expect(node.value.id).toBe('x');
            expectInvariants(list, ['x']);
        });
    });
});
