// Looper: pistas que se graban encima del ritmo y quedan en bucle.
//
// - Pista vacía + golpe → cuenta hasta el siguiente compás que deje al menos
//   ~4 pulsos de cuenta, graba N compases y queda sonando en bucle.
// - Pista sonando + golpe → se silencia al empezar el compás siguiente.
// - Pista silenciada + golpe → vuelve a sonar al empezar el compás siguiente.
// - «Borrar» + golpe en una pista → la vacía.
//
// Las posiciones se guardan en pulsos (no en segundos) desde el inicio de la
// pista, así un cambio de tempo no las descoloca. Las notas se graban con la
// compensación de latencia aplicada y, opcionalmente, cuantizadas a semicorcheas.

const PULSOS_POR_COMPAS = 4;

export class Looper {
  /** sonar(evento, t): hace sonar un evento grabado en el instante t. */
  constructor(secuenciador, sonar, numPistas = 4) {
    this.sec = secuenciador;
    this.sonar = sonar;
    this.compases = 1;
    this.cuantizar = true;
    this.modoBorrar = false;
    this.pistas = Array.from({ length: numPistas }, (_, i) => nuevaPista(i));
    this.sec.alProgramar = (desde, hasta) => this._programar(desde, hasta);
  }

  pulsoEn(t) {
    return (t - this.sec.t0) / this.sec.segPulso;
  }

  tiempoDePulso(b) {
    return this.sec.t0 + b * this.sec.segPulso;
  }

  /** Golpe en el botón de la pista i. `ahora`: reloj de audio. Devuelve un texto de lo que pasa. */
  pulsar(i, ahora) {
    const p = this.pistas[i];
    const b = this.pulsoEn(ahora);
    if (this.modoBorrar) {
      this.modoBorrar = false;
      Object.assign(p, nuevaPista(i));
      return `Pista ${i + 1} borrada`;
    }
    switch (p.estado) {
      case 'vacia': {
        // Primer inicio de compás con al menos 3,5 pulsos de cuenta.
        const inicio = Math.ceil((b + 3.5) / PULSOS_POR_COMPAS) * PULSOS_POR_COMPAS;
        Object.assign(p, { estado: 'cuenta', inicio, compases: this.compases, eventos: [], cambio: null });
        return `Pista ${i + 1}: cuenta y grabación de ${this.compases === 1 ? "1 compás" : `${this.compases} compases`}`;
      }
      case 'cuenta':
        Object.assign(p, nuevaPista(i));
        return `Pista ${i + 1}: grabación cancelada`;
      case 'grabando':
        return `Pista ${i + 1}: grabando…`;
      default: {
        if (p.cambio) {
          p.cambio = null; // segundo golpe antes del compás: se anula el cambio
          return `Pista ${i + 1}: cambio anulado`;
        }
        const alCompas = Math.ceil(b / PULSOS_POR_COMPAS - 1e-6) * PULSOS_POR_COMPAS;
        p.cambio = { pulso: alCompas, a: p.estado === 'sonando' ? 'silenciada' : 'sonando' };
        return `Pista ${i + 1}: ${p.cambio.a === 'silenciada' ? 'se silencia' : 'vuelve a sonar'} en el próximo compás`;
      }
    }
  }

  /**
   * Graba un evento tocado en directo. tIntencion: reloj de audio en que el
   * músico quiso tocarlo (ya compensado).
   */
  grabar(evento, tIntencion) {
    const b = this.pulsoEn(tIntencion);
    for (const p of this.pistas) {
      if (p.estado !== 'cuenta' && p.estado !== 'grabando') continue;
      const largo = p.compases * PULSOS_POR_COMPAS;
      // Se aceptan notas adelantadas hasta una semicorchea antes del inicio.
      if (b < p.inicio - 0.25 || b >= p.inicio + largo - 0.25) continue;
      let pos = b - p.inicio;
      if (this.cuantizar) pos = Math.round(pos * 4) / 4;
      pos = ((pos % largo) + largo) % largo;
      p.eventos.push({ ...evento, pos });
    }
  }

  /** Avanza los estados según el reloj (llamar a menudo). */
  actualizar(ahora) {
    const b = this.pulsoEn(ahora);
    for (const p of this.pistas) {
      const fin = p.inicio + p.compases * PULSOS_POR_COMPAS;
      if (p.estado === 'cuenta' && b >= p.inicio) p.estado = 'grabando';
      if (p.estado === 'grabando' && b >= fin) {
        if (p.eventos.length) p.estado = 'sonando';
        else Object.assign(p, nuevaPista(p.i));
      }
      if (p.cambio && b >= p.cambio.pulso) {
        p.estado = p.cambio.a;
        p.cambio = null;
      }
    }
  }

  /** El secuenciador se ha reiniciado (otro tempo, parada…): reanclar pistas. */
  reanclar() {
    for (const p of this.pistas) {
      if (p.estado === 'cuenta' || p.estado === 'grabando') {
        if (p.eventos.length) p.estado = 'sonando';
        else Object.assign(p, nuevaPista(p.i));
      }
      if (p.cambio) {
        p.estado = p.cambio.a;
        p.cambio = null;
      }
      p.inicio = 0;
    }
  }

  /** Fracción (0–1) recorrida del bucle o de la grabación, para dibujar. */
  progreso(p, ahora) {
    const largo = p.compases * PULSOS_POR_COMPAS;
    const b = this.pulsoEn(ahora) - p.inicio;
    if (p.estado === 'cuenta') return 0;
    return (((b % largo) + largo) % largo) / largo;
  }

  /** Pulsos que faltan para empezar a grabar (o null si ninguna pista está en cuenta). */
  cuentaAtras(ahora) {
    const b = this.pulsoEn(ahora);
    const enCuenta = this.pistas.filter((p) => p.estado === 'cuenta');
    if (!enCuenta.length) return null;
    return Math.ceil(Math.min(...enCuenta.map((p) => p.inicio)) - b);
  }

  _estadoEn(p, b) {
    if (p.estado === 'cuenta' || p.estado === 'grabando') {
      return b >= p.inicio + p.compases * PULSOS_POR_COMPAS ? 'sonando' : 'nada';
    }
    if (p.cambio && b >= p.cambio.pulso) return p.cambio.a;
    return p.estado;
  }

  _programar(desde, hasta) {
    if (this.sec.modo !== 'bateria') return;
    const b0 = this.pulsoEn(desde);
    const b1 = this.pulsoEn(hasta);
    for (const p of this.pistas) {
      if (p.estado === 'vacia' || !p.eventos.length) continue;
      const largo = p.compases * PULSOS_POR_COMPAS;
      for (const ev of p.eventos) {
        // Repeticiones k del evento que caen en [b0, b1)
        let k = Math.ceil((b0 - p.inicio - ev.pos) / largo);
        for (let be = p.inicio + k * largo + ev.pos; be < b1; k++, be = p.inicio + k * largo + ev.pos) {
          if (be >= b0 && this._estadoEn(p, be) === 'sonando') this.sonar(ev, this.tiempoDePulso(be));
        }
      }
    }
  }
}

function nuevaPista(i) {
  return { i, estado: 'vacia', inicio: 0, compases: 1, eventos: [], cambio: null };
}
