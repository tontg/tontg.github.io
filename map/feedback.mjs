export class ArrivalFeedback {
  constructor(preferences = {}) {
    this.preferences = preferences;
    this.audio = null;
    this.lastResult = 'feedback.idle';
  }

  async unlock() {
    if (!this.preferences.sound) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) { this.lastResult = 'feedback.unavailable'; return; }
      this.audio ??= new Audio();
      if (this.audio.state !== 'running') await this.audio.resume();
    } catch { this.lastResult = 'feedback.unavailable'; }
  }

  async play(complete = false, session = null) {
    let delivered = false;
    if (this.preferences.sound && this.audio?.state === 'running') {
      const now = this.audio.currentTime;
      for (const [index, frequency] of (complete ? [660, 880, 1100] : [660, 880]).entries()) {
        const oscillator = this.audio.createOscillator();
        const gain = this.audio.createGain();
        const start = now + index * 0.15;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.1, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
        oscillator.connect(gain).connect(this.audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + 0.14);
      }
      delivered = true;
    }
    if (this.preferences.haptics) {
      const actuators = [...(session?.inputSources || [])].flatMap((input) => [...(input.gamepad?.hapticActuators || [])]);
      const results = await Promise.allSettled(actuators.map(async (actuator) => actuator.pulse(0.5, complete ? 250 : 120)));
      delivered ||= results.some((result) => result.status === 'fulfilled' && result.value === true);
      if (!session) {
        try { delivered = (globalThis.navigator?.vibrate?.(complete ? [100, 80, 180] : 100) || false) || delivered; } catch { /* Optional API. */ }
      }
    }
    this.lastResult = delivered ? 'feedback.sent' : this.preferences.sound || this.preferences.haptics ? 'feedback.unavailable' : 'feedback.off';
  }

  close() {
    if (this.audio) void this.audio.close().catch(() => {});
    this.audio = null;
  }
}
