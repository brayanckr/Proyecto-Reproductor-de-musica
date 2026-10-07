import { Song } from '../models/Song';
import { SongNode } from './SongNode';

/**
 * Clave canónica de una canción para detectar duplicados: combina título y
 * artista normalizados (sin mayúsculas ni tildes). Se exporta para que el
 * `PlayerController` pueda reubicar el cursor tras eliminar duplicados.
 */
export function trackKey(song: Song): string {
    const normalize = (value: string): string =>
        value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

    return `${normalize(song.title)}\u0000${normalize(song.artist)}`;
}

/**
 * DoublyLinkedList
 * -----------------
 * Phase 1 core data structure for the music player.
 *
 * Design notes:
 * - `head` points to the first song (front of the queue).
 * - `tail` points to the last song (end of the queue).
 * - Every node links to BOTH its previous and next node, so navigating
 *   forward (next track) and backward (previous track) is symmetric.
 *
 * Complexity summary:
 * - append / prepend : O(1)
 * - insertAt / deleteAt : O(n) to reach the index, O(1) pointer updates
 * - deleteById : O(n) search + O(1) pointer updates
 * - toArray : O(n)
 */
export class DoublyLinkedList {
    /** First node of the list, or null when the list is empty. */
    private _head: SongNode | null = null;

    /** Last node of the list, or null when the list is empty. */
    private _tail: SongNode | null = null;

    /** Number of songs currently stored (kept in sync on every mutation). */
    private _length = 0;

    /** Read-only access to the first node. */
    public get head(): SongNode | null {
        return this._head;
    }

    /** Read-only access to the last node. */
    public get tail(): SongNode | null {
        return this._tail;
    }

    /** Read-only access to the number of stored songs. */
    public get length(): number {
        return this._length;
    }

    /**
     * Adds a song to the END of the list (after the current tail).
     *
     * Pointer updates:
     *   1. newNode.prev  -> old tail   (link backward to the old last node)
     *   2. oldTail.next  -> newNode    (link forward from the old last node)
     *   3. tail          -> newNode    (move the tail marker)
     *
     * @returns The freshly created node so callers can keep a direct reference.
     */
    public append(song: Song): SongNode {
        const newNode = new SongNode(song);

        if (this._head === null) {
            // Empty list: the single node is both head and tail.
            this._head = newNode;
            this._tail = newNode;
        } else {
            newNode.prev = this._tail;      // (1) new node points back to the old tail
            this._tail!.next = newNode;     // (2) old tail points forward to the new node
            this._tail = newNode;           // (3) the new node becomes the tail
        }

        this._length++;
        return newNode;
    }

    /**
     * Adds a song to the START of the list (before the current head).
     *
     * Pointer updates:
     *   1. newNode.next  -> old head   (link forward to the old first node)
     *   2. oldHead.prev  -> newNode    (link backward from the old first node)
     *   3. head          -> newNode    (move the head marker)
     *
     * @returns The freshly created node.
     */
    public prepend(song: Song): SongNode {
        const newNode = new SongNode(song);

        if (this._head === null) {
            // Empty list: the single node is both head and tail.
            this._head = newNode;
            this._tail = newNode;
        } else {
            newNode.next = this._head;      // (1) new node points forward to the old head
            this._head.prev = newNode;      // (2) old head points back to the new node
            this._head = newNode;           // (3) the new node becomes the head
        }

        this._length++;
        return newNode;
    }

    /**
     * Inserts a song at a specific position.
     *
     * Valid positions are 0 (prepend) through `length` (append). Splice logic
     * walks to the node currently occupying `index` and relinks the four
     * surrounding pointers.
     *
     * Pointer updates when splicing in the middle:
     *   1. newNode.prev      -> previous  (link back to the left neighbor)
     *   2. newNode.next      -> current   (link forward to the right neighbor)
     *   3. previous.next     -> newNode   (left neighbor now points to new node)
     *   4. current.prev      -> newNode   (right neighbor now points back to new node)
     *
     * @returns true if the song was inserted, false if the index is out of range.
     */
    public insertAt(index: number, song: Song): boolean {
        // Index may equal length (append at the end) but never exceed it.
        if (index < 0 || index > this._length) {
            return false;
        }

        // Delegate the boundary cases to the O(1) helpers.
        if (index === 0) {
            this.prepend(song);
            return true;
        }
        if (index === this._length) {
            this.append(song);
            return true;
        }

        // Middle insertion: `current` is the node that will sit to the right.
        const current = this.nodeAt(index)!;
        const previous = current.prev!;
        const newNode = new SongNode(song);

        newNode.prev = previous;      // (1)
        newNode.next = current;       // (2)
        previous.next = newNode;      // (3)
        current.prev = newNode;       // (4)

        this._length++;
        return true;
    }

    /**
     * Inserts a new song immediately AFTER an existing anchor node.
     *
     * Used for instant playback, where the freshly picked track must land
     * right behind the one currently loaded. Only three pointers change:
     *   1. newNode.prev  -> anchor    (link back to the anchor)
     *   2. newNode.next  -> successor (link forward to the old next)
     *   3. anchor.next   -> newNode   (anchor points forward to the new node)
     * and, when the anchor was the tail, the successor's `prev` is patched too.
     *
     * @returns The freshly created node so callers can keep a direct reference.
     */
    public insertAfterNode(anchor: SongNode, song: Song): SongNode {
        const newNode = new SongNode(song);
        const successor = anchor.next;

        newNode.prev = anchor;      // (1)
        newNode.next = successor;   // (2)
        anchor.next = newNode;      // (3)

        if (successor !== null) {
            successor.prev = newNode;
        } else {
            // The anchor was the tail; the new node becomes the new tail.
            this._tail = newNode;
        }

        this._length++;
        return newNode;
    }

    /**
     * Removes the song at a specific index.
     *
     * Pointer updates when removing a middle node:
     *   1. previous.next -> next   (skip over the removed node going forward)
     *   2. next.prev     -> previous (skip over the removed node going backward)
     *   3. detach removed node's own pointers to avoid dangling references.
     *
     * @returns true if a node was removed, false if the index is out of range.
     */
    public deleteAt(index: number): boolean {
        if (index < 0 || index >= this._length) {
            return false;
        }

        if (index === 0) {
            // Removing the head: advance head forward, then clear its prev.
            const oldHead = this._head!;
            this._head = oldHead.next;
            if (this._head !== null) {
                this._head.prev = null;
            } else {
                // List became empty; keep tail consistent.
                this._tail = null;
            }
            oldHead.next = null;
        } else if (index === this._length - 1) {
            // Removing the tail: move tail backward, then clear its next.
            const oldTail = this._tail!;
            this._tail = oldTail.prev;
            if (this._tail !== null) {
                this._tail.next = null;
            } else {
                // List became empty; keep head consistent.
                this._head = null;
            }
            oldTail.prev = null;
        } else {
            // Removing a middle node: bridge its two neighbors together.
            const target = this.nodeAt(index)!;
            const previous = target.prev!;
            const next = target.next!;

            previous.next = next;   // (1) left neighbor skips forward
            next.prev = previous;   // (2) right neighbor skips backward

            // (3) Fully detach the removed node so it can be garbage collected.
            target.prev = null;
            target.next = null;
        }

        this._length--;
        return true;
    }

    /**
     * Removes the first song matching a provider track ID.
     *
     * Performs a linear search and reuses `deleteAt` for the actual pointer
     * surgery, keeping relinking logic in one place.
     *
     * @returns true if a song was found and removed, false otherwise.
     */
    public deleteById(id: string): boolean {
        let current = this._head;
        let index = 0;

        while (current !== null) {
            if (current.value.id === id) {
                return this.deleteAt(index);
            }
            current = current.next;
            index++;
        }

        return false;
    }

    /**
     * Empties the list.
     *
     * Dropping the head/tail references makes every node unreachable, so the
     * garbage collector reclaims them. Length is reset to zero.
     */
    public clear(): void {
        this._head = null;
        this._tail = null;
        this._length = 0;
    }

    /**
     * Reverses the list in place by swapping the `next` and `prev` pointers of
     * every node, then swapping the `head` and `tail` markers.
     *
     * Because each node contains a PAYLOAD plus both neighbor references, we
     * only relink pointers: no node allocations and O(n) time. Existing node
     * references (e.g. the player cursor) stay valid; they simply sit at the
     * mirrored position of the list.
     */
    public reverse(): void {
        let current = this._head;

        while (current !== null) {
            // Capture the original successor before mutating the pointers.
            const next = current.next;

            // Swap this node's forward/backward links.
            current.next = current.prev;
            current.prev = next;

            // Continue along the ORIGINAL forward direction.
            current = next;
        }

        // The old head is now the end of the reversed list and vice versa.
        const previousHead = this._head;
        this._head = this._tail;
        this._tail = previousHead;
    }

    /**
     * Moves the node at `fromIndex` so it ends up at `toIndex`.
     *
     * This is pure pointer surgery: the node itself is never reallocated, so
     * external references (e.g. the player cursor) stay valid and simply point
     * at the node's NEW position.
     *
     * Detach step:
     *   - bridge the removed node's neighbors together (`prev.next = next`
     *     and `next.prev = prev`), updating `head`/`tail` when the node is an
     *     endpoint. Then count is decremented.
     *
     * Insert step:
     *   - because the list was already shortened, the requested final position
     *     maps directly to the same index in the reduced list; `insertNodeAt`
     *     reconnects the 4 surrounding pointers.
     *
     * @returns true when the move was applied, false for out-of-range indices.
     */
    public moveTrack(fromIndex: number, toIndex: number): boolean {
        if (fromIndex < 0 || fromIndex >= this._length) {
            return false;
        }
        if (toIndex < 0 || toIndex >= this._length) {
            return false;
        }
        if (fromIndex === toIndex) {
            return true;
        }

        const node = this.nodeAt(fromIndex)!;

        // (1) Detach: bridge the surrounding neighbors over the moving node.
        const previous = node.prev;
        const successor = node.next;

        if (previous !== null) {
            previous.next = successor;
        } else {
            // The moving node was the head; promote its successor.
            this._head = successor;
        }

        if (successor !== null) {
            successor.prev = previous;
        } else {
            // The moving node was the tail; demote its predecessor.
            this._tail = previous;
        }

        // Fully isolate the node before reinserting it.
        node.prev = null;
        node.next = null;
        this._length--;

        // (2) Reinsert at the requested final position in the reduced list.
        this.insertNodeAt(toIndex, node);
        this._length++;

        return true;
    }

    /**
     * Links an already-isolated node into the list at `index`.
     *
     * Assumes the node's `prev`/`next` are null and that `index` is within
     * `[0, length]` of the CURRENT list state. Does not touch `_length`, so
     * callers (e.g. `moveTrack`) keep control of counting.
     */
    private insertNodeAt(index: number, node: SongNode): void {
        if (this._head === null) {
            // Empty list: the node becomes both endpoints.
            this._head = node;
            this._tail = node;
            return;
        }

        if (index <= 0) {
            // New head: link forward to the old head.
            node.next = this._head;
            node.prev = null;
            this._head.prev = node;
            this._head = node;
            return;
        }

        if (index >= this._length) {
            // New tail: link backward to the old tail.
            node.prev = this._tail;
            node.next = null;
            this._tail!.next = node;
            this._tail = node;
            return;
        }

        // Middle insertion: splice between `previous` and `current`.
        const current = this.nodeAt(index)!;
        const previous = current.prev!;

        node.prev = previous;
        node.next = current;
        previous.next = node;
        current.prev = node;
    }

    /* ------------------------- Operaciones Fase 3 ------------------------ */

    /**
     * Ordena la lista con merge sort sobre los propios nodos (sin crear arrays).
     *
     * Estrategia: se parte la cadena en mitades con los punteros `next`
     * (técnica slow/fast), se ordena cada mitad recursivamente y se fusionan
     * reenlazando únicamente `next`. Al final `rebuildPrevAndTail` reconstruye
     * los punteros `prev` y actualiza `tail`.
     *
     * Los nodos NO se recrean ni se reasignan: sólo cambian sus enlaces, por lo
     * que cualquier referencia externa (p. ej. el cursor del reproductor) sigue
     * apuntando al mismo nodo/canción.
     *
     * Complejidad: O(n log n) en tiempo y O(log n) de recursión; O(1) de memoria
     * adicional (no se usan arrays).
     */
    public sort(compare: (a: Song, b: Song) => number): void {
        if (this._length < 2) {
            return;
        }

        this._head = this.mergeSortNodes(this._head, (a, b) => compare(a.value, b.value));
        this.rebuildPrevAndTail();
    }

    /**
     * Mezcla aleatoriamente los nodos reenlazándolos (sin usar métodos de Array).
     *
     * A cada nodo se le asigna una prioridad aleatoria y luego se ordena por esa
     * prioridad reutilizando `mergeSortNodes`, lo que produce una permutación
     * aleatoria conservando las instancias de nodo (y por tanto el cursor).
     *
     * Complejidad: O(n log n) en tiempo; O(n) de memoria auxiliar (el Map de
     * prioridades). No se usa ningún método de Array.
     */
    public shuffle(): void {
        if (this._length < 2) {
            return;
        }

        const priority = new Map<SongNode, number>();
        let node = this._head;
        while (node !== null) {
            priority.set(node, Math.random());
            node = node.next;
        }

        this._head = this.mergeSortNodes(
            this._head,
            (a, b) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0)
        );
        this.rebuildPrevAndTail();
    }

    /**
     * Elimina las canciones repetidas comparando título + artista sin distinguir
     * mayúsculas ni tildes, conservando la PRIMERA aparición.
     *
     * Recorre la cadena con `node`/`prev`; al hallar un duplicado lo desconecta
     * en O(1) puenteando a sus vecinos: `prev.next = next` y `next.prev = prev`,
     * actualizando `head`/`tail` si el nodo eliminado era un extremo.
     *
     * Complejidad: O(n) en tiempo (recorrido único) y O(n) de memoria auxiliar
     * para el Set de claves ya vistas.
     *
     * @returns Cuántas canciones se eliminaron.
     */
    public removeDuplicates(): number {
        if (this._head === null) {
            return 0;
        }

        const seen = new Set<string>();
        let removed = 0;
        let node: SongNode | null = this._head;
        let prev: SongNode | null = null;

        while (node !== null) {
            const key = trackKey(node.value);

            if (seen.has(key)) {
                const next: SongNode | null = node.next;

                if (prev !== null) {
                    prev.next = next;
                } else {
                    this._head = next; // el descartado era la cabeza
                }

                if (next !== null) {
                    next.prev = prev;
                } else {
                    this._tail = prev; // el descartado era la cola
                }

                // Aísla el nodo descartado para que lo recoja el GC.
                node.prev = null;
                node.next = null;
                this._length--;
                removed++;
                node = next;
            } else {
                seen.add(key);
                prev = node;
                node = node.next;
            }
        }

        return removed;
    }

    /**
     * Devuelve los índices (0-based) de las canciones cuyo título o artista
     * contienen `text`, ignorando mayúsculas y tildes.
     *
     * Recorre la cadena con punteros `next` acumulando los índices válidos.
     *
     * Complejidad: O(n) en tiempo; O(k) en el resultado (k = coincidencias).
     *
     * @returns Índices de los nodos que coinciden, en orden head -> tail.
     */
    public searchByText(text: string): number[] {
        const needle = this.normalizeText(text);
        if (needle.length === 0) {
            return [];
        }

        const matches: number[] = [];
        let node = this._head;
        let index = 0;

        while (node !== null) {
            const haystack = this.normalizeText(`${node.value.title} ${node.value.artist}`);
            if (haystack.includes(needle)) {
                matches.push(index);
            }
            node = node.next;
            index++;
        }

        return matches;
    }

    /**
     * Suma las duraciones (en segundos) de todas las canciones.
     *
     * Recorre la cadena con punteros `next`.
     *
     * Complejidad: O(n) en tiempo y O(1) de memoria adicional.
     */
    public totalDuration(): number {
        let total = 0;
        let node = this._head;

        while (node !== null) {
            total += node.value.duration;
            node = node.next;
        }

        return total;
    }

    /**
     * Sube una posición la canción en `index` reutilizando `moveTrack` (la
     * intercambia con su vecino anterior mediante cirugía de punteros).
     *
     * Complejidad: O(n) porque `moveTrack` localiza el índice; O(1) en enlaces.
     *
     * @returns true si se movió, false si el índice no tiene vecino anterior.
     */
    public moveUp(index: number): boolean {
        if (index <= 0 || index >= this._length) {
            return false;
        }

        return this.moveTrack(index, index - 1);
    }

    /**
     * Baja una posición la canción en `index` reutilizando `moveTrack` (la
     * intercambia con su vecino siguiente mediante cirugía de punteros).
     *
     * Complejidad: O(n) porque `moveTrack` localiza el índice; O(1) en enlaces.
     *
     * @returns true si se movió, false si el índice no tiene vecino siguiente.
     */
    public moveDown(index: number): boolean {
        if (index < 0 || index >= this._length - 1) {
            return false;
        }

        return this.moveTrack(index, index + 1);
    }

    /**
     * Inserta una canción JUSTO DESPUÉS del nodo `anchor` sin alterar el cursor
     * ni iniciar reproducción (botón "Reproducir a continuación").
     *
     * Cuando `anchor` es null (lista vacía o sin pista actual) la canción se
     * añade al final. Reutiliza `insertAfterNode`, que cambia 3 punteros:
     *   newNode.prev -> anchor, newNode.next -> successor, anchor.next -> newNode.
     *
     * Complejidad: O(1) en tiempo y memoria.
     *
     * @returns El nodo recién creado.
     */
    public insertNext(song: Song, anchor: SongNode | null): SongNode {
        if (anchor === null) {
            return this.append(song);
        }

        return this.insertAfterNode(anchor, song);
    }

    /* ------------------------- Merge sort interno ------------------------- */

    /**
     * Merge sort recursivo sobre nodos. Devuelve la cabeza de la subcadena
     * ordenada enlazada por `next` (los `prev` se reconstruyen al final con
     * `rebuildPrevAndTail`).
     *
     * Complejidad: O(n log n).
     */
    private mergeSortNodes(
        head: SongNode | null,
        compare: (a: SongNode, b: SongNode) => number
    ): SongNode | null {
        if (head === null || head.next === null) {
            return head;
        }

        // Punto medio con punteros slow/fast y corte de la cadena en dos.
        let slow: SongNode = head;
        let fast: SongNode | null = head.next;
        while (fast !== null && fast.next !== null) {
            slow = slow.next!;
            fast = fast.next.next;
        }

        const mid = slow.next;
        slow.next = null;

        const left = this.mergeSortNodes(head, compare);
        const right = this.mergeSortNodes(mid, compare);
        return this.mergeNodes(left, right, compare);
    }

    /**
     * Fusiona dos subcadenas ya ordenadas reenlazando `next`. Cada nodo elegido
     * se desprende (`next = null`) para garantizar que la cadena resultante
     * termine correctamente.
     *
     * Complejidad: O(n) sobre el total de nodos fusionados.
     */
    private mergeNodes(
        left: SongNode | null,
        right: SongNode | null,
        compare: (a: SongNode, b: SongNode) => number
    ): SongNode | null {
        let head: SongNode | null = null;
        let tail: SongNode | null = null;

        const appendNode = (node: SongNode): void => {
            node.next = null;
            if (head === null) {
                head = node;
            } else {
                tail!.next = node;
            }
            tail = node;
        };

        let a = left;
        let b = right;

        while (a !== null && b !== null) {
            if (compare(a, b) <= 0) {
                const next = a.next;
                appendNode(a);
                a = next;
            } else {
                const next = b.next;
                appendNode(b);
                b = next;
            }
        }

        let remaining = a ?? b;
        while (remaining !== null) {
            const next = remaining.next;
            appendNode(remaining);
            remaining = next;
        }

        return head;
    }

    /**
     * Reconstruye los punteros `prev` tras un merge sort/shuffle y actualiza el
     * `tail`. No modifica `length` (los nodos son los mismos, sólo reordenados).
     *
     * Complejidad: O(n).
     */
    private rebuildPrevAndTail(): void {
        let prev: SongNode | null = null;
        let node = this._head;

        while (node !== null) {
            node.prev = prev;
            prev = node;
            node = node.next;
        }

        this._tail = prev;
    }

    /** Normaliza texto (minúsculas, sin tildes) para búsquedas y duplicados. */
    private normalizeText(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    /**
     * Exports the list as a plain array of songs (head -> tail order).
     * Useful for rendering the queue or feeding the AI recommendation module.
     */
    public toArray(): Song[] {
        const songs: Song[] = [];
        let current = this._head;

        while (current !== null) {
            songs.push(current.value);
            current = current.next;
        }

        return songs;
    }

    /**
     * Returns the node located at `index`, or null when out of range.
     *
     * Optimization: because the list is doubly linked we start from whichever
     * end is closer, halving the worst-case traversal distance.
     */
    private nodeAt(index: number): SongNode | null {
        if (index < 0 || index >= this._length) {
            return null;
        }

        if (index <= this._length / 2) {
            // Walk forward from the head.
            let current = this._head;
            for (let i = 0; i < index; i++) {
                current = current!.next;
            }
            return current;
        }

        // Walk backward from the tail.
        let current = this._tail;
        for (let i = this._length - 1; i > index; i--) {
            current = current!.prev;
        }
        return current;
    }
}
