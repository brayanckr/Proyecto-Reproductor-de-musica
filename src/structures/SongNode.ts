import { Song } from '../models/Song';

/**
 * A single node of the doubly linked list.
 *
 * Each node knows about the song it stores plus the two neighbors around it,
 * which is what allows O(1) insertion/removal once a node reference is known
 * and bidirectional traversal (next track / previous track).
 */
export class SongNode {
    /** The song payload held by this node. */
    public value: Song;

    /** Reference to the next node toward the tail, or null at the tail. */
    public next: SongNode | null;

    /** Reference to the previous node toward the head, or null at the head. */
    public prev: SongNode | null;

    /**
     * @param value The song to store in this node.
     * @param next  The following node (defaults to null).
     * @param prev  The preceding node (defaults to null).
     */
    constructor(value: Song, next: SongNode | null = null, prev: SongNode | null = null) {
        this.value = value;
        this.next = next;
        this.prev = prev;
    }
}
