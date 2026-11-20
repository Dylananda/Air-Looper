// Motor de audio: contexto Web Audio, sonidos sintetizados (batería, metrónomo y
// voces) y conversión entre el reloj del navegador (performance.now) y el
// reloj de audio.
//
// Todos los sonidos devuelven una función que los cancela si aún no han
// empezado a sonar (la usa la predicción cuando se equivoca).

export class MotorAudio {
  async iniciar() {
    // 'interactive' pide el búfer más pequeño que el sistema permita.
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Compresor suave al final para que la batería y las notas no saturen.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(ctx.destination);

    this.maestro = ctx.createGain();
    this.maestro.gain.value = 0.8;
    this.maestro.connect(comp);

    this.busBateria = ctx.createGain();
    this.busBateria.gain.value = 0.6;
    this.busBateria.connect(this.maestro);

    this.busNotas = ctx.createGain();
    this.busNotas.gain.value = 0.8;
    this.busNotas.connect(this.maestro);

    // Un segundo de ruido blanco reutilizable para caja, charles, palmas.
    const largo = ctx.sampleRate;
    this.ruido = ctx.createBuffer(1, largo, ctx.sampleRate);
    const datos = this.ruido.getChannelData(0);
    for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;

    if (ctx.state !== 'running') await ctx.resume();
  }

  get ahora() {
    return this.ctx.currentTime;
  }

  /** Latencias que declara el navegador, en ms (outputLatency puede no existir). */
  latenciasDeclaradas() {
    const c = this.ctx;
    return {
      base: (c.baseLatency || 0) * 1000,
      salida: Number.isFinite(c.outputLatency) ? c.outputLatency * 1000 : null,
    };
  }

  /**
   * Convierte un instante de performance.now() (ms) al tiempo del contexto de
   * audio que está SONANDO por el altavoz en ese instante. Así, un sonido
   * programado en el tiempo X se oye cuando audibleDesdePerf(t) === X.
   */
  audibleDesdePerf(perfMs) {
    const c = this.ctx;
    if (typeof c.getOutputTimestamp === 'function') {
      const ts = c.getOutputTimestamp();
      if (ts.performanceTime > 0 && ts.contextTime > 0) {
        return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      }
    }
    // Plan B: currentTime menos la latencia declarada.
    const lat = this.latenciasDeclaradas();
    return c.currentTime - ((lat.salida ?? 0) + lat.base) / 1000 + (perfMs - performance.now()) / 1000;
  }

  /** Retardo actual entre lo que se programa "ya" y lo que suena, en ms. */
  retardoSalidaMs() {
    return (this.ctx.currentTime - this.audibleDesdePerf(performance.now())) * 1000;
  }

  // ---------------------------------------------------------------------
  // Batería. `destino` permite mandar los golpes de los pads al bus de notas.
  // ---------------------------------------------------------------------

  bombo(t, vel = 1, destino = this.busBateria) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    envolventePercusiva(g.gain, t, vel, 0.4);
    osc.connect(g).connect(destino);
    osc.start(t);
    osc.stop(t + 0.45);
    return () => this._cancelar(t, g, [osc]);
  }

  caja(t, vel = 1, destino = this.busBateria) {
    const c = this.ctx;
    const ruido = this._fuenteRuido();
    const filtro = c.createBiquadFilter();
    filtro.type = 'highpass';
    filtro.frequency.value = 1200;
    const g = c.createGain();
    envolventePercusiva(g.gain, t, 0.5 * vel, 0.18);
    ruido.connect(filtro).connect(g).connect(destino);
    ruido.start(t);
    ruido.stop(t + 0.2);

    const tono = c.createOscillator();
    tono.type = 'triangle';
    tono.frequency.value = 190;
    const gt = c.createGain();
    envolventePercusiva(gt.gain, t, 0.4 * vel, 0.1);
    tono.connect(gt).connect(destino);
    tono.start(t);
    tono.stop(t + 0.12);
    return () => this._cancelar(t, g, [ruido]) && this._cancelar(t, gt, [tono]);
  }

  charles(t, vel = 1, destino = this.busBateria) {
    const c = this.ctx;
    const ruido = this._fuenteRuido();
    const filtro = c.createBiquadFilter();
    filtro.type = 'highpass';
    filtro.frequency.value = 7000;
    const g = c.createGain();
    envolventePercusiva(g.gain, t, 0.25 * vel, 0.05);
    ruido.connect(filtro).connect(g).connect(destino);
    ruido.start(t);
    ruido.stop(t + 0.06);
    return () => this._cancelar(t, g, [ruido]);
  }

  palmas(t, vel = 1, destino = this.busBateria) {
    const c = this.ctx;
    const ruido = this._fuenteRuido();
    const filtro = c.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = 1300;
    filtro.Q.value = 1.2;
    const g = c.createGain();
    // Tres chasquidos muy seguidos y una cola corta: suena a palmada.
    g.gain.setValueAtTime(0, t);
    for (const d of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(0.7 * vel, t + d);
      g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.009);
    }
    g.gain.setValueAtTime(0.5 * vel, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    ruido.connect(filtro).connect(g).connect(destino);
    ruido.start(t);
    ruido.stop(t + 0.22);
    return () => this._cancelar(t, g, [ruido]);
  }

  clic(t, acento = false) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.frequency.value = acento ? 2000 : 1400;
    const g = c.createGain();
    envolventePercusiva(g.gain, t, acento ? 0.9 : 0.6, 0.035, 0.001);
    osc.connect(g).connect(this.busBateria);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  // ---------------------------------------------------------------------
  // Voces para tocar.
  // ---------------------------------------------------------------------

  /** Ataque inmediato (~1 ms) y caída rápida, tipo marimba. */
  notaPercusiva(t, frecuencia, vel = 1) {
    const c = this.ctx;
    const g = c.createGain();
    envolventePercusiva(g.gain, t, 0.9 * vel, 0.35, 0.001);
    const fund = c.createOscillator();
    fund.frequency.value = frecuencia;
    const arm = c.createOscillator();
    arm.frequency.value = frecuencia * 4;
    const ga = c.createGain();
    ga.gain.setValueAtTime(0.3, t);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    fund.connect(g);
    arm.connect(ga).connect(g);
    g.connect(this.busNotas);
    for (const o of [fund, arm]) {
      o.start(t);
      o.stop(t + 0.4);
    }
    return () => this._cancelar(t, g, [fund, arm]);
  }

  /** Ataque lento (~80 ms) y cola larga, tipo pad: disimula la latencia. */
  notaSuave(t, frecuencia, vel = 1) {
    const c = this.ctx;
    const filtro = c.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 1400;
    filtro.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * vel, t + 0.08);
    g.gain.setTargetAtTime(0, t + 0.25, 0.2);
    const oscs = [-7, 7].map((desafinado) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = frecuencia;
      o.detune.value = desafinado;
      o.connect(filtro);
      o.start(t);
      o.stop(t + 1.4);
      return o;
    });
    filtro.connect(g).connect(this.busNotas);
    return () => this._cancelar(t, g, oscs);
  }

  _cancelar(t, ganancia, fuentes) {
    if (this.ctx.currentTime >= t) return false; // ya está sonando
    ganancia.gain.cancelScheduledValues(0);
    ganancia.gain.value = 0;
    for (const f of fuentes) {
      try {
        f.stop();
      } catch {
        /* ya parado */
      }
    }
    return true;
  }

  _fuenteRuido() {
    const f = this.ctx.createBufferSource();
    f.buffer = this.ruido;
    return f;
  }
}

/** Envolvente de ataque casi instantáneo y caída exponencial. */
function envolventePercusiva(param, t, pico, caida, ataque = 0.002) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(pico, 0.0002), t + ataque);
  param.exponentialRampToValueAtTime(0.0001, t + caida);
}

/** Frecuencia en Hz de una nota MIDI. */
export function midiAHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
