/**
 * Minimal typings and a small wrapper around the subset of the
 * YouTube IFrame Player API used by UCCplay.
 *
 * The wrapper hides the global `YT` namespace and exposes promise-free
 * load/play/pause/seek helpers plus a polling progress callback.
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
}

/** How often (ms) the progress callback polls the player. */
const PROGRESS_POLL_INTERVAL = 500;

export class YouTubePlayer {
    private instance: YouTubePlayerInstance | null = null;
    private pollId: number | null = null;
    private ready = false;

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

        this.instance = new window.YT.Player(this.elementId, {
            videoId: '',
            width: 1,
            height: 1,
            playerVars: {
                controls: 0,
                disablekb: 1,
                playsinline: 1,
                rel: 0
            },
            events: {
                onReady: () => {
                    this.ready = true;
                    this.callbacks.onReady?.();
                    this.startPolling();
                },
                onStateChange: (event) => this.callbacks.onStateChange?.(event.data),
                onError: (event) => this.callbacks.onError?.(event.data)
            }
        });
    }

    /** Loads a video, either queueing it (cue) or playing it immediately. */
    public load(videoId: string, autoplay: boolean): void {
        if (!this.instance || !this.ready || !videoId) {
            return;
        }

        if (autoplay) {
            this.instance.loadVideoById(videoId);
        } else {
            this.instance.cueVideoById(videoId);
        }
    }

    public play(): void {
        if (this.instance && this.ready) {
            this.instance.playVideo();
        }
    }

    public pause(): void {
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
