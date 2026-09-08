// All sounds are synthesized at runtime with the Web Audio API. No audio files are loaded.
export type GameAudio = {
  setActive(active: boolean): void;
  setEngine(active: boolean, ratio: number): void;
  setAmbient(wasteland: boolean): void;
  footstep(running: boolean): void;
  fire(pellets: number, automatic: boolean): void;
  reloadStart(): void;
  reloadComplete(): void;
  hit(bonus: boolean): void;
  impact(strength: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
};

export function createGameAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;

  let engineGain: GainNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let engineOscA: OscillatorNode | null = null;
  let engineOscB: OscillatorNode | null = null;
  let engineThrobGain: GainNode | null = null;
  let engineThrob: OscillatorNode | null = null;
  let engineTarget = 0;

  let ambientGain: GainNode | null = null;
  let ambientFilter: BiquadFilterNode | null = null;
  let ambientSource: AudioBufferSourceNode | null = null;

  function init() {
    if (ctx) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);

      const noiseLength = ctx.sampleRate * 2;
      noise = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < noiseLength; i++) data[i] = Math.random() * 2 - 1;

      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 250;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOscA = ctx.createOscillator();
      engineOscA.type = "sawtooth";
      engineOscA.frequency.value = 55;
      engineOscB = ctx.createOscillator();
      engineOscB.type = "sawtooth";
      engineOscB.frequency.value = 55.3;
      engineThrob = ctx.createOscillator();
      engineThrob.type = "sine";
      engineThrob.frequency.value = 9;
      engineThrobGain = ctx.createGain();
      engineThrobGain.gain.value = 0;
      engineOscA.connect(engineFilter);
      engineOscB.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineThrob.connect(engineThrobGain);
      engineThrobGain.connect(engineGain.gain);
      engineGain.connect(master);
      engineOscA.start();
      engineOscB.start();
      engineThrob.start();

      ambientFilter = ctx.createBiquadFilter();
      ambientFilter.type = "bandpass";
      ambientFilter.frequency.value = 500;
      ambientFilter.Q.value = 0.6;
      ambientGain = ctx.createGain();
      ambientGain.gain.value = 0.05;
      ambientSource = ctx.createBufferSource();
      ambientSource.buffer = noise;
      ambientSource.loop = true;
      ambientSource.connect(ambientFilter);
      ambientFilter.connect(ambientGain);
      ambientGain.connect(master);
      ambientSource.start();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function burst(duration: number, filterFreq: number, filterQ: number, gainPeak: number, filterType: BiquadFilterType = "bandpass") {
    if (!ctx || !master || !noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loopStart = Math.random() * 1.5;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now, source.loopStart);
    source.stop(now + duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  function tone(freqFrom: number, freqTo: number, duration: number, gainPeak: number, type: OscillatorType = "sine") {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  return {
    setActive(active) {
      if (active) { if (!init()) return; ctx?.resume(); }
      else ctx?.suspend();
    },
    setEngine(active, ratio) {
      if (!ctx || !engineGain || !engineFilter || !engineOscA || !engineOscB || !engineThrob || !engineThrobGain) return;
      const clamped = Math.min(1, Math.max(0, ratio));
      engineTarget = active ? 0.05 + clamped * 0.16 : 0;
      const now = ctx.currentTime;
      engineGain.gain.setTargetAtTime(engineTarget, now, 0.12);
      engineThrobGain.gain.setTargetAtTime(active ? 0.02 + clamped * 0.02 : 0, now, 0.15);
      const freq = 48 + clamped * 150;
      engineOscA.frequency.setTargetAtTime(freq, now, 0.08);
      engineOscB.frequency.setTargetAtTime(freq * 1.006, now, 0.08);
      engineFilter.frequency.setTargetAtTime(240 + clamped * 950, now, 0.08);
      engineThrob.frequency.setTargetAtTime(8 + clamped * 14, now, 0.15);
    },
    setAmbient(wasteland) {
      if (!ctx || !ambientFilter || !ambientGain) return;
      const now = ctx.currentTime;
      ambientFilter.frequency.setTargetAtTime(wasteland ? 850 : 380, now, 1.2);
      ambientFilter.Q.setTargetAtTime(wasteland ? 0.9 : 0.5, now, 1.2);
      ambientGain.gain.setTargetAtTime(wasteland ? 0.045 : 0.06, now, 1.2);
    },
    footstep(running) {
      burst(running ? 0.07 : 0.09, running ? 300 : 220, 1.1, running ? 0.1 : 0.075, "bandpass");
    },
    fire(pellets, automatic) {
      if (pellets > 1) { burst(0.22, 900, 0.7, 0.32, "lowpass"); tone(140, 60, 0.18, 0.22, "triangle"); }
      else { burst(automatic ? 0.09 : 0.14, 1600, 0.9, automatic ? 0.16 : 0.22, "bandpass"); tone(360, 90, automatic ? 0.07 : 0.12, 0.18, "sawtooth"); }
    },
    reloadStart() {
      burst(0.03, 2400, 4, 0.09, "highpass");
    },
    reloadComplete() {
      burst(0.03, 2200, 4, 0.09, "highpass");
      window.setTimeout(() => burst(0.03, 3000, 4, 0.09, "highpass"), 90);
    },
    hit(bonus) {
      tone(1100, 1500, 0.1, 0.16, "sine");
      if (bonus) window.setTimeout(() => tone(1500, 1900, 0.12, 0.16, "sine"), 70);
    },
    impact(strength) {
      const s = Math.min(1, strength);
      burst(0.22, 140, 0.8, 0.1 + s * 0.3, "lowpass");
    },
    setMuted(value) {
      muted = value;
      if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05);
    },
    dispose() {
      try {
        engineOscA?.stop(); engineOscB?.stop(); engineThrob?.stop(); ambientSource?.stop();
        master?.disconnect();
        ctx?.close();
      } catch { /* already stopped or unsupported */ }
      ctx = null;
    },
  };
}
