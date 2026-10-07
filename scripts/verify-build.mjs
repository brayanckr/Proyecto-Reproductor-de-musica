import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Post-build verification for the UCCplay SPA.
 *
 * Ensures the Vite output directory contains the files required to host the
 * application on a static provider: an HTML entry point, at least one hashed
 * JavaScript bundle and one hashed CSS bundle, plus the YouTube IFrame API
 * script that drives playback.
 *
 * Exits with code 1 (failing CI/deployment) when anything is missing.
 */

const outputDir = process.env.BUILD_DIR ?? 'dist-web';
const indexPath = join(outputDir, 'index.html');
const assetsDir = join(outputDir, 'assets');

const failures = [];

function fail(message) {
    failures.push(message);
}

if (!existsSync(outputDir)) {
    fail(`Build output directory "${outputDir}" does not exist. Run "npm run build" first.`);
} else {
    if (!existsSync(indexPath)) {
        fail('Missing index.html in the build output.');
    } else {
        const html = readFileSync(indexPath, 'utf8');
        if (!/assets\/.+\.js/.test(html)) {
            fail('index.html does not reference a bundled JavaScript asset.');
        }
        if (!/assets\/.+\.css/.test(html)) {
            fail('index.html does not reference a bundled CSS asset.');
        }
        if (!html.includes('youtube.com/iframe_api')) {
            fail('index.html is missing the YouTube IFrame Player API script.');
        }
    }

    if (!existsSync(assetsDir)) {
        fail('Missing "assets" directory in the build output.');
    } else {
        const files = readdirSync(assetsDir);
        if (!files.some((file) => file.endsWith('.js'))) {
            fail('No JavaScript bundle found in assets/.');
        }
        if (!files.some((file) => file.endsWith('.css'))) {
            fail('No CSS bundle found in assets/.');
        }
    }
}

if (failures.length > 0) {
    console.error('Build verification FAILED:');
    for (const message of failures) {
        console.error(`  - ${message}`);
    }
    process.exit(1);
}

console.log(`Build verification passed: "${outputDir}" is ready for static hosting.`);
