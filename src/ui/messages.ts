/**
 * Centralized Spanish UI copy for UCCplay.
 *
 * Every user-facing string lives here so the interface stays strictly in
 * Spanish while the TypeScript code and comments remain in English.
 */
export const MESSAGES = {
    mood: {
        missingPrompt: 'Escribe cómo te sientes para recibir recomendaciones.',
        missingGroqKey: 'Configura una clave de Groq para recibir recomendaciones de la IA.',
        searching: 'Buscando en YouTube Music...',
        ready: 'Resultado de la IA listo. Elige una acción.',
        noSuggestion: 'La IA no encontró una canción disponible para esa petición.',
        invalidSuggestion: 'La IA no devolvió una recomendación válida.',
        youtubeQuota: 'Se agotó la cuota de la API de YouTube. Intenta más tarde.',
        youtubeInvalidKey: 'La clave de la API de YouTube no es válida.',
        youtubeNetwork: 'No se pudo conectar con YouTube Music. Revisa tu conexión.',
        addFailed: 'No se pudo agregar la canción a la lista.',
        added: 'Canción agregada a la lista.',
        queuedNext: 'Canción programada para reproducirse a continuación.'
    },
    player: {
        loading: 'Cargando la canción...',
        videoUnavailable: 'Este video no está disponible o no permite reproducción incrustada.',
        videoRestricted: 'El propietario no permite reproducir este video fuera de YouTube.',
        invalidVideoRequest: 'La solicitud del video no es válida.',
        html5Error: 'El reproductor encontró un error interno de HTML5.',
        configurationError:
            'El reproductor no se pudo configurar (origen o referer). Revisa la configuración del sitio.',
        playerUnavailable:
            'No se pudo cargar el reproductor de YouTube. Revisa tu conexión o el bloqueador de anuncios e inténtalo de nuevo.',
        readyTimeout:
            'El reproductor de YouTube tardó demasiado en cargar. Revisa tu conexión e inténtalo de nuevo.',
        playbackStalled:
            'La reproducción no inició. El navegador puede estar bloqueando el audio: pulsa Reproducir otra vez.',
        unknownError: (code: number) => `Error del reproductor de YouTube (código ${code}).`,
        previous: 'Anterior',
        play: 'Reproducir',
        pause: 'Pausa',
        next: 'Siguiente',
        repeatOff: 'Repetición desactivada',
        repeatAll: 'Repetir toda la lista',
        repeatOne: 'Repetir una canción'
    },
    row: {
        play: (title: string, artist: string) => `Reproducir ${title} de ${artist}`,
        playNext: (title: string, artist: string) =>
            `Reproducir ${title} de ${artist} a continuación`,
        moveUp: (title: string, artist: string) => `Subir ${title} de ${artist}`,
        moveDown: (title: string, artist: string) => `Bajar ${title} de ${artist}`,
        remove: (title: string, artist: string) => `Eliminar ${title} de ${artist}`,
        coverAlt: (title: string) => `Portada de ${title}`,
        dragHandle: 'Arrastrar para reordenar'
    },
    preview: {
        badge: 'Resultado de la IA · YouTube Music',
        defaultReason: 'Sugerida por la IA según tu estado de ánimo.',
        playNow: 'Reproducir ahora',
        playNext: 'Reproducir a continuación',
        add: 'Agregar a la Lista',
        regenerate: 'Generar otra opción',
        addedToast: '¡Canción agregada a la lista!',
        playNowTitle: (title: string) => `Reproducir ${title} ahora`,
        playNextTitle: (title: string) => `Reproducir ${title} a continuación`,
        addTitle: (title: string) => `Agregar ${title} a la lista`,
        regenerateTitle: 'Buscar otra recomendación para el mismo estado de ánimo'
    },
    playlistPicker: {
        title: 'Agregar a una lista',
        subtitle: (title: string, artist: string) => `${title} — ${artist}`,
        activeBadge: 'Activa',
        confirm: 'Agregar',
        cancel: 'Cancelar',
        empty: 'No hay listas disponibles.',
        added: (name: string) => `Canción agregada a "${name}".`,
        addFailed: 'No se pudo agregar la canción a la lista seleccionada.'
    }
} as const;
