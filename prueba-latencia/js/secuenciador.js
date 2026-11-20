// Secuenciador con planificación anticipada ("lookahead"): un temporizador del
// hilo principal programa los golpes con unos 120 ms de antelación en el reloj
// de audio, así los bloqueos del hilo principal (p. ej. la detección de la
// mano) no desplazan el ritmo.

const PATRON = {
  //        1 . . . 2 . . . 3 . . . 4 . . .
  bombo:   [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  caja:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  charles: [1, 0, .5, 0, 1, 0, .5, 0, 1, 0, .5, 0, 1, 0, .5, 1],
};

const ANTELACION_S = 0.12;
const PERIODO_MS = 25;

export class Secuenciador {
  constructor(motor) {
    this.motor = motor;
    this.bpm = 100;
    this.modo = 'bateria'; // 'bateria' | 'metronomo'
    this.sonando = false;
    this.t0 = 0;
    this.paso = 0;
  }

  /** Duración de un pulso (negra) en segundos. */
  get segPulso() {
    return 60 / this.bpm;
  }

  iniciar(modo = this.modo) {
    this.parar();
    this.modo = modo;
    this.t0 = this.motor.ahora + 0.15;
    this.paso = 0;
    this.sonando = true;
    this._programar();
    this.temporizador = setInterval(() => this._programar(), PERIODO_MS);
  }

  parar() {
    clearInterval(this.temporizador);
    this.sonando = false;
  }

  /** Tiempo (reloj de audio) del paso n (semicorcheas desde el inicio). */
  tiempoPaso(n) {
    return this.t0 + (n * this.segPulso) / 4;
  }

  /**
   * Punto de la rejilla más cercano a t. subdivision = divisiones por pulso
   * (1 = negras, 2 = corcheas...). Devuelve índice, tiempo y error en s.
   */
  rejillaMasCercana(t, subdivision = 1) {
    const dur = this.segPulso / subdivision;
    const n = Math.round((t - this.t0) / dur);
    const tRejilla = this.t0 + n * dur;
    return { n, t: tRejilla, error: t - tRejilla };
  }

  _programar() {
    const limite = this.motor.ahora + ANTELACION_S;
    while (this.tiempoPaso(this.paso) < limite) {
      this._sonarPaso(this.paso, this.tiempoPaso(this.paso));
      this.paso++;
    }
  }

  _sonarPaso(paso, t) {
    const s = paso % 16;
    const m = this.motor;
    if (this.modo === 'bateria') {
      if (PATRON.bombo[s]) m.bombo(t, PATRON.bombo[s]);
      if (PATRON.caja[s]) m.caja(t, PATRON.caja[s]);
      if (PATRON.charles[s]) m.charles(t, PATRON.charles[s]);
    } else if (s % 4 === 0) {
      m.clic(t, s === 0);
    }
  }
}
