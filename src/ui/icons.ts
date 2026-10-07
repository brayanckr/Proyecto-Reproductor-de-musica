/**
 * Lightweight inline SVG icon set for UCCplay.
 *
 * All icons share a 24x24 viewBox and use `currentColor`, so they inherit the
 * text color and can be tinted through the existing CSS variables. No external
 * icon library is loaded.
 */

export type IconName =
    | 'search'
    | 'menu'
    | 'home'
    | 'plus'
    | 'chevronDown'
    | 'swap'
    | 'trash'
    | 'clock'
    | 'shuffle'
    | 'layers'
    | 'arrowUp'
    | 'arrowDown'
    | 'play'
    | 'pause'
    | 'playNext'
    | 'next'
    | 'prev'
    | 'repeat'
    | 'repeatOne'
    | 'volumeHigh'
    | 'volumeLow'
    | 'volumeMute'
    | 'mic'
    | 'close'
    | 'music'
    | 'sparkle'
    | 'listPlus'
    | 'refresh'
    | 'sun'
    | 'moon'
    | 'keyboard'
    | 'check';

/**
 * Inner SVG markup per icon. Stroked icons use the shared `<svg>` attributes;
 * fill-based icons (play/pause/next/prev/volume) opt in with `fill="currentColor"`
 * and `stroke="none"`.
 */
const PATHS: Record<IconName, string> = {
    search:
        '<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />',
    menu: '<line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />',
    home: '<path d="M3 10.2 12 3l9 7.2V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />',
    plus: '<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />',
    chevronDown: '<polyline points="6 9 12 15 18 9" />',
    swap: '<polyline points="7 3 3 7 7 11" /><line x1="3" y1="7" x2="21" y2="7" /><polyline points="17 21 21 17 17 13" /><line x1="21" y1="17" x2="3" y2="17" />',
    trash:
        '<polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />',
    clock: '<circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />',
    shuffle:
        '<polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />',
    layers:
        '<polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 12 12 17 22 12" /><polyline points="2 17 12 22 22 17" />',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />',
    arrowDown: '<line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />',
    play: '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />',
    pause:
        '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />',
    playNext:
        '<polygon points="4 5 14 12 4 19 4 5" fill="currentColor" stroke="none" /><line x1="18" y1="7" x2="18" y2="17" /><line x1="14" y1="12" x2="22" y2="12" />',
    next: '<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" /><rect x="17" y="4" width="2.5" height="16" rx="1" fill="currentColor" stroke="none" />',
    prev: '<polygon points="19 4 9 12 19 20 19 4" fill="currentColor" stroke="none" /><rect x="4.5" y="4" width="2.5" height="16" rx="1" fill="currentColor" stroke="none" />',
    repeat:
        '<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />',
    repeatOne:
        '<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /><polyline points="11.5 10 13 9 13 15" />',
    volumeHigh:
        '<polygon points="3 9 7 9 12 5 12 19 7 15 3 15 3 9" fill="currentColor" stroke="none" /><path d="M16 8.5a4 4 0 0 1 0 7" /><path d="M18.5 6a8 8 0 0 1 0 12" />',
    volumeLow:
        '<polygon points="3 9 7 9 12 5 12 19 7 15 3 15 3 9" fill="currentColor" stroke="none" /><path d="M16 8.5a4 4 0 0 1 0 7" />',
    volumeMute:
        '<polygon points="3 9 7 9 12 5 12 19 7 15 3 15 3 9" fill="currentColor" stroke="none" /><line x1="16" y1="9" x2="21" y2="14" /><line x1="21" y1="9" x2="16" y2="14" />',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />',
    close: '<line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />',
    music:
        '<path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" />',
    sparkle:
        '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />',
    listPlus:
        '<line x1="3" y1="6" x2="14" y2="6" /><line x1="3" y1="12" x2="10" y2="12" /><line x1="3" y1="18" x2="10" y2="18" /><line x1="18" y1="9" x2="18" y2="21" /><line x1="15" y1="15" x2="21" y2="15" />',
    refresh:
        '<polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />',
    sun: '<circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />',
    keyboard:
        '<rect x="2" y="6" width="20" height="12" rx="2" /><line x1="6" y1="10" x2="6" y2="10" /><line x1="10" y1="10" x2="10" y2="10" /><line x1="14" y1="10" x2="14" y2="10" /><line x1="18" y1="10" x2="18" y2="10" /><line x1="7" y1="14" x2="17" y2="14" />',
    check: '<polyline points="20 6 9 17 4 12" />'
};

/** Builds the inline SVG markup for an icon, sized relative to the font. */
export function icon(name: IconName, className = 'icon'): string {
    return (
        `<svg class="${className}" viewBox="0 0 24 24" width="1em" height="1em" ` +
        `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
    );
}
