/**
 * Public entry point for the music player core.
 * Consumers (UI layer, external APIs, AI mood module) import from here.
 */
export type { Song } from './models/Song';
export { SongNode } from './structures/SongNode';
export { DoublyLinkedList } from './structures/DoublyLinkedList';
export { YouTubeMusicService } from './services/YouTubeMusicService';
export { MoodRecommendationService } from './services/MoodRecommendationService';
export type { MoodRecommendationConfig, AIRecommendation } from './services/MoodRecommendationService';
export { LyricsService } from './services/LyricsService';
export type { LyricLine } from './services/LyricsService';
export { PlayerController } from './controllers/PlayerController';
export type { LoopMode } from './controllers/PlayerController';
export { PlaylistManager } from './controllers/PlaylistManager';
export type { PlaylistSummary } from './controllers/PlaylistManager';
