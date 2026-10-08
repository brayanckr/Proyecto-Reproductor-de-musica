/**
 * Minimal typings and a small wrapper around the subset of the
 * YouTube IFrame Player API used by UCCplay.
 *
 * The wrapper hides the global `YT` namespace and exposes promise-free
 * load/play/pause/seek helpers plus a polling progress callback.
 *
 * Playback can only start once the underlying player is ready, so load/play
 * requests received before that point are queued and flushed on `onReady`
 * (instead of being silently dropped). If the API script is blocked or the
 * player never becomes ready, `onUnavailable` is reported after a timeout.
 */

/** Player state constants (mirrors `YT.PlayerState`). */
export const YouTubePlayerState = {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
} as const;

/**
 * Minimum visible size (px) demanded by the YouTube IFrame API. Smaller or
 * hidden players are refused (typically with error 153) or stay silent.
 */
export const PLAYER_WIDTH = 200;
export const PLAYER_HEIGHT = 200;

interface YouTubePlayerInstance {
    loadVideoById(videoId: string): void;
    cueVideoById(videoId: string): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    setVolume(volume: number): void;
    getVolume(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getIframe?(): HTMLIFrameElement;
    destroy(): void;
}

interface YouTubePlayerOptions {
    videoId?: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, string | number>;
    events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
    };
}

interface YouTubeNamespace {
    Player: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayerInstance;
    PlayerState: typeof YouTubePlayerState;
}

declare global {
    interface Window {
        YT?: YouTubeNamespace;
        onYouTubeIframeAPIReady?: () => void;
    }
}

/** Callbacks the UI layer subscribes to. */
export interface YouTubePlayerCallbacks {
    /** Fired once the underlying player is ready to receive commands. */
    onReady?: () => void;
    /** Fired on every player state change (use `YouTubePlayerState` to compare). */
    onStateChange?: (state: number) => void;
    /** Fired when the player cannot play the video (see YouTube error codes). */
    onError?: (code: number) => void;
    /** Fired every poll tick with the current time and total duration (seconds). */
    onProgress?: (currentTime: number, duration: number) => void;
    /**
     * Fired when the IFrame API script is blocked or the player never becomes
     * ready in time, so the UI can warn instead of failing silently.
     */
    onUnavailable?: (reason: string) => void;
}

/** How often (ms) the progress callback polls the player. */
const PROGRESS_POLL_INTERVAL = 500;

/** How long (ms) to wait for `onReady` before declaring the player unavailable. */
const READY_TIMEOUT = 10000;

export class YouTubePlayer {
    private instance: YouTubePlayerInstance | null = null;
    private pollId: number | null = null;
    private readyTimer: number | null = null;
    private ready = false;

    /** Requested load/play kept until the player reports ready. */
    private pendingVideoId: string | null = null;
    private pendingAutoplay = false;
    private pendingPlay = false;

    /**
     * @param elementId DOM id of the container the iframe replaces.
     * @param callbacks UI callbacks for readiness, state and progress.
     */
    constructor(
        private readonly elementId: string,
        private readonly callbacks: YouTubePlayerCallbacks
    ) {}

    /** Boots the player, waiting for the IFrame API when necessary. */
    public initialize(): void {
        this.startReadyTimer();

        if (window.YT?.Player) {
            this.createPlayer();
            return;
        }

        // Chain onto any existing ready handler so nothing is overwritten.
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            previous?.();
            this.createPlayer();
        };
    }

    private createPlayer(): void {
        if (!window.YT?.Player || this.instance) {
            return;
        }

        // `origin` is required by the embed policy; omitted for opaque origins
        // (e.g. `file://`) where it would be the literal string "null".
        const origin =
            window.location.origin && window.location.origin !== 'null'
                ? window.location.origin
                : undefined;

        this.instance = new window.YT.Player(this.elementId, {
            videoId: '',
            width: PLAYER_WIDTH,
            height: PLAYER_HEIGHT,
            playerVars: {
                autoplay: 0,
                controls: 0,
                disablekb: 1,
                playsinline: 1,
                rel: 0,
                modestbranding: 1,
                enablejsapi: 1,
                ...(origin ? { origin } : {})
            },
            events: {
                onReady: () => {
                    this.ready = true;
                    this.clearReadyTimer();
                    this.ensureIframePermissions();
                    console.warn('[YouTubePlayer] onReady');
                    this.callbacks.onReady?.();
                    this.startPolling();
                    this.flushPendingRequests();
                },
                onStateChange: (event) => {
                    console.warn('[YouTubePlayer] onStateChange:', event.data);
                    this.callbacks.onStateChange?.(event.data);
                },
                onError: (event) => {
                    console.warn('[YouTubePlayer] onError:', event.data);
                    this.callbacks.onError?.(event.data);
                }
            }
        });

        // The iframe may be created after the constructor returns.
        this.ensureIframePermissions();
    }

    /**
     * Grants the generated iframe the permissions it needs. Without
     * `allow="autoplay"` the browser refuses programmatic playback.
     */
    private ensureIframePermissions(): void {
        let iframe: HTMLIFrameElement | null = null;

        try {
            iframe = this.instance?.getIframe?.() ?? null;
        } catch {
            // `getIframe()` throws until the player finishes initializing.
            iframe = null;
        }

        iframe ??= document.querySelector<HTMLIFrameElement>(`#${this.elementId} iframe`);

        if (!iframe) {
            return;
        }

        iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
        iframe.setAttribute('allowfullscreen', 'true');
        console.warn(
            '[YouTubePlayer] iframe ready. allow="' +
                iframe.getAttribute('allow') +
                '" src="' +
                iframe.getAttribute('src') +
                '"'
        );
    }

    private startReadyTimer(): void {
        if (this.readyTimer !== null || this.ready) {
            return;
        }

        this.readyTimer = window.setTimeout(() => {
            this.readyTimer = null;
            if (this.ready) {
                return;
            }
            console.warn(
                `[YouTubePlayer] the player did not become ready within ${READY_TIMEOUT}ms ` +
                    '(blocked iframe_api script, network or embed policy?).'
            );
            this.callbacks.onUnavailable?.('ready-timeout');
        }, READY_TIMEOUT);
    }

    private clearReadyTimer(): void {
        if (this.readyTimer !== null) {
            window.clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
    }

    /** Applies any load/play request received before the player was ready. */
    private flushPendingRequests(): void {
        if (this.pendingVideoId) {
            const videoId = this.pendingVideoId;
            const autoplay = this.pendingAutoplay;
            this.pendingVideoId = null;
            this.pendingAutoplay = false;
            this.applyLoad(videoId, autoplay);
        }

        if (this.pendingPlay) {
            this.pendingPlay = false;
            this.instance?.playVideo();
        }
    }

    /** Loads a video, either queueing it (cue) or playing it immediately. */
    public load(videoId: string, autoplay: boolean): void {
        if (!videoId) {
            return;
        }

        if (!this.instance || !this.ready) {
            console.warn(`[YouTubePlayer] load("${videoId}") queued until the player is ready.`);
            this.pendingVideoId = videoId;
            this.pendingAutoplay = autoplay;
            this.pendingPlay = this.pendingPlay || autoplay;
            return;
        }

        this.applyLoad(videoId, autoplay);
    }

    private applyLoad(videoId: string, autoplay: boolean): void {
        if (!this.instance) {
            return;
        }

        if (autoplay) {
            this.instance.loadVideoById(videoId);
        } else {
            this.instance.cueVideoById(videoId);
        }
    }

    public play(): void {
        if (!this.instance || !this.ready) {
            console.warn('[YouTubePlayer] play() queued until the player is ready.');
            this.pendingPlay = true;
            return;
        }

        this.instance.playVideo();
    }

    public pause(): void {
        this.pendingPlay = false;
        this.pendingAutoplay = false;

        if (this.instance && this.ready) {
            this.instance.pauseVideo();
        }
    }

    public seekTo(seconds: number): void {
        if (this.instance && this.ready) {
            this.instance.seekTo(seconds, true);
        }
    }

    /** Current playback position in seconds (0 when not ready). */
    public getCurrentTime(): number {
        if (!this.instance || !this.ready) {
            return 0;
        }

        try {
            return this.instance.getCurrentTime();
        } catch {
            // The player occasionally throws while switching videos.
            return 0;
        }
    }

    /** Current playback volume (0-100) or 0 when not ready. */
    public getVolume(): number {
        if (!this.instance || !this.ready) {
            return 0;
        }

        try {
            return this.instance.getVolume();
        } catch {
            return 0;
        }
    }

    /** True when the underlying player is muted. */
    public isMuted(): boolean {
        if (!this.instance || !this.ready) {
            return false;
        }

        try {
            return this.instance.isMuted();
        } catch {
            return false;
        }
    }

    /** Sets playback volume on a 0-100 scale, clamping out-of-range values. */
    public setVolume(volume: number): void {
        if (this.instance && this.ready) {
            const clamped = Math.min(100, Math.max(0, volume));
            this.instance.setVolume(clamped);
        }
    }

    public mute(): void {
        if (this.instance && this.ready) {
            this.instance.mute();
        }
    }

    public unMute(): void {
        if (this.instance && this.ready) {
            this.instance.unMute();
        }
    }

    public isReady(): boolean {
        return this.ready;
    }

    private startPolling(): void {
        if (this.pollId !== null) {
            return;
        }

        this.pollId = window.setInterval(() => {
            if (!this.instance || !this.ready) {
                return;
            }

            try {
                this.callbacks.onProgress?.(
                    this.instance.getCurrentTime(),
                    this.instance.getDuration()
                );
            } catch {
                // The player occasionally throws while switching videos.
            }
        }, PROGRESS_POLL_INTERVAL);
    }
}
