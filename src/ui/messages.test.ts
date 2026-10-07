import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages';

describe('MESSAGES.row aria-label templates', () => {
    it('includes the song title and artist in Spanish', () => {
        expect(MESSAGES.row.play('Hello', 'Adele')).toBe('Reproducir Hello de Adele');
        expect(MESSAGES.row.playNext('Hello', 'Adele')).toBe(
            'Reproducir Hello de Adele a continuación'
        );
        expect(MESSAGES.row.remove('Hello', 'Adele')).toBe('Eliminar Hello de Adele');
        expect(MESSAGES.row.moveUp('Hello', 'Adele')).toBe('Subir Hello de Adele');
        expect(MESSAGES.row.moveDown('Hello', 'Adele')).toBe('Bajar Hello de Adele');
    });

    it('builds a descriptive cover alt text in Spanish', () => {
        expect(MESSAGES.row.coverAlt('Hello')).toBe('Portada de Hello');
    });
});

describe('MESSAGES.player transport labels', () => {
    it('provides Spanish labels for the icon-only controls', () => {
        expect(MESSAGES.player.previous).toBe('Anterior');
        expect(MESSAGES.player.play).toBe('Reproducir');
        expect(MESSAGES.player.pause).toBe('Pausa');
        expect(MESSAGES.player.next).toBe('Siguiente');
        expect(MESSAGES.player.repeatOff).toBe('Repetición desactivada');
        expect(MESSAGES.player.repeatAll).toBe('Repetir toda la lista');
        expect(MESSAGES.player.repeatOne).toBe('Repetir una canción');
    });
});
