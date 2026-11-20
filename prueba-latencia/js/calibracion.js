// Calibración: el usuario hace la pinza al ritmo de un metrónomo y se mide
// cuánto después del clic programado llega cada pinza al motor de audio.
//
// Ese desfase incluye todo: salida de audio (el clic tarda en oírse), reacción
// y precisión humana, cámara y detección. Es justo lo que hay que restar a
// una nota para colocarla en su sitio al grabar.

import { resumir, medianaYMad } from './estadisticas.js';

export class Calibracion {
  constructor(secuenciador) {
    this.sec = secuenciador;
    this.activa = false;
    this.golpes = [];
  }

  /** Arranca: 1 compás de cuenta (4 clics) y luego `compases` medidos. */
  empezar({ bpm, compases }) {
    this.sec.bpm = bpm;
    this.sec.iniciar('metronomo');
    this.pulsoInicio = 4;
    this.pulsoFin = 4 + compases * 4;
    this.golpes = [];
    this.activa = true;
  }

  /**
   * Registra una pinza. tNota: instante (reloj de audio) en que sonaría la
   * nota; tCamara: instante audible en que la cámara captó el cuadro (o null).
   */
  registrar(tNota, tCamara) {
    if (!this.activa) return null;
    const { n, error } = this.sec.rejillaMasCercana(tNota, 1);
    if (n < this.pulsoInicio || n >= this.pulsoFin) return null;
    // Más de casi medio pulso de error: no se sabe a qué clic iba.
    if (Math.abs(error) > this.sec.segPulso * 0.45) return null;
    if (this.golpes.some((g) => g.pulso === n)) return null; // doble pinza
    const golpe = {
      pulso: n,
      desfaseMs: error * 1000,
      camaraMs: tCamara != null ? (tCamara - this.sec.t0 - n * this.sec.segPulso) * 1000 : null,
    };
    this.golpes.push(golpe);
    return golpe;
  }

  /** Estado para la interfaz a partir del tiempo audible actual. */
  progreso(tAudible) {
    const pulso = Math.floor((tAudible - this.sec.t0) / this.sec.segPulso);
    if (pulso < this.pulsoInicio) return { fase: 'cuenta', pulso, cuenta: this.pulsoInicio - pulso };
    if (tAudible > this.sec.t0 + (this.pulsoFin + 0.5) * this.sec.segPulso) return { fase: 'fin', pulso };
    return { fase: 'midiendo', pulso: pulso - this.pulsoInicio, total: this.pulsoFin - this.pulsoInicio };
  }

  /** Detiene el metrónomo y calcula el resultado descartando atípicos. */
  terminar() {
    this.activa = false;
    this.sec.parar();
    const todos = this.golpes.map((g) => g.desfaseMs);
    const esperados = this.pulsoFin - this.pulsoInicio;
    if (todos.length === 0) return { esperados, validos: [], descartados: 0, resumen: resumir([]) };
    const { mediana, mad } = medianaYMad(todos);
    // Atípico: más de 3 MAD (mínimo 25 ms) de la mediana.
    const limite = Math.max(3 * 1.4826 * mad, 25);
    const validos = this.golpes.filter((g) => Math.abs(g.desfaseMs - mediana) <= limite);
    return {
      esperados,
      validos,
      descartados: this.golpes.length - validos.length,
      resumen: resumir(validos.map((g) => g.desfaseMs)),
      camara: resumir(validos.map((g) => g.camaraMs).filter((x) => x != null)),
    };
  }
}
