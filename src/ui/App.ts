import { PlayerController, PlaylistManager, YouTubeMusicService } from '../index';
import type { LoopMode } from '../index';
import { MoodRecommendationService } from '../services/MoodRecommendationService';
import { MoodSuggestionResolver } from '../services/MoodSuggestionResolver';
import { YouTubeSearchError } from '../services/YouTubeMusicService';
import { LyricsService } from '../services/LyricsService';
import type { LyricLine } from '../services/LyricsService';
import type { Song } from '../models/Song';
import { YouTubePlayer, YouTubePlayerState } from './YouTubePlayer';
import { icon } from './icons';
import { MESSAGES } from './messages';
import { coverFallbackUrl, uniqueSongId } from './songUtils';

/** Which main view is currently visible. */
type MainView = 'home' | 'playlist';

/** Inline SVG shown while a track has no artwork (or the artwork fails). */
const PLACEHOLDER_COVER =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
    "<rect width='100%' height='100%' fill='%23e2e8f0'/>" +
    "<text x='50%' y='58%' font-size='120' text-anchor='middle' fill='%2300a8cc'>♪</text></svg>";

/** Placeholder text used in the `.env` template; treated as "not configured". */
const ENV_PLACEHOLDER_PATTERN = /(tu_clave|your[_-]|changeme|_aqui|placeholder)/i;

/** Seconds after which "Anterior" restarts the current track instead of going back. */
const PREVIOUS_RESTART_THRESHOLD = 3;

/**
 * Reads an API key from `import.meta.env`, ignoring empty values and the
 * placeholders shipped in `.env.example`, so unconfigured keys fall back to
 * the offline catalog / local mood scoring instead of failing network calls.
 */
function readEnvKey(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed || ENV_PLACEHOLDER_PATTERN.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

/** Returns a required DOM element or throws so misconfiguration fails loudly. */
function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`UCCplay: missing required element #${id}`);
    }
    return element as T;
}

/** Escapes user-provided text before injecting it into HTML. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Formats seconds as m:ss (used for the live progress clock). */
function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

/** Formats a known duration, or a dash placeholder when it is unknown. */
function formatDuration(seconds: number): string {
    return seconds > 0 ? formatTime(seconds) : '--:--';
}

/**
 * App
 * ---
 * UI controller. It wires the Spanish DOM to the TypeScript core:
 * playback controls call `PlayerController` navigation, the search panel calls
 * `YouTubeMusicService.searchMusic` and `addTrack`, the mood form calls the
 * Groq-backed `MoodRecommendationService` and resolves the real track through
 * `YouTubeMusicService`, and the table reflects the `DoublyLinkedList` on every
 * mutation. Audio is played through an embedded YouTube IFrame player keyed by
 * the current node's video ID.
 */
export class App {
    /**
     * API keys resolved from `.env`. Vite exposes `VITE_*` variables through
     * `import.meta.env`; the values are injected into the services so live
     * search and Groq AI recommendations work without manual entry.
     */
    private readonly youtubeApiKey = readEnvKey(import.meta.env.VITE_YOUTUBE_API_KEY);
    private readonly groqApiKey = readEnvKey(import.meta.env.VITE_GROQ_API_KEY);
    private readonly groqModel = readEnvKey(import.meta.env.VITE_GROQ_MODEL);

    private readonly musicService = new YouTubeMusicService({ apiKey: this.youtubeApiKey });
    private readonly moodService = new MoodRecommendationService({
        apiKey: this.groqApiKey,
        model: this.groqModel
    });

    /** Provides mock synchronized lyrics for the active track. */
    private readonly lyricsService = new LyricsService();

    /** Owns every playlist (each with its own doubly linked list + cursor). */
    private readonly manager = new PlaylistManager();

    private readonly player: YouTubePlayer;

    /**
     * Controller whose track is loaded in the bottom player bar. It may differ
     * from the sidebar's active playlist, which is what keeps audio playing
     * while the user browses another list.
     */
    private playingController: PlayerController | null = null;

    /** Current main view selected from the sidebar. */
    private currentView: MainView = 'home';

    /** Full pool of songs used by the mood recommender. */
    private catalog: Song[] = [];

    /** Current search results backing the rendered result cards. */
    private searchResults: Song[] = [];

    /** Last mood prompt, kept so "Generar otra opción" can re-run the query. */
    private lastMoodPrompt = '';

    /** Live YouTube track currently rendered in the AI preview card. */
    private moodPreviewSong: Song | null = null;

    /** Spanish explanation returned by the LLM for the current suggestion. */
    private moodPreviewReason = '';

    /** True when the preview shows a track that passed YouTube validation. */
    private moodPreviewValidated = false;

    /** Resolves AI suggestions against the live YouTube catalog. */
    private moodResolver: MoodSuggestionResolver | null = null;

    /** Guards against overlapping AI suggestion requests. */
    private isGeneratingSuggestion = false;

    /** Active sort criteria and direction for the playlist table. */
    private sortCriteria: 'title' | 'artist' | 'duration' = 'title';
    private sortDirection: 'asc' | 'desc' = 'asc';

    /** Current filter text for the in-list search field. */
    private playlistSearchQuery = '';

    /**
     * Video ids whose cover (and its single fallback) already failed, so a
     * re-render shows the placeholder without requesting the image again.
     */
    private readonly failedCovers = new Set<string>();

    /** Current color theme, mirrored onto the `<html data-theme>` attribute. */
    private theme: 'light' | 'dark' = 'light';

    private isPlaying = false;
    private isMuted = false;
    private loadedVideoId: string | null = null;
    private playerDuration = 0;
    private isSeeking = false;
    private toastTimer: number | null = null;

    /** Index of the table row currently being dragged (null when idle). */
    private draggedIndex: number | null = null;

    /* ------------------------------ Lyrics state ---------------------------- */
    private lyrics: LyricLine[] = [];
    private lyricLineElements: HTMLElement[] = [];
    private activeLyricIndex = -1;
    private lyricsSongId: string | null = null;
    private isLyricsOpen = false;

    /** Guards against out-of-order async lyrics responses. */
    private lyricsRequestId = 0;

    /** Controller for the playlist selected in the sidebar (edit/render target). */
    private get active(): PlayerController {
        return this.manager.activeController;
    }

    /** Controller whose track is loaded in the player bar (playback target). */
    private get playback(): PlayerController {
        return this.playingController ?? this.manager.activeController;
    }

    /* ------------------------------- DOM refs ------------------------------- */
    private nowCover!: HTMLImageElement;
    private heroCover!: HTMLImageElement;
    private heroTitle!: HTMLElement;
    private heroArtist!: HTMLElement;
    private heroTags!: HTMLElement;
    private heroPosition!: HTMLElement;
    private heroEqualizer!: HTMLElement;
    private nowTitle!: HTMLElement;
    private nowArtist!: HTMLElement;
    private nowTags!: HTMLElement;
    private nowPosition!: HTMLElement;
    private equalizer!: HTMLElement;
    private progressBar!: HTMLInputElement;
    private timeCurrent!: HTMLElement;
    private timeTotal!: HTMLElement;
    private playerStatus!: HTMLElement;
    private btnPrevious!: HTMLButtonElement;
    private btnPlay!: HTMLButtonElement;
    private btnNext!: HTMLButtonElement;
    private btnLoop!: HTMLButtonElement;
    private loopIcon!: HTMLElement;
    private playIcon!: HTMLElement;

    private topSearch!: HTMLElement;
    private formSearch!: HTMLFormElement;
    private inputSearch!: HTMLInputElement;
    private btnSearch!: HTMLButtonElement;
    private searchDropdown!: HTMLElement;
    private inputYouTubeKey!: HTMLInputElement;
    private youtubeKeyConfig!: HTMLElement;
    private youtubeKeyAuto!: HTMLElement;
    private searchStatus!: HTMLElement;
    private searchResultsContainer!: HTMLElement;

    private inputVolume!: HTMLInputElement;
    private btnMute!: HTMLButtonElement;
    private volumeIcon!: HTMLElement;

    private formMood!: HTMLFormElement;
    private inputMood!: HTMLInputElement;
    private inputGroqKey!: HTMLInputElement;
    private groqKeyConfig!: HTMLElement;
    private groqKeyAuto!: HTMLElement;
    private moodStatus!: HTMLElement;
    private moodPreview!: HTMLElement;

    private playlistBody!: HTMLElement;
    private playlistCount!: HTMLElement;
    private playlistEmpty!: HTMLElement;
    private playlistPanel!: HTMLElement;
    private playlistActiveName!: HTMLElement;
    private homeSections!: HTMLElement;
    private btnReverse!: HTMLButtonElement;
    private btnClear!: HTMLButtonElement;
    private btnAddSong!: HTMLButtonElement;
    private selectSortCriteria!: HTMLSelectElement;
    private btnSortDirection!: HTMLButtonElement;
    private sortDirectionIcon!: HTMLElement;
    private sortDirectionLabel!: HTMLElement;
    private btnShuffle!: HTMLButtonElement;
    private btnDedupe!: HTMLButtonElement;
    private playlistDuration!: HTMLElement;
    private inputPlaylistSearch!: HTMLInputElement;
    private playlistSearchCount!: HTMLElement;
    private toast!: HTMLElement;
    private playerBar!: HTMLElement;

    /* Sidebar navigation */
    private sidebar!: HTMLElement;
    private sidebarOverlay!: HTMLElement;
    private btnSidebarToggle!: HTMLButtonElement;
    private navHome!: HTMLButtonElement;
    private btnNewPlaylist!: HTMLButtonElement;
    private btnTogglePlaylists!: HTMLButtonElement;
    private playlistsCaret!: HTMLElement;
    private playlistsPanel!: HTMLElement;
    private playlistTree!: HTMLElement;

    /* New playlist modal */
    private playlistModal!: HTMLElement;
    private formNewPlaylist!: HTMLFormElement;
    private inputPlaylistName!: HTMLInputElement;
    private playlistModalError!: HTMLElement;
    private btnCancelPlaylist!: HTMLButtonElement;

    /* Synchronized lyrics panel */
    private lyricsPanel!: HTMLElement;
    private lyricsContainer!: HTMLElement;
    private lyricsEmpty!: HTMLElement;
    private lyricsTitle!: HTMLElement;
    private lyricsArtist!: HTMLElement;
    private btnLyrics!: HTMLButtonElement;
    private btnCloseLyrics!: HTMLButtonElement;
    private linkSearchLyrics!: HTMLAnchorElement;

    /* Header utilities */
    private btnShortcuts!: HTMLButtonElement;
    private btnTheme!: HTMLButtonElement;
    private themeIcon!: HTMLElement;
    private shortcutsHelp!: HTMLElement;

    constructor() {
        this.player = new YouTubePlayer('yt-player', {
            onReady: () => {
                this.player.setVolume(Number(this.inputVolume.value));
                this.syncPlayerToCurrent(false);
            },
            onStateChange: (state) => this.handlePlayerState(state),
            onError: (code) => this.handlePlayerError(code),
            onProgress: (current, duration) => this.handleProgress(current, duration)
        });
    }

    /** Boots the UI: caches DOM, binds events, seeds the list and renders. */
    public async init(): Promise<void> {
        this.cacheElements();
        this.hydrateIcons();
        this.initTheme();
        this.bindEvents();
        this.configureEnvKeys();
        this.player.initialize();
        await this.loadCatalog();

        // The starter playlist is the initial playback source.
        this.playingController = this.manager.activeController;
        this.render();
    }

    /* ------------------------------- Setup ---------------------------------- */

    private cacheElements(): void {
        this.nowCover = requireElement<HTMLImageElement>('now-cover');
        this.nowTitle = requireElement('now-title');
        this.nowArtist = requireElement('now-artist');
        this.nowTags = requireElement('now-tags');
        this.nowPosition = requireElement('now-position');
        this.equalizer = requireElement('now-equalizer');

        this.heroCover = requireElement<HTMLImageElement>('hero-cover');
        this.heroTitle = requireElement('hero-title');
        this.heroArtist = requireElement('hero-artist');
        this.heroTags = requireElement('hero-tags');
        this.heroPosition = requireElement('hero-position');
        this.heroEqualizer = requireElement('hero-equalizer');
        this.progressBar = requireElement<HTMLInputElement>('progress-bar');
        this.timeCurrent = requireElement('time-current');
        this.timeTotal = requireElement('time-total');
        this.playerStatus = requireElement('player-status');

        this.btnPrevious = requireElement<HTMLButtonElement>('btn-previous');
        this.btnPlay = requireElement<HTMLButtonElement>('btn-play');
        this.btnNext = requireElement<HTMLButtonElement>('btn-next');
        this.btnLoop = requireElement<HTMLButtonElement>('btn-loop');
        this.loopIcon = requireElement('loop-icon');
        this.playIcon = requireElement('play-icon');

        this.topSearch = requireElement('top-search');
        this.formSearch = requireElement<HTMLFormElement>('form-search');
        this.inputSearch = requireElement<HTMLInputElement>('top-search-input');
        this.btnSearch = requireElement<HTMLButtonElement>('btn-search');
        this.searchDropdown = requireElement('search-dropdown');
        this.inputYouTubeKey = requireElement<HTMLInputElement>('input-youtube-key');
        this.youtubeKeyConfig = requireElement('youtube-key-config');
        this.youtubeKeyAuto = requireElement('youtube-key-auto');
        this.searchStatus = requireElement('search-status');
        this.searchResultsContainer = requireElement('search-results');

        this.inputVolume = requireElement<HTMLInputElement>('volume-bar');
        this.btnMute = requireElement<HTMLButtonElement>('btn-mute');
        this.volumeIcon = requireElement('volume-icon');

        this.formMood = requireElement<HTMLFormElement>('form-mood');
        this.inputMood = requireElement<HTMLInputElement>('input-mood');
        this.inputGroqKey = requireElement<HTMLInputElement>('input-groq-key');
        this.groqKeyConfig = requireElement('groq-key-config');
        this.groqKeyAuto = requireElement('groq-key-auto');
        this.moodStatus = requireElement('mood-status');
        this.moodPreview = requireElement('mood-preview');

        this.playlistBody = requireElement('playlist-body');
        this.playlistCount = requireElement('playlist-count');
        this.playlistEmpty = requireElement('playlist-empty');
        this.playlistPanel = requireElement('playlist-panel');
        this.playlistActiveName = requireElement('playlist-active-name');
        this.homeSections = requireElement('home-sections');
        this.btnReverse = requireElement<HTMLButtonElement>('btn-reverse');
        this.btnClear = requireElement<HTMLButtonElement>('btn-clear');
        this.btnAddSong = requireElement<HTMLButtonElement>('btn-add-song');
        this.selectSortCriteria = requireElement<HTMLSelectElement>('sort-criteria');
        this.btnSortDirection = requireElement<HTMLButtonElement>('btn-sort-direction');
        this.sortDirectionIcon = requireElement('sort-direction-icon');
        this.sortDirectionLabel = requireElement('sort-direction-label');
        this.btnShuffle = requireElement<HTMLButtonElement>('btn-shuffle');
        this.btnDedupe = requireElement<HTMLButtonElement>('btn-dedupe');
        this.playlistDuration = requireElement('playlist-duration');
        this.inputPlaylistSearch = requireElement<HTMLInputElement>('input-playlist-search');
        this.playlistSearchCount = requireElement('playlist-search-count');
        this.toast = requireElement('toast');
        this.playerBar = requireElement('player-bar');

        this.sidebar = requireElement('sidebar');
        this.sidebarOverlay = requireElement('sidebar-overlay');
        this.btnSidebarToggle = requireElement<HTMLButtonElement>('btn-sidebar-toggle');
        this.navHome = requireElement<HTMLButtonElement>('nav-home');
        this.btnNewPlaylist = requireElement<HTMLButtonElement>('btn-new-playlist');
        this.btnTogglePlaylists = requireElement<HTMLButtonElement>('btn-toggle-playlists');
        this.playlistsCaret = requireElement('playlists-caret');
        this.playlistsPanel = requireElement('playlists-panel');
        this.playlistTree = requireElement('playlist-tree');

        this.playlistModal = requireElement('playlist-modal');
        this.formNewPlaylist = requireElement<HTMLFormElement>('form-new-playlist');
        this.inputPlaylistName = requireElement<HTMLInputElement>('input-playlist-name');
        this.playlistModalError = requireElement('playlist-modal-error');
        this.btnCancelPlaylist = requireElement<HTMLButtonElement>('btn-cancel-playlist');

        this.lyricsPanel = requireElement('lyrics-panel');
        this.lyricsContainer = requireElement('lyrics-container');
        this.lyricsEmpty = requireElement('lyrics-empty');
        this.lyricsTitle = requireElement('lyrics-heading');
        this.lyricsArtist = requireElement('lyrics-artist');
        this.btnLyrics = requireElement<HTMLButtonElement>('btn-lyrics');
        this.btnCloseLyrics = requireElement<HTMLButtonElement>('btn-close-lyrics');
        this.linkSearchLyrics = requireElement<HTMLAnchorElement>('link-search-lyrics');

        this.btnShortcuts = requireElement<HTMLButtonElement>('btn-shortcuts');
        this.btnTheme = requireElement<HTMLButtonElement>('btn-theme');
        this.themeIcon = requireElement('theme-icon');
        this.shortcutsHelp = requireElement('shortcuts-help');
    }

    /**
     * Replaces every `[data-icon]` placeholder with its inline SVG. Keeping the
     * markup in one icon module guarantees a consistent, library-free icon set.
     */
    private hydrateIcons(): void {
        document.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
            const name = element.dataset.icon;
            if (name) {
                element.innerHTML = icon(name as Parameters<typeof icon>[0]);
            }
        });
    }

    private bindEvents(): void {
        this.btnPrevious.addEventListener('click', () => this.handlePrevious());
        this.btnNext.addEventListener('click', () => this.handleNext());
        this.btnLoop.addEventListener('click', () => this.handleLoopToggle());
        this.btnPlay.addEventListener('click', () => this.handlePlayPause());
        this.btnReverse.addEventListener('click', () => this.handleReverse());
        this.btnClear.addEventListener('click', () => this.handleClear());
        this.btnAddSong.addEventListener('click', () => this.handleAddSong());
        this.btnShortcuts.addEventListener('click', () => this.toggleShortcutsHelp());
        this.btnTheme.addEventListener('click', () => this.handleThemeToggle());
        this.selectSortCriteria.addEventListener('change', () => this.handleSort());
        this.btnSortDirection.addEventListener('click', () => this.handleSortDirectionToggle());
        this.btnShuffle.addEventListener('click', () => this.handleShuffle());
        this.btnDedupe.addEventListener('click', () => this.handleDedupe());
        this.inputPlaylistSearch.addEventListener('input', () => this.handlePlaylistSearch());

        // Sidebar navigation and playlist management.
        this.navHome.addEventListener('click', () => this.showHomeView());
        this.btnNewPlaylist.addEventListener('click', () => this.openPlaylistModal());
        this.btnTogglePlaylists.addEventListener('click', () => this.togglePlaylistsSection());
        this.playlistTree.addEventListener('click', (event) =>
            this.handlePlaylistTreeClick(event)
        );
        this.btnSidebarToggle.addEventListener('click', () => this.toggleSidebar());
        this.sidebarOverlay.addEventListener('click', () => this.closeSidebar());

        // New playlist modal.
        this.formNewPlaylist.addEventListener('submit', (event) =>
            this.handleCreatePlaylist(event)
        );
        this.btnCancelPlaylist.addEventListener('click', () => this.closePlaylistModal());
        this.playlistModal.addEventListener('click', (event) => {
            if (event.target === this.playlistModal) {
                this.closePlaylistModal();
            }
        });
        document.addEventListener('keydown', (event) => this.handleDocumentKeydown(event));

        // Synchronized lyrics panel.
        this.btnLyrics.addEventListener('click', () => this.handleLyricsToggle());
        this.btnCloseLyrics.addEventListener('click', () => this.closeLyricsPanel());

        this.inputVolume.addEventListener('input', () => this.handleVolumeInput());
        this.btnMute.addEventListener('click', () => this.handleMuteToggle());

        this.formSearch.addEventListener('submit', (event) => {
            void this.handleSearch(event);
        });
        this.inputSearch.addEventListener('focus', () => this.openSearchDropdown());
        this.searchResultsContainer.addEventListener('click', (event) =>
            this.handleSearchResultsClick(event)
        );
        this.searchResultsContainer.addEventListener('change', (event) =>
            this.handleSearchResultsChange(event)
        );

        // Close the search dropdown when interacting anywhere outside it.
        document.addEventListener('click', (event) => this.handleDocumentClick(event));

        this.formMood.addEventListener('submit', (event) => {
            void this.handleMood(event);
        });
        this.moodPreview.addEventListener('click', (event) =>
            this.handleMoodPreviewClick(event)
        );

        this.playlistBody.addEventListener('click', (event) => this.handlePlaylistClick(event));

        // Cover images may fail to load: the `error` event does not bubble, so
        // it is captured on the table body instead.
        this.playlistBody.addEventListener(
            'error',
            (event) => this.handleCoverError(event),
            true
        );

        // Native HTML5 drag and drop reordering, delegated to the table body.
        this.playlistBody.addEventListener('dragstart', (event) =>
            this.handleDragStart(event as DragEvent)
        );
        this.playlistBody.addEventListener('dragover', (event) =>
            this.handleDragOver(event as DragEvent)
        );
        this.playlistBody.addEventListener('drop', (event) => this.handleDrop(event as DragEvent));
        this.playlistBody.addEventListener('dragleave', (event) =>
            this.handleDragLeave(event as DragEvent)
        );
        this.playlistBody.addEventListener('dragend', () => this.resetDragState());

        this.nowCover.addEventListener('error', () => {
            if (this.nowCover.src !== PLACEHOLDER_COVER) {
                this.nowCover.src = PLACEHOLDER_COVER;
            }
        });

        this.heroCover.addEventListener('error', () => {
            if (this.heroCover.src !== PLACEHOLDER_COVER) {
                this.heroCover.src = PLACEHOLDER_COVER;
            }
        });

        // Range seek: `input` tracks the drag, `change` commits the seek.
        this.progressBar.addEventListener('input', () => {
            this.isSeeking = true;
            this.timeCurrent.textContent = formatTime(this.seekTargetSeconds());
        });
        this.progressBar.addEventListener('change', () => {
            this.player.seekTo(this.seekTargetSeconds());
            this.isSeeking = false;
        });
    }

    /** Loads the initial catalog and seeds the doubly linked list. */
    private async loadCatalog(): Promise<void> {
        try {
            this.catalog = await this.musicService.searchMusic('');
        } catch {
            this.catalog = [];
        }

        for (const song of this.catalog) {
            this.active.addTrack(song, 'end');
        }
    }

    /**
     * Applies the `.env` keys to the UI: when a key is provided, the manual
     * input is pre-filled and its advanced block is hidden behind an
     * "auto-configured" note. When no key is present, the manual fields stay
     * visible so users can still paste one.
     */
    private configureEnvKeys(): void {
        if (this.youtubeApiKey) {
            this.inputYouTubeKey.value = this.youtubeApiKey;
            this.youtubeKeyConfig.hidden = true;
            this.youtubeKeyAuto.hidden = false;
        }

        if (this.groqApiKey) {
            this.inputGroqKey.value = this.groqApiKey;
            this.groqKeyConfig.hidden = true;
            this.groqKeyAuto.hidden = false;
        }
    }

    /* ------------------------- Sidebar and playlists ------------------------ */

    /** Shows the Home view (now playing hero + AI assistant). */
    private showHomeView(): void {
        this.currentView = 'home';
        this.renderView();
        this.closeSidebar();
    }

    /** Handles clicks inside the sidebar playlist tree. */
    private handlePlaylistTreeClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('button[data-action]') as HTMLButtonElement | null;
        if (!button) {
            return;
        }

        const id = button.dataset.id;
        if (!id) {
            return;
        }

        if (button.dataset.action === 'select') {
            this.selectPlaylist(id);
        } else if (button.dataset.action === 'delete') {
            this.handleDeletePlaylist(id);
        }
    }

    /** Switches the active playlist and reveals its tracks table. */
    private selectPlaylist(id: string): void {
        this.manager.setActivePlaylist(id);
        this.currentView = 'playlist';
        this.render();
        this.closeSidebar();
        this.setStatus(`Lista activa: ${this.manager.activeName}`);
    }

    private openPlaylistModal(): void {
        this.inputPlaylistName.value = '';
        this.playlistModalError.textContent = '';
        this.playlistModal.hidden = false;
        this.inputPlaylistName.focus();
    }

    private closePlaylistModal(): void {
        this.playlistModal.hidden = true;
    }

    /** Creates a new playlist from the modal form. */
    private handleCreatePlaylist(event: Event): void {
        event.preventDefault();

        const name = this.inputPlaylistName.value.trim();
        if (!name) {
            this.playlistModalError.textContent = 'Escribe un nombre para la lista.';
            this.inputPlaylistName.focus();
            return;
        }

        const id = this.manager.createPlaylist(name);
        this.closePlaylistModal();

        // Reveal the freshly created playlist right away.
        this.currentView = 'playlist';
        this.selectPlaylist(id);
        this.showToast(`Lista "${this.manager.activeName}" creada`);
    }

    /** Deletes a custom playlist after a confirmation prompt. */
    private handleDeletePlaylist(id: string): void {
        const summary = this.manager.getPlaylists().find((playlist) => playlist.id === id);
        if (!summary) {
            return;
        }

        const confirmed = window.confirm(
            `¿Eliminar la lista "${summary.name}"? Esta acción no se puede deshacer.`
        );
        if (!confirmed) {
            return;
        }

        // Stop playback when the removed playlist is the one currently loaded.
        const controller = this.manager.getController(id);
        if (controller !== null && controller === this.playingController) {
            this.playingController = null;
            this.isPlaying = false;
            this.player.pause();
            this.loadedVideoId = null;
        }

        if (!this.manager.deletePlaylist(id)) {
            this.setStatus('No se puede eliminar esta lista');
            return;
        }

        this.render();
        this.setStatus('Lista eliminada');
        this.showToast('Lista eliminada');
    }

    /** Collapses or expands the "Mis Playlists" section. */
    private togglePlaylistsSection(): void {
        const isOpen = this.btnTogglePlaylists.getAttribute('aria-expanded') !== 'false';
        const nextOpen = !isOpen;

        this.btnTogglePlaylists.setAttribute('aria-expanded', String(nextOpen));
        this.playlistsPanel.hidden = !nextOpen;
        this.playlistsCaret.textContent = nextOpen ? '▾' : '▸';
    }

    private toggleSidebar(): void {
        const isOpen = this.sidebar.classList.toggle('is-open');
        this.sidebarOverlay.hidden = !isOpen;
    }

    private closeSidebar(): void {
        this.sidebar.classList.remove('is-open');
        this.sidebarOverlay.hidden = true;
    }

    /**
     * Global keyboard handling:
     * - Escape closes the top-most overlay.
     * - Space / arrows drive playback, but only when the focus is NOT inside a
     *   text field, so typing is never hijacked.
     */
    private handleDocumentKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            if (!this.shortcutsHelp.hidden) {
                this.closeShortcutsHelp();
            } else if (!this.playlistModal.hidden) {
                this.closePlaylistModal();
            } else if (this.isLyricsOpen) {
                this.closeLyricsPanel();
            } else {
                this.closeSidebar();
            }
            return;
        }

        if (this.isTypingTarget(event.target)) {
            return;
        }

        if (event.key === ' ' || event.code === 'Space') {
            event.preventDefault();
            this.handlePlayPause();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.handleNext();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.handlePrevious();
        }
    }

    /** True when the event target is an editable field (input/textarea/select). */
    private isTypingTarget(target: EventTarget | null): boolean {
        const element = target as HTMLElement | null;
        if (!element) {
            return false;
        }

        const tag = element.tagName;
        return (
            tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
        );
    }

    /* --------------------------- Header utilities --------------------------- */

    /** Opens/closes the floating keyboard-shortcuts help panel. */
    private toggleShortcutsHelp(): void {
        const isOpen = this.shortcutsHelp.hidden;
        this.shortcutsHelp.hidden = !isOpen;
        this.btnShortcuts.setAttribute('aria-expanded', String(isOpen));
    }

    private closeShortcutsHelp(): void {
        if (this.shortcutsHelp.hidden) {
            return;
        }
        this.shortcutsHelp.hidden = true;
        this.btnShortcuts.setAttribute('aria-expanded', 'false');
    }

    /** Reads the saved theme (already applied pre-paint) into UI state. */
    private initTheme(): void {
        const stored = document.documentElement.getAttribute('data-theme');
        this.theme = stored === 'dark' ? 'dark' : 'light';
        this.applyTheme(this.theme);
    }

    private handleThemeToggle(): void {
        this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
    }

    /** Applies a theme to `<html>`, the toggle icon and localStorage. */
    private applyTheme(theme: 'light' | 'dark'): void {
        this.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        this.themeIcon.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
        const isDark = theme === 'dark';
        this.btnTheme.setAttribute('aria-pressed', String(isDark));
        this.btnTheme.title = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';

        try {
            localStorage.setItem('uccplay-theme', theme);
        } catch {
            /* Persisting is best-effort; the theme still applies this session. */
        }
    }

    /** Focuses the top search and opens the dropdown with the three add options. */
    private handleAddSong(): void {
        this.openSearchDropdown();
        this.setSearchStatus(
            'Elige dónde agregar: Al Inicio, Al Final o una Posición específica.',
            'info'
        );
        this.inputSearch.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ------------------------- Synchronized lyrics -------------------------- */

    /** Toggles the lyrics side panel from the player bar button. */
    private handleLyricsToggle(): void {
        if (this.isLyricsOpen) {
            this.closeLyricsPanel();
        } else {
            this.openLyricsPanel();
        }
    }

    private openLyricsPanel(): void {
        this.isLyricsOpen = true;
        this.lyricsPanel.hidden = false;
        this.btnLyrics.classList.add('is-active');
        this.btnLyrics.setAttribute('aria-pressed', 'true');

        void this.loadLyrics();
    }

    private closeLyricsPanel(): void {
        this.isLyricsOpen = false;
        this.lyricsPanel.hidden = true;
        this.btnLyrics.classList.remove('is-active');
        this.btnLyrics.setAttribute('aria-pressed', 'false');
    }

    /** Reloads lyrics when the playing song changes while the panel is open. */
    private maybeReloadLyrics(songId: string): void {
        if (this.isLyricsOpen && songId !== this.lyricsSongId) {
            void this.loadLyrics();
        }
    }

    /** Strips YouTube noise (e.g. "(Official Video)") from a track title. */
    private cleanTrackTitle(title: string): string {
        const noisePattern = /official|video|audio|lyric|lyrics|visualizer|hd|4k|remaster|music video|\bmv\b/i;
        const cleaned = title
            .replace(/\(([^)]*)\)/g, (segment, inner: string) =>
                noisePattern.test(inner) ? '' : segment
            )
            .replace(/\[([^\]]*)\]/g, (segment, inner: string) =>
                noisePattern.test(inner) ? '' : segment
            )
            .replace(/\s{2,}/g, ' ')
            .trim();

        return cleaned || title.trim();
    }

    /** Strips YouTube channel suffixes ("- Topic", "VEVO") from an artist. */
    private cleanArtistName(artist: string): string {
        const cleaned = artist
            .replace(/\s*-\s*topic\s*$/i, '')
            .replace(/\s*vevo\s*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return cleaned || artist.trim();
    }

    /**
     * Loads synchronized lyrics for the current track.
     *
     * Handles three states: a loading placeholder, the rendered synced lines,
     * or the centered fallback when no lyrics are available.
     */
    private async loadLyrics(): Promise<void> {
        const song = this.playback.currentSong;
        const requestId = ++this.lyricsRequestId;

        this.lyricsSongId = song?.videoId ?? null;
        this.lyrics = [];
        this.lyricLineElements = [];
        this.activeLyricIndex = -1;

        this.lyricsTitle.textContent = song?.title ?? 'Sin canción';
        this.lyricsArtist.textContent = song?.artist ?? '—';
        this.updateSearchLyricsLink(song?.title, song?.artist);

        if (!song) {
            this.showLyricsFallback();
            return;
        }

        // Loading state with a subtle spinner.
        this.lyricsEmpty.hidden = true;
        this.lyricsContainer.hidden = false;
        this.lyricsContainer.innerHTML =
            '<p class="lyrics-loading"><span class="lyrics-spinner" aria-hidden="true"></span>' +
            'Cargando letra sincronizada...</p>';

        try {
            // LRCLIB matches best on a cleaned title/artist, so strip the noise
            // YouTube adds (e.g. "(Official Video)", "- Topic").
            const lines = await this.lyricsService.fetchSyncedLyrics(
                this.cleanTrackTitle(song.title),
                this.cleanArtistName(song.artist),
                song.duration
            );
            if (requestId !== this.lyricsRequestId) {
                return; // A newer request superseded this one.
            }

            // No real synced lyrics found: show the not-available fallback.
            if (lines === null || lines.length === 0) {
                this.showLyricsFallback();
                return;
            }

            this.lyrics = lines;
            this.renderLyricsLines();
            this.syncLyrics(this.player.getCurrentTime());
        } catch {
            if (requestId !== this.lyricsRequestId) {
                return;
            }
            this.showLyricsFallback();
        }
    }

    /** Renders each timed line as a paragraph inside the scroll container. */
    private renderLyricsLines(): void {
        this.lyricsEmpty.hidden = true;
        this.lyricsContainer.hidden = false;
        this.lyricsContainer.innerHTML = this.lyrics
            .map(
                (line, index) =>
                    `<p class="lyric-line" data-index="${index}">${escapeHtml(line.text)}</p>`
            )
            .join('');

        this.lyricLineElements = Array.from(
            this.lyricsContainer.querySelectorAll<HTMLElement>('.lyric-line')
        );
    }

    /** Shows the centered "lyrics not available" fallback state. */
    private showLyricsFallback(): void {
        this.lyrics = [];
        this.lyricLineElements = [];
        this.activeLyricIndex = -1;
        this.lyricsContainer.hidden = true;
        this.lyricsEmpty.hidden = false;
    }

    /** Points the fallback button at a Google search for "<title> <artist> letra". */
    private updateSearchLyricsLink(title?: string, artist?: string): void {
        if (!title) {
            this.linkSearchLyrics.href = '#';
            this.linkSearchLyrics.classList.add('is-disabled');
            this.linkSearchLyrics.setAttribute('aria-disabled', 'true');
            return;
        }

        const query = `${title} ${artist ?? ''} letra`.trim();
        this.linkSearchLyrics.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        this.linkSearchLyrics.classList.remove('is-disabled');
        this.linkSearchLyrics.removeAttribute('aria-disabled');
    }

    /**
     * Highlights the lyric line active at `currentTime` and scrolls it to the
     * middle of the view. Inactive lines stay dimmed via CSS.
     */
    private syncLyrics(currentTime: number): void {
        if (this.lyrics.length === 0) {
            return;
        }

        // Last line whose timestamp is <= currentTime (lines are ascending).
        let index = -1;
        for (let i = 0; i < this.lyrics.length; i++) {
            if (currentTime >= this.lyrics[i].time) {
                index = i;
            } else {
                break;
            }
        }

        // Nothing changed: keep the current highlight and scroll position.
        if (index === this.activeLyricIndex) {
            return;
        }

        this.activeLyricIndex = index;

        this.lyricLineElements.forEach((element, lineIndex) => {
            element.classList.toggle('is-active', lineIndex === index);
        });

        const activeElement = index >= 0 ? this.lyricLineElements[index] : null;
        activeElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------------------------- Playback logic ---------------------------- */

    private handlePlayPause(): void {
        if (!this.playback.currentSong) {
            this.setStatus('No hay canciones en la lista');
            return;
        }

        if (this.isPlaying) {
            this.player.pause();
        } else if (this.loadedVideoId === this.playback.currentSong.videoId) {
            this.player.play();
        } else {
            this.syncPlayerToCurrent(true);
        }
    }

    private handleNext(): void {
        // Manual advance: always moves to a real next node, even in track repeat.
        if (this.playback.next({ auto: false })) {
            this.onTrackChanged();
        }
    }

    private handlePrevious(): void {
        if (!this.playback.currentSong) {
            return;
        }

        // Past the threshold: restart the current track instead of stepping back.
        if (this.player.getCurrentTime() > PREVIOUS_RESTART_THRESHOLD) {
            this.player.seekTo(0);
            this.progressBar.value = '0';
            this.timeCurrent.textContent = '0:00';
            return;
        }

        if (this.playback.previous()) {
            this.onTrackChanged();
        }
    }

    /** Cycles the repeat strategy and reports the new state. */
    private handleLoopToggle(): void {
        const mode = this.playback.toggleLoopMode();
        const messages: Record<LoopMode, string> = {
            off: 'Repetición desactivada',
            track: 'Repitiendo la canción actual',
            playlist: 'Repitiendo toda la lista'
        };

        this.renderControls();
        this.setStatus(messages[mode]);
        this.showToast(messages[mode]);
    }

    /** Reverses the doubly linked list in place and re-renders the view. */
    private handleReverse(): void {
        if (this.active.length < 2) {
            this.setStatus('La lista necesita al menos 2 canciones para invertirse');
            return;
        }

        this.active.reversePlaylist();
        this.render();
        this.setStatus('Lista invertida');
        this.showToast('Lista invertida');
    }

    /** Empties the active playlist; stops audio only if it was playing it. */
    private handleClear(): void {
        if (this.active.length === 0) {
            this.setStatus('La lista ya está vacía');
            return;
        }

        const wasPlayingActive = this.playback === this.active;
        this.active.clearPlaylist();

        if (wasPlayingActive) {
            this.stopPlayback();
        }

        this.render();
        this.setStatus('Lista vaciada');
        this.showToast('Lista limpiada');
    }

    /**
     * Stops the audio and leaves the progress bar in a clean state. Shared by
     * "Vaciar lista" and by deleting the last track while it is playing.
     */
    private stopPlayback(): void {
        this.isPlaying = false;
        this.player.pause();
        this.loadedVideoId = null;
        this.playerDuration = 0;
        this.progressBar.value = '0';
        this.timeCurrent.textContent = '0:00';
        this.timeTotal.textContent = '0:00';
    }

    /* ------------------------------ Volume ---------------------------------- */

    private handleVolumeInput(): void {
        const volume = Number(this.inputVolume.value);
        this.player.setVolume(volume);

        // Dragging the slider off zero unmutes automatically.
        if (this.isMuted && volume > 0) {
            this.isMuted = false;
            this.player.unMute();
        }

        this.renderVolume();
    }

    private handleMuteToggle(): void {
        this.isMuted = !this.isMuted;

        if (this.isMuted) {
            this.player.mute();
        } else {
            this.player.unMute();
        }

        this.renderVolume();
    }

    /** Syncs the mute button icon/tooltip with the current volume state. */
    private renderVolume(): void {
        const volume = Number(this.inputVolume.value);
        const silent = this.isMuted || volume === 0;

        this.btnMute.setAttribute('aria-pressed', String(this.isMuted));
        this.btnMute.title = this.isMuted ? 'Activar sonido' : 'Silenciar';
        this.volumeIcon.innerHTML = icon(
            silent ? 'volumeMute' : volume < 50 ? 'volumeLow' : 'volumeHigh'
        );
    }

    /** Re-renders and keeps the player aligned after a navigation change. */
    private onTrackChanged(): void {
        this.render();
        this.syncPlayerToCurrent(this.isPlaying);
        this.setStatus(this.isPlaying ? 'Reproduciendo' : 'Listo para reproducir');
    }

    /** Loads the current node's video into the player. */
    private syncPlayerToCurrent(autoplay: boolean): void {
        const song = this.playback.currentSong;
        if (!song || !this.player.isReady()) {
            // On ready the player invokes this again with the latest current node.
            return;
        }

        this.player.load(song.videoId, autoplay);
        this.loadedVideoId = song.videoId;
        this.playerDuration = song.duration > 0 ? song.duration : this.playerDuration;

        // Refresh the lyrics when the loaded track changes.
        this.maybeReloadLyrics(song.videoId);

        if (autoplay) {
            this.player.play();
        }
    }

    private handlePlayerState(state: number): void {
        if (state === YouTubePlayerState.PLAYING) {
            this.isPlaying = true;
            this.setStatus('Reproduciendo');
        } else if (state === YouTubePlayerState.PAUSED) {
            this.isPlaying = false;
            this.setStatus('En pausa');
        } else if (state === YouTubePlayerState.CUED) {
            this.isPlaying = false;
            this.setStatus('Listo para reproducir');
        } else if (state === YouTubePlayerState.ENDED) {
            // Automatic advance: honors track/playlist repeat via next({ auto: true }).
            this.isPlaying = false;
            if (this.playback.next({ auto: true })) {
                this.render();
                this.syncPlayerToCurrent(true);
            } else {
                this.setStatus('Fin de la lista');
            }
        }

        this.renderControls();
        this.renderEqualizer();
        this.renderRowPlayingState();
    }

    /** Toggles the animated equalizer on the active row without a full re-render. */
    private renderRowPlayingState(): void {
        const activeRow = this.playlistBody.querySelector<HTMLElement>('tr.is-active');
        if (activeRow) {
            activeRow.classList.toggle('is-playing', this.isPlaying);
        }
    }

    /**
     * Handles IFrame player errors (codes 2, 5, 100, 101, 150): shows a Spanish
     * message and, when a next track exists, skips to it after 2 seconds.
     */
    private handlePlayerError(code: number): void {
        const blockedCodes = [2, 5, 100, 101, 150];
        if (!blockedCodes.includes(code)) {
            return;
        }

        this.isPlaying = false;
        this.setStatus(MESSAGES.player.videoUnavailable);
        this.showToast(MESSAGES.player.videoUnavailable);
        this.renderRowPlayingState();

        if (this.playback.hasNext) {
            window.setTimeout(() => {
                if (this.playback.next({ auto: true })) {
                    this.render();
                    this.syncPlayerToCurrent(true);
                }
            }, 2000);
        }
    }

    private handleProgress(currentTime: number, duration: number): void {
        if (duration > 0) {
            this.playerDuration = duration;
        }

        const total = this.playerDuration;
        if (!this.isSeeking && total > 0) {
            this.progressBar.value = String(Math.min(100, (currentTime / total) * 100));
            this.timeCurrent.textContent = formatTime(currentTime);
        }
        this.timeTotal.textContent = total > 0 ? formatTime(total) : '0:00';

        // Drive the synchronized lyrics highlight/auto-scroll from playback time.
        if (this.isLyricsOpen) {
            this.syncLyrics(currentTime);
        }
    }

    private seekTargetSeconds(): number {
        const percent = Number(this.progressBar.value);
        return this.playerDuration > 0 ? (percent / 100) * this.playerDuration : 0;
    }

    /* ---------------------------- Search panel ------------------------------ */

    /** Resolves the YouTube API key from the form field or the `.env` value. */
    private getYouTubeApiKey(): string | undefined {
        const fromInput = this.inputYouTubeKey.value.trim();
        return fromInput || this.youtubeApiKey;
    }

    /** Opens the results dropdown anchored beneath the top search bar. */
    private openSearchDropdown(): void {
        this.searchDropdown.classList.add('is-open');
    }

    private closeSearchDropdown(): void {
        this.searchDropdown.classList.remove('is-open');
    }

    /** Closes the search dropdown / shortcuts help when clicking outside them. */
    private handleDocumentClick(event: Event): void {
        const target = event.target;

        if (
            !this.shortcutsHelp.hidden &&
            target instanceof Node &&
            !this.shortcutsHelp.contains(target) &&
            !this.btnShortcuts.contains(target)
        ) {
            this.closeShortcutsHelp();
        }

        if (target instanceof Node && this.topSearch.contains(target)) {
            return;
        }
        this.closeSearchDropdown();
    }

    private async handleSearch(event: Event): Promise<void> {
        event.preventDefault();

        const query = this.inputSearch.value.trim();
        if (!query) {
            this.searchResults = [];
            this.renderSearchResults();
            this.setSearchStatus('Escribe una canción o artista para buscar.', 'error');
            return;
        }

        const apiKey = this.getYouTubeApiKey();
        this.setSearchStatus(
            apiKey ? 'Buscando en YouTube Data API...' : 'Buscando en el catálogo local...',
            'info'
        );
        this.btnSearch.disabled = true;

        try {
            const results = await this.musicService.searchMusic(query, apiKey);
            this.searchResults = results;
            this.renderSearchResults();

            if (results.length === 0) {
                this.setSearchStatus('No se encontraron canciones para esa búsqueda.', 'error');
            } else {
                this.setSearchStatus(`${results.length} resultado(s) encontrado(s).`, 'success');
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.searchResults = [];
            this.renderSearchResults();
            this.setSearchStatus(`No se pudo buscar: ${reason}`, 'error');
        } finally {
            this.btnSearch.disabled = false;
        }
    }

    /** Renders the current `searchResults` as interactive cards. */
    private renderSearchResults(): void {
        if (this.searchResults.length === 0) {
            this.searchResultsContainer.innerHTML = '';
            return;
        }

        this.openSearchDropdown();

        // 1-based position range shown in the UI; converted to 0-based on insert.
        const maxPosition = this.active.length + 1;

        this.searchResultsContainer.innerHTML = this.searchResults
            .map((song, index) => {
                const tags = (song.moodTags ?? [])
                    .map((tag) => `<span class="result-card__tag">${escapeHtml(tag)}</span>`)
                    .join('');

                return `
                    <article class="result-card">
                        <img class="result-card__cover" src="${escapeHtml(song.albumCover)}"
                            alt="Portada de ${escapeHtml(song.title)}" loading="lazy" />
                        <div class="result-card__info">
                            <p class="result-card__title">${escapeHtml(song.title)}</p>
                            <p class="result-card__artist">${escapeHtml(song.artist)}</p>
                            <div class="result-card__meta">
                                <span class="result-card__duration">${formatDuration(song.duration)}</span>
                                ${tags}
                            </div>
                        </div>
                        <div class="result-card__actions">
                            <button class="btn result-card__play" type="button"
                                data-action="play-now" data-index="${index}"
                                title="Reproducir ${escapeHtml(song.title)} ahora">${icon('play')} Reproducir ahora</button>
                            <button class="btn btn-ghost result-card__play-next" type="button"
                                data-action="play-next" data-index="${index}"
                                title="Reproducir ${escapeHtml(song.title)} a continuación">${icon('listPlus')} Reproducir a continuación</button>
                            <select class="result-card__position" data-role="position"
                                aria-label="Posición para ${escapeHtml(song.title)}">
                                <option value="end">Al Final (posición ${maxPosition})</option>
                                <option value="start">Al Inicio (posición 1)</option>
                                <option value="index">Posición específica (1 a ${maxPosition})</option>
                            </select>
                            <input class="result-card__index" data-role="index" type="number"
                                min="1" max="${maxPosition}" step="1" placeholder="1 a ${maxPosition}" hidden
                                aria-label="Posición (1 a ${maxPosition})" />
                            <button class="btn btn-secondary result-card__add" type="button"
                                data-action="add" data-index="${index}">${icon('plus')} Agregar a la Lista</button>
                        </div>
                    </article>`;
            })
            .join('');
    }

    /** Shows and focuses the position input when a card switches to a specific slot. */
    private handleSearchResultsChange(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (target instanceof HTMLSelectElement && target.dataset.role === 'position') {
            const card = target.closest('.result-card');
            const indexInput = card?.querySelector<HTMLInputElement>('input[data-role="index"]');
            if (indexInput) {
                indexInput.hidden = target.value !== 'index';
                if (!indexInput.hidden) {
                    indexInput.focus();
                }
            }
        }
    }

    /** Adds or instantly plays the selected search result. */
    private handleSearchResultsClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('button[data-action]') as HTMLButtonElement | null;
        if (!button) {
            return;
        }

        const action = button.dataset.action;
        if (action !== 'add' && action !== 'play-now' && action !== 'play-next') {
            return;
        }

        const index = Number(button.dataset.index);
        const song = this.searchResults[index];
        if (!song) {
            return;
        }

        // Copy with a unique id so `deleteById` always targets the right row.
        const uniqueSong: Song = { ...song, id: this.uniqueId(song.id) };

        if (action === 'play-now') {
            this.handleInstantPlay(uniqueSong);
            return;
        }

        if (action === 'play-next') {
            this.handlePlayNext(uniqueSong);
            return;
        }

        const card = button.closest('.result-card');
        const positionSelect = card?.querySelector<HTMLSelectElement>('select[data-role="position"]');
        const indexInput = card?.querySelector<HTMLInputElement>('input[data-role="index"]');
        const position = (positionSelect?.value ?? 'end') as 'start' | 'end' | 'index';

        // The UI uses 1-based positions; `insertAt` expects a 0-based index.
        let insertIndex: number | undefined;
        if (position === 'index') {
            const raw = Math.trunc(Number(indexInput?.value));
            const maxPosition = this.active.length + 1;
            if (!Number.isInteger(raw) || raw < 1 || raw > maxPosition) {
                this.setSearchStatus(
                    `Posición inválida. Usa un número entre 1 y ${maxPosition}.`,
                    'error'
                );
                indexInput?.focus();
                return;
            }
            insertIndex = raw - 1;
        }

        if (!this.active.addTrack(uniqueSong, position, insertIndex)) {
            this.setSearchStatus('No se pudo agregar la canción a la lista.', 'error');
            return;
        }

        // Register the song in the mood catalog so it can be recommended later.
        this.catalog.push(uniqueSong);
        this.showToast('¡Canción agregada a la lista!');
        this.render();
    }

    /** Queues a track right after the current one, without starting playback. */
    private handlePlayNext(song: Song): void {
        this.active.insertNext(song);
        this.catalog.push(song);
        this.render();
        this.showToast(`A continuación: ${song.title}`);
    }

    /**
     * Instantly plays a search result: splices it as a new node into the active
     * queue right after the current track, points the player at it and starts
     * playback, then refreshes the bottom player bar.
     */
    private handleInstantPlay(song: Song): void {
        // Route the player bar to the active playlist before inserting.
        this.playingController = this.active;

        if (this.active.playNow(song) === null) {
            this.setSearchStatus('No se pudo reproducir la canción.', 'error');
            return;
        }

        // Register the song in the mood catalog so it can be recommended later.
        this.catalog.push(song);

        this.render();
        this.isPlaying = true;
        this.syncPlayerToCurrent(true);
        this.closeSearchDropdown();
        this.scrollPlaybackIntoView();
        this.showToast(`Reproduciendo: ${song.title}`);
    }

    /** Brings the freshly started track into view in the table and player bar. */
    private scrollPlaybackIntoView(): void {
        this.playlistBody
            .querySelector<HTMLElement>('tr.is-active')
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.playerBar.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    /**
     * Guarantees a unique `id` so `deleteById` always targets the right row.
     * Only the playlist `id` changes; `videoId` is preserved for the player.
     */
    private uniqueId(baseId: string): string {
        return uniqueSongId(
            baseId,
            this.active.playlist.map((song) => song.id)
        );
    }

    private showToast(message: string): void {
        this.toast.textContent = message;
        this.toast.classList.add('is-visible');

        if (this.toastTimer !== null) {
            window.clearTimeout(this.toastTimer);
        }
        this.toastTimer = window.setTimeout(() => {
            this.toast.classList.remove('is-visible');
        }, 2600);
    }

    /* ----------------------------- Mood assistant --------------------------- */

    /**
     * Handles a mood submission: it resets the resolver and shows the first
     * validated suggestion as a preview card. It never auto-plays nor reorders
     * the active list.
     */
    private async handleMood(event: Event): Promise<void> {
        event.preventDefault();

        const mood = this.inputMood.value.trim();
        if (!mood) {
            this.setMoodStatus(MESSAGES.mood.missingPrompt, 'error');
            return;
        }

        // A brand-new prompt resets the resolver and the "Generar otra" history.
        this.lastMoodPrompt = mood;
        this.moodResolver = null;
        this.clearMoodPreview();

        await this.generateMoodSuggestion();
    }

    /**
     * Resolves the next AI suggestion into a validated YouTube track. Pending
     * suggestions are consumed first, so "Generar otra opción" does not call
     * Groq again while suggestions remain.
     */
    private async generateMoodSuggestion(): Promise<void> {
        if (this.isGeneratingSuggestion) {
            return;
        }

        this.isGeneratingSuggestion = true;
        this.setMoodActionsDisabled(true);
        this.setMoodStatus(MESSAGES.mood.searching, 'info');

        // Prefer the field values, then fall back to the `.env` keys.
        const groqKey = this.inputGroqKey.value.trim() || this.groqApiKey || '';
        const youtubeKey = this.getYouTubeApiKey();

        if (!groqKey) {
            this.clearMoodPreview();
            this.setMoodStatus(MESSAGES.mood.missingGroqKey, 'error');
            this.isGeneratingSuggestion = false;
            this.setMoodActionsDisabled(false);
            return;
        }

        try {
            if (!this.moodResolver) {
                this.moodResolver = new MoodSuggestionResolver(
                    this.moodService,
                    this.musicService,
                    groqKey,
                    youtubeKey
                );
            }

            const resolved = await this.moodResolver.next(this.lastMoodPrompt);
            if (!resolved) {
                this.clearMoodPreview();
                this.setMoodStatus(MESSAGES.mood.noSuggestion, 'error');
                return;
            }

            // Only a validated YouTube track is ever rendered in the card.
            this.moodPreviewSong = resolved.song;
            this.moodPreviewReason = resolved.reason;
            this.moodPreviewValidated = true;
            this.renderMoodPreview();
            this.setMoodStatus(MESSAGES.mood.ready, 'success');
        } catch (error) {
            this.clearMoodPreview();
            this.setMoodStatus(this.describeMoodError(error), 'error');
        } finally {
            this.isGeneratingSuggestion = false;
            this.setMoodActionsDisabled(false);
        }
    }

    /** Maps a resolver failure to a Spanish message. */
    private describeMoodError(error: unknown): string {
        if (error instanceof YouTubeSearchError) {
            if (error.kind === 'quota') {
                return MESSAGES.mood.youtubeQuota;
            }
            if (error.kind === 'invalid_key') {
                return MESSAGES.mood.youtubeInvalidKey;
            }
            if (error.kind === 'network') {
                return MESSAGES.mood.youtubeNetwork;
            }
            return MESSAGES.mood.noSuggestion;
        }
        return MESSAGES.mood.invalidSuggestion;
    }

    /** Clears the AI preview card and its validated state. */
    private clearMoodPreview(): void {
        this.moodPreviewSong = null;
        this.moodPreviewReason = '';
        this.moodPreviewValidated = false;
        this.renderMoodPreview();
    }

    /** Renders the AI preview card, or hides it when there is no suggestion. */
    private renderMoodPreview(): void {
        const song = this.moodPreviewSong;
        if (!song) {
            this.moodPreview.hidden = true;
            this.moodPreview.innerHTML = '';
            return;
        }

        // The badge is only shown for a track that passed YouTube validation.
        const badge = this.moodPreviewValidated
            ? `<p class="mood-preview__badge">${escapeHtml(MESSAGES.preview.badge)}</p>`
            : '';

        this.moodPreview.hidden = false;
        this.moodPreview.innerHTML = `
            <article class="mood-preview__card">
                <img class="mood-preview__cover" src="${escapeHtml(song.albumCover)}"
                    alt="Portada de ${escapeHtml(song.title)}" loading="lazy" />
                <div class="mood-preview__info">
                    ${badge}
                    <p class="mood-preview__title">${escapeHtml(song.title)}</p>
                    <p class="mood-preview__artist">${escapeHtml(song.artist)}</p>
                    <p class="mood-preview__reason">${escapeHtml(
                        this.moodPreviewReason || MESSAGES.preview.defaultReason
                    )}</p>
                    <div class="mood-preview__meta">
                        <span class="result-card__duration">${formatDuration(song.duration)}</span>
                    </div>
                </div>
                <div class="mood-preview__actions">
                    <button class="btn mood-preview__play" type="button" data-action="play-now"
                        title="${escapeHtml(MESSAGES.preview.playNowTitle(song.title))}">${icon('play')} ${MESSAGES.preview.playNow}</button>
                    <button class="btn btn-ghost mood-preview__play-next" type="button" data-action="play-next"
                        title="${escapeHtml(MESSAGES.preview.playNextTitle(song.title))}">${icon('listPlus')} ${MESSAGES.preview.playNext}</button>
                    <button class="btn btn-secondary mood-preview__add" type="button" data-action="add"
                        title="${escapeHtml(MESSAGES.preview.addTitle(song.title))}">${icon('plus')} ${MESSAGES.preview.add}</button>
                    <button class="btn btn-ghost mood-preview__again" type="button" data-action="regenerate"
                        title="${MESSAGES.preview.regenerateTitle}">${icon('refresh')} ${MESSAGES.preview.regenerate}</button>
                </div>
            </article>`;
    }

    /** Handles the preview card actions: play, add, or regenerate. */
    private handleMoodPreviewClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('button[data-action]') as HTMLButtonElement | null;
        if (!button) {
            return;
        }

        if (button.dataset.action === 'regenerate') {
            // The resolver consumes pending suggestions before calling Groq again.
            void this.generateMoodSuggestion();
            return;
        }

        const song = this.moodPreviewSong;
        if (!song) {
            return;
        }

        if (button.dataset.action === 'play-now') {
            this.handleInstantPlay({ ...song, id: this.uniqueId(song.id) });
            return;
        }

        if (button.dataset.action === 'play-next') {
            this.handlePlayNext({ ...song, id: this.uniqueId(song.id) });
            this.setMoodStatus(MESSAGES.mood.queuedNext, 'success');
            return;
        }

        if (button.dataset.action === 'add') {
            const uniqueSong: Song = { ...song, id: this.uniqueId(song.id) };
            if (!this.active.addTrack(uniqueSong, 'end')) {
                this.setMoodStatus(MESSAGES.mood.addFailed, 'error');
                return;
            }

            // Register the song in the mood catalog so it can be recommended later.
            this.catalog.push(uniqueSong);
            this.render();
            this.showToast(MESSAGES.preview.addedToast);
            this.setMoodStatus(MESSAGES.mood.added, 'success');
        }
    }

    /** Enables/disables every action button inside the AI preview card. */
    private setMoodActionsDisabled(disabled: boolean): void {
        this.moodPreview
            .querySelectorAll<HTMLButtonElement>('button[data-action]')
            .forEach((button) => {
                button.disabled = disabled;
            });
    }

    /* ------------------------------ Playlist table -------------------------- */

    /** Applies the selected sort criteria and direction (merge sort, O(n log n)). */
    private handleSort(): void {
        this.sortCriteria = this.selectSortCriteria.value as 'title' | 'artist' | 'duration';
        const direction = this.sortDirection === 'asc' ? 1 : -1;

        this.active.sort((a, b) => {
            let result: number;
            if (this.sortCriteria === 'duration') {
                result = a.duration - b.duration;
            } else if (this.sortCriteria === 'artist') {
                result = a.artist.localeCompare(b.artist, 'es');
            } else {
                result = a.title.localeCompare(b.title, 'es');
            }
            return result * direction;
        });

        const isAsc = this.sortDirection === 'asc';
        this.sortDirectionIcon.innerHTML = icon(isAsc ? 'arrowUp' : 'arrowDown');
        this.sortDirectionLabel.textContent = isAsc ? 'Ascendente' : 'Descendente';
        this.btnSortDirection.title = isAsc
            ? 'Ordenar ascendente (clic para descendente)'
            : 'Ordenar descendente (clic para ascendente)';
        this.selectSortCriteria.value = this.sortCriteria;

        this.render();
        this.setStatus(this.sortDirection === 'asc' ? 'Lista ordenada ascendente' : 'Lista ordenada descendente');
        this.showToast('Lista ordenada');
    }

    /** Flips ascending/descending and re-sorts with the current criteria. */
    private handleSortDirectionToggle(): void {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.handleSort();
    }

    /** Randomly reshuffles the queue, keeping the cursor on the current song. */
    private handleShuffle(): void {
        if (this.active.length < 2) {
            this.setStatus('La lista necesita al menos 2 canciones para mezclarse');
            return;
        }

        this.active.shuffle();
        this.render();
        this.setStatus('Lista mezclada');
        this.showToast('Lista mezclada');
    }

    /** Removes repeated tracks (same title + artist) from the active list. */
    private handleDedupe(): void {
        if (this.active.length === 0) {
            this.setStatus('La lista ya está vacía');
            return;
        }

        const wasPlayingActive = this.playback === this.active;
        const removed = this.active.removeDuplicates();
        if (removed === 0) {
            this.setStatus('No había canciones repetidas');
            return;
        }

        this.render();
        if (wasPlayingActive) {
            // The cursor may have moved to the surviving first occurrence.
            this.renderNowPlaying();
            this.renderControls();
        }

        this.setStatus(
            `Se quitaron ${removed} ${removed === 1 ? 'canción repetida' : 'canciones repetidas'}`
        );
        this.showToast(`Se quitaron ${removed} repetidas`);
    }

    /** Filters the rendered table by title/artist using `searchByText`. */
    private handlePlaylistSearch(): void {
        this.playlistSearchQuery = this.inputPlaylistSearch.value.trim();
        this.renderPlaylist();
    }

    private handlePlaylistClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const button = target?.closest('button[data-action]') as HTMLButtonElement | null;
        if (!button) {
            return;
        }

        const action = button.dataset.action;

        if (action === 'play') {
            const index = Number(button.dataset.index);
            // Playing a row routes the player bar to this playlist.
            this.playingController = this.active;
            if (this.playback.playTrackAt(index)) {
                this.render();
                this.syncPlayerToCurrent(true);
                this.isPlaying = true;
            }
        } else if (action === 'play-next') {
            const index = Number(button.dataset.index);
            const song = this.active.playlist[index];
            if (!song) {
                return;
            }

            // "Reproducir a continuación": insert after current, do NOT play.
            const uniqueSong: Song = { ...song, id: this.uniqueId(song.id) };
            this.active.insertNext(uniqueSong);
            this.catalog.push(uniqueSong);
            this.render();
            this.setStatus('Canción programada para reproducirse a continuación');
            this.showToast(`A continuación: ${uniqueSong.title}`);
        } else if (action === 'move-up') {
            const index = Number(button.dataset.index);
            if (this.active.moveUp(index)) {
                this.render();
                this.setStatus('Canción movida hacia arriba');
            }
        } else if (action === 'move-down') {
            const index = Number(button.dataset.index);
            if (this.active.moveDown(index)) {
                this.render();
                this.setStatus('Canción movida hacia abajo');
            }
        } else if (action === 'delete') {
            const id = button.dataset.id;
            const wasPlayingActive = this.playback === this.active;
            if (id && this.active.removeTrackById(id)) {
                if (wasPlayingActive && this.active.length === 0) {
                    // The playing queue is now empty: stop audio and reset the bar.
                    this.stopPlayback();
                }

                this.render();

                if (wasPlayingActive && this.active.length > 0) {
                    this.syncPlayerToCurrent(this.isPlaying);
                }
            }
        }
    }

    /**
     * Shows a placeholder when a cover image fails, retrying once with the
     * lower-resolution YouTube thumbnail before giving up. Only the failed
     * image is replaced, so no extra request is made for healthy rows.
     */
    private handleCoverError(event: Event): void {
        const target = event.target;
        if (!(target instanceof HTMLImageElement) || !target.classList.contains('song-thumb__img')) {
            return;
        }

        const videoId = target.dataset.videoId ?? '';
        const alreadyTried = target.dataset.fallbackTried === 'true';

        if (!alreadyTried && videoId) {
            target.dataset.fallbackTried = 'true';
            target.src = coverFallbackUrl(videoId);
            return;
        }

        if (videoId) {
            this.failedCovers.add(videoId);
        }

        target.hidden = true;
        const placeholder = target.parentElement?.querySelector<HTMLElement>(
            '.song-thumb__placeholder'
        );
        if (placeholder) {
            placeholder.hidden = false;
        }
    }

    /* --------------------------- Drag and drop reorder ---------------------- */

    /** Marks the picked row as the drag source. */
    private handleDragStart(event: DragEvent): void {
        const row = this.rowFromEvent(event);
        if (!row) {
            return;
        }

        this.draggedIndex = Number(row.dataset.index);
        row.classList.add('is-dragging');
        row.setAttribute('aria-grabbed', 'true');

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // Some browsers require payload data for the drop to fire.
            event.dataTransfer.setData('text/plain', row.dataset.index ?? '');
        }

        this.setStatus('Arrastrando canción... Suelta para reordenar');
    }

    /** Tracks the row under the pointer and paints the drop indicator. */
    private handleDragOver(event: DragEvent): void {
        const row = this.rowFromEvent(event);
        if (!row || this.draggedIndex === null) {
            return;
        }

        // Required so the browser allows the drop.
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        this.clearDropIndicators();
        row.classList.add(this.isAfterMidpoint(event, row) ? 'drop-below' : 'drop-above');
    }

    /** Clears indicators once the pointer leaves the table body entirely. */
    private handleDragLeave(event: DragEvent): void {
        const related = event.relatedTarget;
        if (related instanceof Node && this.playlistBody.contains(related)) {
            return;
        }
        this.clearDropIndicators();
    }

    /** Commits the reorder through the controller. */
    private handleDrop(event: DragEvent): void {
        event.preventDefault();

        const row = this.rowFromEvent(event);
        const fromIndex = this.draggedIndex;
        if (!row || fromIndex === null) {
            this.resetDragState();
            return;
        }

        const overIndex = Number(row.dataset.index);
        const dropAfter = this.isAfterMidpoint(event, row);

        // Insertion slot in the ORIGINAL list (0..length), then translate it to
        // the moved track's final index.
        let toIndex = dropAfter ? overIndex + 1 : overIndex;
        if (fromIndex < toIndex) {
            toIndex--;
        }

        this.resetDragState();

        if (toIndex === fromIndex || !this.active.moveTrack(fromIndex, toIndex)) {
            this.setStatus('Listo para reproducir');
            return;
        }

        // The cursor node is preserved by the list, so playback is not restarted.
        this.render();
        this.setStatus('Lista reordenada');
        this.showToast('Canción reordenada en la lista');
    }

    /** Finds the draggable row that owns the event target. */
    private rowFromEvent(event: DragEvent): HTMLTableRowElement | null {
        const target = event.target as HTMLElement | null;
        return (target?.closest('tr[data-index]') as HTMLTableRowElement | null) ?? null;
    }

    /** True when the pointer sits past the vertical midpoint of the row. */
    private isAfterMidpoint(event: DragEvent, row: HTMLTableRowElement): boolean {
        const rect = row.getBoundingClientRect();
        return event.clientY - rect.top > rect.height / 2;
    }

    private clearDropIndicators(): void {
        this.playlistBody
            .querySelectorAll('tr.drop-above, tr.drop-below')
            .forEach((row) => row.classList.remove('drop-above', 'drop-below'));
    }

    private resetDragState(): void {
        this.clearDropIndicators();
        this.playlistBody
            .querySelectorAll('tr.is-dragging')
            .forEach((row) => row.classList.remove('is-dragging'));
        this.playlistBody
            .querySelectorAll('tr[aria-grabbed="true"]')
            .forEach((row) => row.setAttribute('aria-grabbed', 'false'));
        this.draggedIndex = null;
    }

    /* -------------------------------- Rendering ----------------------------- */

    private render(): void {
        this.renderNowPlaying();
        this.renderControls();
        this.renderPlaylist();
        this.renderPlaylistTree();
        this.renderView();
        this.renderEqualizer();
        this.renderVolume();
    }

    /**
     * Reflects the playing track in both the bottom player bar and the hero
     * "Reproduciendo Ahora" card. Reads from the playback controller so the
     * track persists while browsing other playlists.
     */
    private renderNowPlaying(): void {
        const song = this.playback.currentSong;
        const index = this.playback.currentIndex;
        const positionLabel = `Canción ${index >= 0 ? index + 1 : 0} de ${this.playback.length}`;
        const tagsHtml = (song?.moodTags ?? [])
            .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join('');

        if (!song) {
            this.nowTitle.textContent = 'Sin canción';
            this.nowArtist.textContent = '—';
            this.nowCover.src = PLACEHOLDER_COVER;
            this.nowTags.innerHTML = '';
            this.nowPosition.textContent = 'Canción 0 de 0';

            this.heroTitle.textContent = 'Sin canción';
            this.heroArtist.textContent = '—';
            this.heroCover.src = PLACEHOLDER_COVER;
            this.heroTags.innerHTML = '';
            this.heroPosition.textContent = 'Canción 0 de 0';
            return;
        }

        this.nowTitle.textContent = song.title;
        this.nowArtist.textContent = song.artist;
        this.nowCover.src = song.albumCover || PLACEHOLDER_COVER;
        this.nowCover.alt = `Portada de ${song.title}`;
        this.nowTags.innerHTML = tagsHtml;
        this.nowPosition.textContent = positionLabel;

        this.heroTitle.textContent = song.title;
        this.heroArtist.textContent = song.artist;
        this.heroCover.src = song.albumCover || PLACEHOLDER_COVER;
        this.heroCover.alt = `Portada de ${song.title}`;
        this.heroTags.innerHTML = tagsHtml;
        this.heroPosition.textContent = positionLabel;
    }

    private renderControls(): void {
        this.btnPrevious.disabled = !this.playback.hasPrevious;
        this.btnNext.disabled = !this.playback.hasNext;
        this.btnPlay.disabled = this.playback.currentSong === null;

        // Icon-only transport controls: the Spanish text lives in the
        // accessible label and the tooltip.
        this.btnPrevious.setAttribute('aria-label', MESSAGES.player.previous);
        this.btnPrevious.title = MESSAGES.player.previous;
        this.btnNext.setAttribute('aria-label', MESSAGES.player.next);
        this.btnNext.title = MESSAGES.player.next;

        const playing = this.isPlaying;
        this.playIcon.innerHTML = icon(playing ? 'pause' : 'play');
        const playLabel = playing ? MESSAGES.player.pause : MESSAGES.player.play;
        this.btnPlay.setAttribute('aria-label', playLabel);
        this.btnPlay.title = playLabel;

        this.renderLoopButton(this.playback.loopMode);
    }

    /** Reflects the active repeat strategy on the icon-only "Repetir" button. */
    private renderLoopButton(mode: LoopMode): void {
        const isActive = mode !== 'off';

        this.btnLoop.classList.toggle('is-active', isActive);
        this.btnLoop.setAttribute('aria-pressed', String(isActive));

        if (mode === 'track') {
            this.loopIcon.innerHTML = icon('repeatOne');
            this.setLoopLabel(MESSAGES.player.repeatOne);
        } else if (mode === 'playlist') {
            this.loopIcon.innerHTML = icon('repeat');
            this.setLoopLabel(MESSAGES.player.repeatAll);
        } else {
            this.loopIcon.innerHTML = icon('repeat');
            this.setLoopLabel(MESSAGES.player.repeatOff);
        }
    }

    /** Updates the repeat button's accessible label and tooltip. */
    private setLoopLabel(label: string): void {
        this.btnLoop.setAttribute('aria-label', label);
        this.btnLoop.title = label;
    }

    private renderEqualizer(): void {
        this.equalizer.classList.toggle('is-active', this.isPlaying);
        this.heroEqualizer.classList.toggle('is-active', this.isPlaying);
    }

    private renderPlaylist(): void {
        const songs = this.active.playlist;
        const currentIndex = this.active.currentIndex;
        const showsPlayback = this.playback === this.active;
        const matches: Set<number> | null = this.playlistSearchQuery
            ? new Set(this.active.searchByText(this.playlistSearchQuery))
            : null;

        this.playlistBody.innerHTML = songs
            .map((song, index) => {
                const isActive = showsPlayback && index === currentIndex;
                const isPlayingRow = isActive && this.isPlaying;
                const searchClass = matches
                    ? matches.has(index)
                        ? ' is-match'
                        : ' is-filtered'
                    : '';

                // Icon-only actions: the Spanish text lives in aria-label/title.
                const playLabel = escapeHtml(MESSAGES.row.play(song.title, song.artist));
                const playNextLabel = escapeHtml(MESSAGES.row.playNext(song.title, song.artist));
                const moveUpLabel = escapeHtml(MESSAGES.row.moveUp(song.title, song.artist));
                const moveDownLabel = escapeHtml(MESSAGES.row.moveDown(song.title, song.artist));
                const removeLabel = escapeHtml(MESSAGES.row.remove(song.title, song.artist));

                // Cover thumbnail: the image is not draggable on its own so the
                // row's HTML5 drag-and-drop keeps working.
                const coverAlt = escapeHtml(MESSAGES.row.coverAlt(song.title));
                const coverFailed = this.failedCovers.has(song.videoId);
                const cover = song.albumCover && !coverFailed ? escapeHtml(song.albumCover) : '';
                const coverImg = cover
                    ? `<img class="song-thumb__img" src="${cover}" alt="${coverAlt}"
                            width="48" height="48" loading="lazy" decoding="async"
                            draggable="false" data-video-id="${escapeHtml(song.videoId)}"
                            data-fallback-tried="false" />`
                    : '';

                return `
                    <tr class="${isActive ? 'is-active' : ''}${isPlayingRow ? ' is-playing' : ''}${searchClass}"
                        data-index="${index}" draggable="true" aria-grabbed="false">
                        <td class="col-index">
                            <span class="drag-handle" aria-hidden="true"
                                title="${escapeHtml(MESSAGES.row.dragHandle)}">⠿</span>${index + 1}
                        </td>
                        <td class="col-title">
                            <div class="song-cell">
                                <button class="song-thumb" type="button" data-action="play"
                                    data-index="${index}" title="${playLabel}" aria-label="${playLabel}">
                                    ${coverImg}
                                    <span class="song-thumb__placeholder" aria-hidden="true"${
                                        cover ? ' hidden' : ''
                                    }>${icon('music')}</span>
                                    <span class="song-thumb__overlay" aria-hidden="true">${icon('play')}</span>
                                    <span class="song-thumb__equalizer" aria-hidden="true">
                                        <span></span><span></span><span></span>
                                    </span>
                                </button>
                                <div class="song-cell__meta">
                                    <span class="song-title">${escapeHtml(song.title)}</span>
                                    <span class="song-artist song-artist--inline">${escapeHtml(song.artist)}</span>
                                </div>
                            </div>
                        </td>
                        <td class="song-artist col-artist">${escapeHtml(song.artist)}</td>
                        <td>${formatDuration(song.duration)}</td>
                        <td>
                            <div class="row-actions">
                                <button class="btn-icon" type="button" data-action="play" data-index="${index}"
                                    title="${playLabel}" aria-label="${playLabel}">${icon('play')}</button>
                                <button class="btn-icon" type="button" data-action="play-next" data-index="${index}"
                                    title="${playNextLabel}" aria-label="${playNextLabel}">${icon('playNext')}</button>
                                <button class="btn-icon" type="button" data-action="move-up" data-index="${index}"
                                    title="${moveUpLabel}" aria-label="${moveUpLabel}"
                                    ${index === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
                                <button class="btn-icon" type="button" data-action="move-down" data-index="${index}"
                                    title="${moveDownLabel}" aria-label="${moveDownLabel}"
                                    ${index === songs.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
                                <button class="btn-icon btn-delete" type="button" data-action="delete"
                                    data-id="${escapeHtml(song.id)}" title="${removeLabel}"
                                    aria-label="${removeLabel}">${icon('trash')}</button>
                            </div>
                        </td>
                    </tr>`;
            })
            .join('');

        this.playlistCount.textContent = `${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'}`;
        this.playlistEmpty.hidden = songs.length > 0;
        this.playlistActiveName.textContent = this.manager.activeName || 'Lista de Reproducción';

        const total = this.active.totalDuration();
        this.playlistDuration.innerHTML =
            `${icon('clock')} ${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'} · ` +
            `duración total ${formatTime(total)}`;
        this.playlistSearchCount.textContent = matches
            ? `${matches.size} ${matches.size === 1 ? 'coincidencia' : 'coincidencias'}`
            : '';
    }

    /** Renders the collapsible "Mis Playlists" tree in the sidebar. */
    private renderPlaylistTree(): void {
        const playlists = this.manager.getPlaylists();
        const activeId = this.manager.activeId;

        this.playlistTree.innerHTML = playlists
            .map((playlist) => {
                const isActive = playlist.id === activeId;
                const deleteButton = this.manager.isDefault(playlist.id)
                    ? ''
                    : `<button class="playlist-item__delete" type="button" data-action="delete"
                            data-id="${escapeHtml(playlist.id)}"
                            title="Eliminar la lista ${escapeHtml(playlist.name)}"
                            aria-label="Eliminar la lista ${escapeHtml(playlist.name)}">${icon('trash')}</button>`;

                return `
                    <li class="playlist-item ${isActive ? 'is-active' : ''}">
                        <button class="playlist-item__main" type="button" data-action="select"
                            data-id="${escapeHtml(playlist.id)}"
                            title="Abrir la lista ${escapeHtml(playlist.name)}">
                            <span class="playlist-item__icon" aria-hidden="true">${icon('music')}</span>
                            <span class="playlist-item__name">${escapeHtml(playlist.name)}</span>
                            <span class="playlist-item__count">${playlist.length}</span>
                        </button>
                        ${deleteButton}
                    </li>`;
            })
            .join('');
    }

    /** Toggles between the Home view and the active-playlist table view. */
    private renderView(): void {
        const isHome = this.currentView === 'home';

        this.homeSections.hidden = !isHome;
        this.playlistPanel.hidden = isHome;
        this.navHome.classList.toggle('is-active', isHome);
    }

    /* --------------------------------- Status ------------------------------- */

    private setStatus(message: string): void {
        this.playerStatus.textContent = message;
    }

    private setSearchStatus(message: string, kind: 'success' | 'error' | 'info'): void {
        this.searchStatus.textContent = message;
        this.searchStatus.className = `form-status is-${kind}`;

        if (message) {
            this.openSearchDropdown();
        }
    }

    private setMoodStatus(message: string, kind: 'success' | 'error' | 'info'): void {
        this.moodStatus.textContent = message;
        this.moodStatus.className = `form-status is-${kind}`;
    }
}
