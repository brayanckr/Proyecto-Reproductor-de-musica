import { MoodRecommendationService, PlayerController, YouTubeMusicService } from './index';

/**
 * Runnable demo for the music player core.
 *
 * It builds a queue from the music service, traverses it with the linked-list
 * pointers, and then asks the Groq-backed `MoodRecommendationService` for a real
 * track, resolving its live metadata through `YouTubeMusicService`.
 *
 * Run with: npm run demo
 * Optional: set YT_API_KEY / AI_API_KEY to exercise the network paths.
 */

async function main(): Promise<void> {
    const musicService = new YouTubeMusicService();
    const moodService = new MoodRecommendationService({ apiKey: process.env.AI_API_KEY });
    const controller = new PlayerController();

    // An empty query returns the full offline catalog (or an API result set).
    const catalog = await musicService.searchMusic('', process.env.YT_API_KEY);
    console.log(`candidate catalog: ${catalog.length} track(s)`);

    // Seed the queue so we can see the linked-list traversal.
    if (catalog.length >= 2) {
        controller.addTrack(catalog[0], 'end');
        controller.addTrack(catalog[1], 'end');
    }
    console.log(`queue: ${controller.playlist.map((s) => s.title).join(' -> ')}`);

    console.log('\n--- next() forward traversal ---');
    while (controller.hasNext) {
        console.log(`now playing: ${controller.next()?.title ?? 'nothing'}`);
    }
    console.log(`hasNext=${controller.hasNext}`);

    console.log('\n--- previous() backward traversal ---');
    while (controller.hasPrevious) {
        console.log(`now playing: ${controller.previous()?.title ?? 'nothing'}`);
    }
    console.log(`hasPrevious=${controller.hasPrevious}`);

    const mood = 'Quiero reggaeton en español para la fiesta';
    console.log(`\n--- fetchAIRecommendations("${mood}") via Groq ---`);
    const suggestions = await moodService.fetchAIRecommendations(mood, process.env.AI_API_KEY);
    if (suggestions.length === 0) {
        console.log('No AI key provided (or the request failed): Groq is required.');
        return;
    }

    const suggestion = suggestions[0];
    console.log(`AI suggestion: ${suggestion.title} - ${suggestion.artist}`);
    console.log(`reason: ${suggestion.reason}`);

    const matches = await musicService.searchMusic(
        `${suggestion.title} ${suggestion.artist}`,
        process.env.YT_API_KEY
    );
    console.log(`YouTube match: ${matches[0]?.title ?? 'not found'}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
