# UCCplay — Doubly Linked List Music Player

> Institutional music player for **Universidad Cooperativa de Colombia (UCC)**,
> built on a hand-written **Doubly Linked List** in TypeScript, with a YouTube
> Music service and an AI mood-recommendation engine.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Structure Overview](#data-structure-overview)
- [YouTube Music Service](#youtube-music-service)
- [AI Mood Recommendation](#ai-mood-recommendation)
- [UI & Branding](#ui--branding)
- [Local Setup & Commands](#local-setup--commands)
- [Deployment Instructions](#deployment-instructions)
- [Instrucciones de uso (Español)](#instrucciones-de-uso-español)
- [License](#license)

---

## Overview

UCCplay is a single-page application (SPA) that behaves like a real music
player: it searches tracks, builds a queue, plays audio through the YouTube
IFrame Player API, and asks the Groq-backed AI for a real track matching a
natural-language mood description. Every piece of playlist state lives in a
custom doubly linked list — no arrays are used for the queue itself, so
navigation between tracks is pure pointer traversal.

The project is split into a framework-free **core library** (data structures,
services, controllers) and a **web client** (Spanish UI). The core can be used
from Node.js or the browser and is completely decoupled from the DOM.

---

## Tech Stack

| Layer         | Technology                                        |
| ------------- | ------------------------------------------------- |
| Language      | TypeScript (strict mode)                          |
| Core build    | `tsc` → CommonJS in `dist/`                       |
| Web build     | Vite → `dist-web/`                                |
| UI            | Vanilla HTML + CSS (no framework), `src/ui/App.ts` |
| Playback      | YouTube IFrame Player API                         |
| Music data    | YouTube Data API v3 (optional) + offline catalog  |
| AI ranking    | Groq / OpenAI-compatible chat API (Llama-3, gpt-oss) |

---

## Project Structure

```
.
├── index.html                     # Spanish UI markup (Vite entry page)
├── vite.config.ts                 # Vite config (outputs to dist-web/)
├── tsconfig.json                  # Base config (ESNext, for Vite + typecheck)
├── tsconfig.core.json             # Core library build (CommonJS → dist/)
├── vercel.json                    # Vercel SPA configuration
├── netlify.toml                   # Netlify SPA configuration
├── scripts/
│   └── verify-build.mjs           # Post-build asset verification
└── src/
    ├── main.ts                    # Web entry point (imports CSS + App)
    ├── style.css                  # UCC light academic theme
    ├── demo.ts                    # Node.js demo of the core library
    ├── index.ts                   # Public barrel export of the core
    ├── models/
    │   └── Song.ts                # Song interface
    ├── structures/
    │   ├── SongNode.ts            # Node with value / next / prev
    │   └── DoublyLinkedList.ts    # The data structure
    ├── services/
    │   ├── YouTubeMusicService.ts # Search + metadata + offline catalog
    │   └── MoodRecommendationService.ts # Groq-only AI recommendation client
    ├── controllers/
    │   └── PlayerController.ts    # Playback state + cursor over the list
    └── ui/
        ├── App.ts                 # DOM + controller integration
        └── YouTubePlayer.ts       # Thin IFrame Player API wrapper
```

---

## Data Structure Overview

The queue is a **doubly linked list**: each node points to the next and the
previous node, so the player can move forward (`next`) and backward (`prev`) in
constant time once a node reference is known.

### `Song` interface (`src/models/Song.ts`)

```typescript
interface Song {
    id: string;          // Spotify/YouTube track ID
    title: string;
    artist: string;
    albumCover: string;  // artwork URL
    audioUrl: string;    // stream/preview URL or YouTube video ID
    duration: number;    // seconds
    moodTags?: string[]; // e.g. ['happy', 'chill']
}
```

### `SongNode` (`src/structures/SongNode.ts`)

```typescript
class SongNode {
    value: Song;
    next: SongNode | null;
    prev: SongNode | null;
}
```

### `DoublyLinkedList` (`src/structures/DoublyLinkedList.ts`)

The list tracks both ends through the `head` and `tail` pointers and keeps a
`_length` counter in sync on every mutation.

| Operation            | Complexity | Notes                                        |
| -------------------- | ---------- | -------------------------------------------- |
| `append(song)`       | O(1)       | Insert after the current tail                |
| `prepend(song)`      | O(1)       | Insert before the current head               |
| `insertAt(index, s)` | O(n)       | O(n) walk to index, O(1) pointer relink      |
| `deleteAt(index)`    | O(n)       | O(n) walk to index, O(1) pointer relink      |
| `deleteById(id)`     | O(n)       | Linear search, reuses `deleteAt`             |
| `clear()`            | O(1)       | Drops head/tail references                   |
| `toArray()`          | O(n)       | Exports head → tail order                    |
| `sort(compare)`      | O(n log n) | Merge sort relinking nodes (no arrays)       |
| `shuffle()`          | O(n log n) | Random priority + merge sort; O(n) aux       |
| `removeDuplicates()` | O(n)       | Keeps first title+artist (case/accent-free)  |
| `searchByText(text)` | O(n)       | Returns matching indices (title/artist)      |
| `totalDuration()`    | O(n)       | Sum of durations in seconds                  |
| `moveUp(i)`          | O(n)       | Swap with previous neighbor via `moveTrack`  |
| `moveDown(i)`        | O(n)       | Swap with next neighbor via `moveTrack`      |
| `insertNext(s, a)`   | O(1)       | Insert just after anchor `a`; no playback    |

`nodeAt(index)` starts from whichever end is closer (head for the first half,
tail for the second half), roughly halving traversal distance.

#### Phase 3 operations (pointer-only, no arrays)

- **`sort(compare)`** — a recursive **merge sort** over the nodes: it splits the
  chain with slow/fast `next` pointers, sorts each half and merges them,
  rebuilding `prev` and `tail` at the end. Only links change, so node instances
  (and therefore the `PlayerController` cursor) stay valid. **O(n log n)** time,
  O(log n) recursion, O(1) extra memory.
- **`shuffle()`** — assigns every node a random priority, then merge-sorts by
  that priority, producing a random permutation that preserves node instances.
  **O(n log n)** time, O(n) auxiliary memory. No `Array` methods are used.
- **`removeDuplicates()`** — walks with `node`/`prev` and drops repeats of the
  same **title + artist** (normalized: lowercase, accents stripped), keeping the
  first occurrence. Removal bridges neighbors in O(1). **O(n)** time; returns how
  many tracks were removed.
- **`searchByText(text)`** — pointer walk that returns the zero-based indices of
  songs whose **title or artist** contain the text (case/accent-insensitive).
  **O(n)** time.
- **`totalDuration()`** — sums every track's `duration` (seconds). **O(n)**.
- **`moveUp(index)` / `moveDown(index)`** — reuse `moveTrack` to swap a node with
  its previous/next neighbor. **O(n)** to locate the index, O(1) relink.
- **`insertNext(song, anchor)`** — splices a new song immediately after `anchor`
  (or appends when `anchor` is `null`) via `insertAfterNode`, without touching the
  cursor or starting playback. **O(1)**.

#### Pointer updates during insertion

**Append (tail insertion):**

```text
newNode.prev = tail     // 1. link the new node back to the old tail
tail.next    = newNode  // 2. link the old tail forward to the new node
tail         = newNode  // 3. move the tail marker
```

**Prepend (head insertion):**

```text
newNode.next = head     // 1. link the new node forward to the old head
head.prev    = newNode  // 2. link the old head back to the new node
head         = newNode  // 3. move the head marker
```

**Middle insertion at `index`:**

```text
newNode.prev  = previous  // 1. new node points back to the left neighbor
newNode.next  = current   // 2. new node points forward to the right neighbor
previous.next = newNode   // 3. left neighbor now points to the new node
current.prev  = newNode   // 4. right neighbor now points back to the new node
```

#### Pointer updates during deletion

**Middle deletion:**

```text
previous.next = next      // 1. bridge forward over the removed node
next.prev     = previous  // 2. bridge backward over the removed node
removed.prev  = null      // 3. detach the removed node for garbage collection
removed.next  = null
```

Removing the head advances `head` and clears the new head's `prev`; removing
the tail moves `tail` backward and clears the new tail's `next`. Deleting the
last node resets both `head` and `tail` to `null`.

### `PlayerController` — playback cursor and smart reordering

`PlayerController` (`src/controllers/PlayerController.ts`) wraps the list and
owns a `currentNode` cursor:

- **`next()` / `previous()`** move the cursor along the `next`/`prev`
  pointers in O(1) and return the new `Song`.
- **`playTrackAt(index)`** walks the list to the requested index and loads it.
- **`addTrack(song, 'start' | 'end' | 'index', index?)`** delegates to
  `prepend` / `append` / `insertAt`.
- **`removeTrackById(id)`** removes a track and, if it was the current one,
  safely advances the cursor to its successor (or the new tail).
- **`sort(compare)` / `shuffle()`** reorder the queue while the cursor keeps
  pointing at the same song (nodes are relinked, never reallocated).
- **`removeDuplicates()`** drops repeated tracks; if the current node was a
  duplicate it moves the cursor to the surviving first occurrence.
- **`searchByText(text)`** and **`totalDuration()`** delegate to the list.
- **`moveUp(index)` / `moveDown(index)`** swap with a neighbor via `moveTrack`
  (the cursor follows the moved node).
- **`insertNext(song)`** queues a track right after the current one **without
  playing it** — the backing operation for the "Reproducir a continuación"
  button.
- Getters: `currentSong`, `playlist` (array snapshot), `hasNext`, `hasPrevious`,
  `currentIndex`, `length`.

Smart reordering reuses `clear()` + `append()` so the `prev`/`next`/`head`/
`tail` invariants are never broken while rebuilding the queue.

---

## YouTube Music Service

`YouTubeMusicService` (`src/services/YouTubeMusicService.ts`) exposes
`searchMusic(query, apiKey?)`:

1. Appends `official audio music` to the query to favor official uploads.
2. When an API key is provided, calls the **YouTube Data API v3** search
   endpoint filtered to the music category (`videoCategoryId=10`), maps each
   result to a `Song` (`id` = YouTube video ID), and enriches durations through
   the `videos` endpoint using ISO-8601 parsing.
3. When no key is provided (or the request fails), it serves a built-in
   **offline catalog** of 22 popular tracks with real video IDs, artwork from
   the YouTube thumbnail CDN, and mood tags, so the app works out of the box.

---

## AI Mood Recommendation

`MoodRecommendationService` (`src/services/MoodRecommendationService.ts`) is a
thin client around the **Groq chat completions API** (OpenAI-compatible). It
has a single entry point:

### Groq-only recommendation + live YouTube Music

`fetchAIRecommendation(userMoodInput, apiKey?, exclude?)` calls Groq directly
(default model `llama-3.3-70b-versatile`, overridable via `VITE_GROQ_MODEL`).
There is **no local catalog, fallback array, or tag-matching logic**: whenever
Groq responds, its suggestion is the one used. If Groq cannot be reached (no
key, network error or invalid JSON), the method returns `null` and the UI shows
a Spanish message instead of a static list.

The system prompt uses the persona *"You are an expert music curator API. You
ONLY respond with raw valid JSON."* and pins a strict output contract:

```json
{ "title": "Exact Song Title", "artist": "Exact Artist Name", "reason": "Explicación breve en español de por qué coincide exactamente con lo pedido." }
```

Rules enforced by the prompt: a requested genre (e.g. "reggaeton") must match,
a requested language (e.g. "español") must match, and the reply must be pure raw
JSON (no markdown fences, no extra text).

The UI then resolves the real metadata (`videoId`, HD thumbnail, duration) with
`YouTubeMusicService.searchMusic(title + " " + artist + " official")` and renders
it in the AI preview card. When the user asks for **"Generar otra opción"**, the
service is called again with the previous `title`/`artist` so the prompt
explicitly says *Do not recommend that track*, and the new track is fetched from
YouTube.

---

## UI & Branding

The client follows a **light academic theme** inspired by Universidad
Cooperativa de Colombia branding:

| Token           | Color     | Usage                                      |
| --------------- | --------- | ------------------------------------------ |
| Canvas          | `#f8fafc` | Page background                            |
| Surface         | `#ffffff` | Cards with soft shadow and rounded corners |
| Petroleum/Slate | `#0f2b46` / `#1e293b` | Headings and primary text     |
| UCC Cyan/Teal   | `#00a8cc` | Icons, badges, secondary buttons           |
| UCC Lime Green  | `#c4d600` / `#a3e635` | Main play button, active track highlight |

The layout is a responsive grid with: **Reproduciendo Ahora**, **Controles
Principales**, **Agregar Canción**, the **Asistente de IA por Estado de Ánimo**
and an interactive **Lista de Reproducción** table. The active row is highlighted
in lime and shows an animated equalizer while playing.

---

## Local Setup & Commands

### Prerequisites

- Node.js **18+** (Node 20 recommended)
- npm

### Install

```bash
npm install
```

### Development server

```bash
npm run dev
```

Starts Vite on <http://localhost:5173> with hot module replacement.

### Production build

```bash
npm run build
```

This runs, in order:

1. `build:core` — compiles the core library to `dist/` (CommonJS).
2. `typecheck` — `tsc --noEmit` with zero errors.
3. `vite build` — bundles the SPA to `dist-web/`.
4. `verify:build` — checks that HTML, JS, CSS and the YouTube API script exist.

### Preview the production build

```bash
npm run preview
```

### Run the core demo (Node.js)

```bash
npm run demo
```

Exercises the doubly linked list, the YouTube service and the mood engine from
the command line.

### Environment variables (`.env`)

Copy the template and fill in your keys:

```bash
cp .env.example .env
```

```dotenv
VITE_YOUTUBE_API_KEY=tu_clave_de_youtube_aqui
VITE_GROQ_API_KEY=tu_clave_de_groq_aqui
VITE_GROQ_MODEL=openai/gpt-oss-20b
```

Vite only exposes variables prefixed with `VITE_`. The web UI reads them
automatically: the YouTube key powers live search and the Groq key is injected
into `MoodRecommendationService`, so AI recommendations run with no manual
input. `VITE_GROQ_MODEL` selects the model (defaults to `llama-3.3-70b-versatile`;
set another supported Groq id if you prefer). Placeholder values are ignored, so
without a Groq key the AI assistant simply asks you to configure one instead of
falling back to a local list.

| Variable               | Used by        | Purpose                                        |
| ---------------------- | -------------- | ---------------------------------------------- |
| `VITE_YOUTUBE_API_KEY` | web UI         | Live YouTube Data API key for the search        |
| `VITE_GROQ_API_KEY`    | web UI         | Default key for AI mood recommendations         |
| `VITE_GROQ_MODEL`      | web UI         | Groq model id (default `llama-3.3-70b-versatile`) |
| `YT_API_KEY`           | `npm run demo` | Live YouTube Data API search (Node demo)      |
| `AI_API_KEY`           | `npm run demo` | Live LLM recommendation (Node demo)           |

> `.env` is git-ignored; never commit real keys.

---

## Deployment Instructions

The build output is a static SPA in `dist-web/` and can be hosted anywhere.
`vercel.json` and `netlify.toml` already configure the build command, the
publish directory and the SPA rewrite (all routes → `index.html`).

### Option A — Vercel (1 click)

1. Push this repository to GitHub/GitLab/Bitbucket.
2. Go to <https://vercel.com/new> and **Import** the repository.
3. Vercel auto-detects Vite; keep the detected settings. The included
   `vercel.json` overrides the output directory to `dist-web` and adds the SPA
   rewrite.
4. Click **Deploy**. Future pushes deploy automatically.

CLI alternative:

```bash
npm i -g vercel
vercel        # preview deployment
vercel --prod # production deployment
```

### Option B — Netlify (1 click)

1. Push the repository to your Git provider.
2. Go to <https://app.netlify.com/start> and pick the repository.
3. Netlify reads `netlify.toml`: build `npm run build`, publish `dist-web`, and
   the `/* → /index.html` rewrite is applied automatically.
4. Click **Deploy site**.

CLI alternative:

```bash
npm i -g netlify-cli
netlify deploy --build            # draft URL
netlify deploy --build --prod     # production
```

### Option C — GitHub Pages

Because GitHub Pages serves project sites from a sub-path
(`https://<user>.github.io/<repo>/`), build with the matching `base`:

```bash
npm run deploy:pages
```

This runs `build:pages` (Vite `--base=/uccplay/`) and publishes `dist-web/`
with `gh-pages -t`. Adjust the `/uccplay/` base in `package.json` if your
repository has a different name. A `public/.nojekyll` file is included so Pages
does not run Jekyll on the build output.

---

## Instrucciones de uso (Español)

1. Ejecuta `npm install` y luego `npm run dev`. Se abrirá la aplicación en tu
   navegador.
2. En la sección **"Reproduciendo Ahora"** verás la canción actual, su portada,
   la barra de progreso y la posición dentro de la lista (por ejemplo,
   *"Canción 2 de 10"*).
3. Usa los botones **"Anterior"** y **"Siguiente"** para recorrer la lista
   doblemente enlazada, y el botón verde **"Reproducir / Pausa"** para controlar
   la música.
4. Para agregar una canción, escribe el nombre de la canción o del artista en
   la barra **"Buscar canción o artista en YouTube Music..."** y pulsa
   **"Buscar"**. Aparecerán tarjetas de resultados con la portada, el título, el
   artista y la duración. En cada tarjeta elige la posición —*Al Final (Tail)*,
   *Al Inicio (Head)* o *En Posición Específica* (con su índice)*— y pulsa
   **"➕ Agregar a la Lista"**; verás el aviso *"¡Canción agregada a la lista!"*.
   Si pegas una **Clave API de YouTube** en *Opciones avanzadas*, la búsqueda se
   hace en vivo; si no, se usa el catálogo local con búsqueda difusa.
5. Para reordenar la lista según tu estado de ánimo, escribe cómo te sientes en
   **"¿Cómo te sientes hoy?"** (por ejemplo, *"Estoy concentrado estudiando
   para mi examen"*) y pulsa **"Recomendar y Reordenar Lista"**. Si pegas una
   **Clave API de Groq** en el campo opcional, la recomendación se genera con
   IA; si lo dejas vacío, se usa el motor de puntuación local.
6. En la **"Lista de Reproducción"** puedes reproducir o **Eliminar** cualquier
   canción; la fila de la canción activa se resalta en verde.

---

## License

MIT — see `package.json` for details.
