import { Song } from '../models/Song';
import { SongNode } from '../structures/SongNode';
import { DoublyLinkedList, trackKey } from '../structures/DoublyLinkedList';

/**
 * Playback repeat strategy:
 * - 'off'      : stop when the tail is reached.
 * - 'track'    : keep the cursor on the same node (single-track repeat).
 * - 'playlist' : wrap the cursor from the tail back to the head.
 */
export type LoopMode = 'off' | 'track' | 'playlist';

/**
 * PlayerController
 * ----------------
 * Playback state controller built on top of the Phase 1 `DoublyLinkedList`.
 *
 * It keeps a `currentNode` cursor into the list, so navigation simply follows
 * the `next`/`prev` pointers (O(1)) instead of re-scanning the playlist.
 * All mutations are delegated to the linked list, which owns the pointer
 * surgery; this controller only keeps the cursor valid.
 *
 * It also exposes a `loopMode` strategy plus `reversePlaylist`, exposing more
 * of the doubly linked list's bidirectional pointer logic to the UI.
 */
export class PlayerController {
    /** The underlying queue of songs (single source of truth). */
    private readonly _playlist: DoublyLinkedList;

    /** Cursor pointing to the track currently loaded in the player. */
    private _currentNode: SongNode | null = null;

    /** Active repeat strategy (defaults to no repeat). */
    private _loopMode: LoopMode = 'off';

    /**
     * @param initialSongs Optional tracks used to seed the queue on creation.
     *                     When provided, the cursor starts on the first track.
     */
    constructor(initialSongs: Song[] = []) {
        this._playlist = new DoublyLinkedList();
        for (const song of initialSongs) {
            this._playlist.append(song);
        }
        this._currentNode = this._playlist.head;
    }

    /* ----------------------------- Getters ------------------------------ */

    /** Raw cursor node (useful for advanced UI needs). */
    public get currentNode(): SongNode | null {
        return this._currentNode;
    }

    /** The song currently loaded, or null when the queue is empty. */
    public get currentSong(): Song | null {
        return this._currentNode?.value ?? null;
    }

    /** Snapshot of the queue in head -> tail order. */
    public get playlist(): Song[] {
        return this._playlist.toArray();
    }

    /** Current repeat strategy. */
    public get loopMode(): LoopMode {
        return this._loopMode;
    }

    /**
     * True when the manual "next" action can move to a different track.
     *
     * Single-track repeat is intentionally ignored here: it only affects the
     * automatic advancement fired at the end of a song, so at the tail the
     * "Siguiente" button stays disabled. Playlist repeat always wraps, hence
     * it always reports true.
     */
    public get hasNext(): boolean {
        if (this._currentNode === null) {
            return false;
        }
        if (this._loopMode === 'playlist') {
            return true;
        }
        return this._currentNode.next !== null;
    }

    /** True when there is a track before the cursor. */
    public get hasPrevious(): boolean {
        return this._currentNode !== null && this._currentNode.prev !== null;
    }

    /** Zero-based position of the current track, or -1 when none is loaded. */
    public get currentIndex(): number {
        let index = 0;
        let node = this._playlist.head;

        while (node !== null) {
            if (node === this._currentNode) {
                return index;
            }
            node = node.next;
            index++;
        }

        return -1;
    }

    /** Total number of tracks in the queue. */
    public get length(): number {
        return this._playlist.length;
    }

    /* --------------------------- Navigation ----------------------------- */

    /**
     * Moves the cursor to the next track.
     *
     * Automatic advancement (fired by the player's ENDED event) honors the
     * active `loopMode`:
     * - 'track'    : repeats the current song.
     * - 'playlist' : wraps from the tail back to the head.
     *
     * Manual advancement (`options.auto` false, i.e. the "Siguiente" button)
     * skips the single-track repeat so the user always moves to a real next
     * node; the playlist wrap still applies.
     *
     * @param options.auto Set true only for automatic advancement on ENDED.
     * @returns The new current `Song`, or null when the end is reached.
     */
    public next(options: { auto?: boolean } = {}): Song | null {
        if (this._currentNode === null) {
            return null;
        }

        if (options.auto && this._loopMode === 'track') {
            return this._currentNode.value;
        }

        if (this._loopMode === 'playlist' && this._currentNode === this._playlist.tail) {
            this._currentNode = this._playlist.head;
            return this._currentNode?.value ?? null;
        }

        if (this._currentNode.next === null) {
            return null;
        }

        this._currentNode = this._currentNode.next;
        return this._currentNode.value;
    }

    /**
     * Cycles the repeat strategy in the order off -> track -> playlist -> off.
     * @returns The newly active `LoopMode`.
     */
    public toggleLoopMode(): LoopMode {
        if (this._loopMode === 'off') {
            this._loopMode = 'track';
        } else if (this._loopMode === 'track') {
            this._loopMode = 'playlist';
        } else {
            this._loopMode = 'off';
        }

        return this._loopMode;
    }

    /**
     * Moves the cursor to the previous track.
     * @returns The new current `Song`, or null when already at the head.
     */
    public previous(): Song | null {
        if (this._currentNode === null || this._currentNode.prev === null) {
            return null;
        }

        this._currentNode = this._currentNode.prev;
        return this._currentNode.value;
    }

    /**
     * Loads the track at the given index into the player.
     * @returns The selected `Song`, or null when the index is out of range.
     */
    public playTrackAt(index: number): Song | null {
        const node = this.nodeAt(index);
        if (node === null) {
            return null;
        }

        this._currentNode = node;
        return node.value;
    }

    /* ----------------------------- Mutation ----------------------------- */

    /**
     * Inserts a track into the queue.
     *
     * @param song     Song to add.
     * @param position 'start' (prepend), 'end' (append), or 'index' (insertAt).
     * @param index    Required only when `position` is 'index'.
     * @returns true when the track was added, false otherwise.
     */
    public addTrack(song: Song, position: 'start' | 'end' | 'index', index?: number): boolean {
        const wasEmpty = this._playlist.length === 0;
        let added = false;

        switch (position) {
            case 'start':
                this._playlist.prepend(song);
                added = true;
                break;
            case 'end':
                this._playlist.append(song);
                added = true;
                break;
            case 'index':
                if (index === undefined) {
                    return false;
                }
                added = this._playlist.insertAt(index, song);
                break;
        }

        // If the queue was empty, the new track becomes the one loaded.
        if (added && wasEmpty) {
            this._currentNode = this._playlist.head;
        }

        return added;
    }

    /**
     * Inserts a track for instant playback and moves the cursor to it.
     *
     * The song is spliced as a new node immediately after the currently loaded
     * node so it starts right away, falling back to an append when the queue
     * has no cursor yet. The cursor is then pointed at the fresh node, which
     * makes it the track the player bar renders.
     *
     * @returns The newly created node, or null when insertion was not possible.
     */
    public playNow(song: Song): SongNode | null {
        const node =
            this._currentNode !== null
                ? this._playlist.insertAfterNode(this._currentNode, song)
                : this._playlist.append(song);

        this._currentNode = node;
        return node;
    }

    /**
     * Removes the first track matching `id` and keeps the cursor valid.
     *
     * If the removed track is the one currently loaded, the cursor advances to
     * its successor; if there is no successor it falls back to the new tail
     * (or null when the queue becomes empty).
     *
     * @returns true when a track was removed, false otherwise.
     */
    public removeTrackById(id: string): boolean {
        const isCurrentTrack = this._currentNode !== null && this._currentNode.value.id === id;

        if (!isCurrentTrack) {
            return this._playlist.deleteById(id);
        }

        // Capture the successor BEFORE deletion, while pointers are intact.
        const successor = this._currentNode!.next;
        const removed = this._playlist.deleteById(id);
        if (!removed) {
            return false;
        }

        this._currentNode = successor !== null ? successor : this._playlist.tail;
        return true;
    }

    /**
     * Reorders the queue by moving the track at `fromIndex` to `toIndex`.
     *
     * The cursor is kept safe automatically: `DoublyLinkedList.moveTrack`
     * relinks the SAME node instances instead of recreating them, so when the
     * moved track is the one currently playing the cursor follows it to its
     * new position, and when another track is moved the cursor keeps pointing
     * at the untouched current node.
     *
     * @returns true when the tracks were reordered, false for invalid indices.
     */
    public moveTrack(fromIndex: number, toIndex: number): boolean {
        return this._playlist.moveTrack(fromIndex, toIndex);
    }

    /* ---------------------- Operaciones de la Fase 3 -------------------- */

    /**
     * Ordena la cola con merge sort (O(n log n)). El cursor sigue apuntando al
     * mismo nodo porque la lista sólo reenlaza las instancias existentes.
     */
    public sort(compare: (a: Song, b: Song) => number): void {
        this._playlist.sort(compare);
    }

    /** Mezcla aleatoriamente la cola conservando el cursor en la canción actual. */
    public shuffle(): void {
        this._playlist.shuffle();
    }

    /**
     * Quita las canciones repetidas (mismo título y artista, sin distinguir
     * mayúsculas ni tildes). Si el nodo actual era un duplicado eliminado, mueve
     * el cursor al primer registro que sobrevive de esa misma canción (o a la
     * cabeza si no queda ninguno), de modo que siempre apunte a un nodo válido.
     *
     * @returns Cuántas canciones se eliminaron.
     */
    public removeDuplicates(): number {
        const removed = this._playlist.removeDuplicates();
        if (removed === 0 || this._currentNode === null) {
            return removed;
        }

        // La primera aparición de la misma clave siempre sobrevive.
        const key = trackKey(this._currentNode.value);
        this._currentNode = this.findNodeByKey(key) ?? this._playlist.head;
        return removed;
    }

    /** Índices de las canciones cuyo título o artista contienen `text`. */
    public searchByText(text: string): number[] {
        return this._playlist.searchByText(text);
    }

    /** Duración total de la cola en segundos. */
    public totalDuration(): number {
        return this._playlist.totalDuration();
    }

    /** Sube una posición la canción en `index`; el cursor la sigue. */
    public moveUp(index: number): boolean {
        return this._playlist.moveUp(index);
    }

    /** Baja una posición la canción en `index`; el cursor la sigue. */
    public moveDown(index: number): boolean {
        return this._playlist.moveDown(index);
    }

    /**
     * Inserta la canción justo después de la actual SIN reproducirla (botón
     * "Reproducir a continuación"). Si la cola estaba vacía, el nuevo nodo pasa
     * a ser el actual para que el cursor nunca quede colgado.
     *
     * @returns El nodo insertado.
     */
    public insertNext(song: Song): SongNode {
        const wasEmpty = this._playlist.length === 0;
        const node = this._playlist.insertNext(song, this._currentNode);

        if (wasEmpty) {
            this._currentNode = node;
        }

        return node;
    }

    /** Busca un nodo por su clave normalizada recorriendo punteros. */
    private findNodeByKey(key: string): SongNode | null {
        let node = this._playlist.head;
        while (node !== null) {
            if (trackKey(node.value) === key) {
                return node;
            }
            node = node.next;
        }
        return null;
    }

    /* -------------------------- Mood reordering ------------------------- */

    /**
     * Replaces the entire queue with the provided songs and resets the cursor
     * to the new head.
     *
     * Implementation notes:
     * - `clear()` releases all existing nodes at once.
     * - `append` rebuilds the queue while keeping `prev`/`next`/`head`/`tail`
     *   consistent for every inserted node.
     *
     * @param songs Songs to load, first track becomes the current one.
     */
    public replacePlaylist(songs: Song[]): void {
        this._playlist.clear();
        for (const song of songs) {
            this._playlist.append(song);
        }

        // The first ranked song becomes the current track.
        this._currentNode = this._playlist.head;
    }

    /* --------------------------- List reversal -------------------------- */

    /**
     * Reverses the queue by delegating to `DoublyLinkedList.reverse`, which
     * swaps every node's `next`/`prev` pointers and exchanges `head`/`tail`.
     *
     * The cursor keeps pointing at the SAME song; only its position and the
     * direction of traversal change, so playback is not interrupted.
     */
    public reversePlaylist(): void {
        this._playlist.reverse();
    }

    /**
     * Empties the queue and clears the cursor. `clear()` drops every node so
     * the garbage collector reclaims them, leaving the player with no track.
     */
    public clearPlaylist(): void {
        this._playlist.clear();
        this._currentNode = null;
    }

    /* ----------------------------- Helpers ------------------------------ */

    /**
     * Walks the list's `next` pointers to the requested index.
     * Returns null when the index is negative or beyond the tail.
     */
    private nodeAt(index: number): SongNode | null {
        if (index < 0) {
            return null;
        }

        let node = this._playlist.head;
        let currentIndex = 0;

        while (node !== null && currentIndex < index) {
            node = node.next;
            currentIndex++;
        }

        return node;
    }
}
