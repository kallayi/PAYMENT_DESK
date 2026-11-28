'use client';

const ALERT_MUTE_STORAGE_KEY = 'payment-desk-alert-muted';

export type AlertPriority = 'urgent' | 'normal';

/**
 * Returns whether in-app notification alert sounds are muted in this browser.
 */
export function isAlertSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ALERT_MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists the user's in-app alert sound mute preference in localStorage.
 */
export function setAlertSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ALERT_MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Ignore storage errors in private/restricted browser modes
  }
}

/**
 * Synthesizes a clean Web Audio chime differentiated by notification priority.
 * Respects user mute preference and fails silently if AudioContext is blocked.
 */
export function playNotificationAlertSound(priority: AlertPriority = 'normal'): void {
  try {
    if (typeof window === 'undefined' || isAlertSoundMuted()) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const isUrgent = priority === 'urgent';
    const notes = isUrgent
      ? [
          { freq: 783.99, start: 0, duration: 0.12 }, // G5
          { freq: 987.77, start: 0.1, duration: 0.12 }, // B5
          { freq: 1174.66, start: 0.2, duration: 0.26 }, // D6
        ]
      : [
          { freq: 659.25, start: 0, duration: 0.14 }, // E5
          { freq: 880.0, start: 0.11, duration: 0.22 }, // A5
        ];

    const waveType: OscillatorType = isUrgent ? 'triangle' : 'sine';
    const peakGain = isUrgent ? 0.085 : 0.07;

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveType;
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.02);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 700);
  } catch {
    // Autoplay policies or unavailable AudioContext should never break notifications
  }
}
