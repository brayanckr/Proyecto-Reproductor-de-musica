import { PlayerController } from './PlayerController';

/**
 * Public, UI-facing snapshot of a playlist (no node references leak out).
 */
export interface PlaylistSummary {
    /** Stable identifier used to select/delete the playlist. */
    id: string;
    /** Custom, user-provided name. */
    name: string;
    /** Number of tracks currently stored in the playlist. */
    length: number;
}

/**
 * Internal playlist record: metadata plus the playback controller that owns
 * the underlying `DoublyLinkedList` and its cursor.
 */
interface PlaylistRecord {
    id: string;
    name: string;
    /** The default playlist is protected from deletion. */
    isDefault: boolean;
    controller: PlayerController;
}

/**
 * PlaylistManager
 * ---------------
 * Manages multiple playlists, each backed by its own `PlayerController`
 * (and therefore its own `DoublyLinkedList` and playback cursor).
 *
 * Keeping one controller per playlist means switching the active view never
 * disturbs what is currently playing in another playlist: the player bar can
 * keep showing the playing track while the table displays a different list.
 */
export class PlaylistManager {
    private readonly _playlists: PlaylistRecord[] = [];

    /** Id of the playlist currently selected in the sidebar. */
    private _activeId = '';

    /** Id of the protected starter playlist. */
    private _defaultId = '';

    /** Monotonic counter used to build deterministic ids. */
    private _counter = 0;

    constructor() {
        // Always start with one starter playlist so the app is never empty.
        this._defaultId = this.createPlaylist('Mi Lista Principal');
        const starter = this.record(this._defaultId);
        if (starter) {
            starter.isDefault = true;
        }
    }

    /* ------------------------------ Queries ----------------------------- */

    /** Snapshot of every playlist for sidebar rendering. */
    public getPlaylists(): PlaylistSummary[] {
        return this._playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            length: playlist.controller.length
        }));
    }

    /** Total number of playlists currently stored. */
    public get length(): number {
        return this._playlists.length;
    }

    public get activeId(): string {
        return this._activeId;
    }

    public get activeName(): string {
        return this.record(this._activeId)?.name ?? '';
    }

    /** Controller for the playlist selected in the sidebar. */
    public get activeController(): PlayerController {
        return this.record(this._activeId)!.controller;
    }

    public get defaultId(): string {
        return this._defaultId;
    }

    /** Controller for a given playlist id, or null when it does not exist. */
    public getController(id: string): PlayerController | null {
        return this.record(id)?.controller ?? null;
    }

    /** Resolves the playlist id that owns a controller reference. */
    public getControllerId(controller: PlayerController): string | null {
        return this._playlists.find((playlist) => playlist.controller === controller)?.id ?? null;
    }

    public isDefault(id: string): boolean {
        return this.record(id)?.isDefault ?? false;
    }

    /* ----------------------------- Mutations ---------------------------- */

    /**
     * Creates a playlist with a custom name and makes it active.
     * @returns The generated playlist id.
     */
    public createPlaylist(name: string): string {
        const id = `pl-${++this._counter}`;
        const safeName = name.trim().slice(0, 60) || `Lista ${this._counter}`;

        this._playlists.push({
            id,
            name: safeName,
            isDefault: false,
            controller: new PlayerController([])
        });

        this._activeId = id;
        return id;
    }

    /**
     * Deletes a non-default playlist.
     * If the removed playlist was active, selection falls back to the first one.
     *
     * @returns true when a playlist was removed, false otherwise.
     */
    public deletePlaylist(id: string): boolean {
        const playlist = this.record(id);
        if (!playlist || playlist.isDefault) {
            return false;
        }

        this._playlists.splice(this._playlists.indexOf(playlist), 1);

        if (this._activeId === id) {
            this._activeId = this._playlists[0]?.id ?? '';
        }

        return true;
    }

    /** Selects an existing playlist; unknown ids are ignored. */
    public setActivePlaylist(id: string): void {
        if (this.record(id)) {
            this._activeId = id;
        }
    }

    /* ------------------------------ Helpers ----------------------------- */

    private record(id: string): PlaylistRecord | null {
        return this._playlists.find((playlist) => playlist.id === id) ?? null;
    }
}
