// Detección de la pinza pulgar-índice con histéresis y predicción opcional.
//
// Histéresis: la pinza se "cierra" al bajar de `umbralCierre` y sólo se puede
// volver a disparar cuando la apertura supera `umbralApertura`. Así el ruido
// del detector no produce disparos dobles.
//
// Predicción: con la velocidad de cierre de los últimos cuadros se estima en
// qué instante se cruzará el umbral. Si ocurrirá antes de `horizonteMs`, se
// dispara ya (ganando hasta un cuadro). Si en el cuadro siguiente los dedos
// se separan en vez de cerrarse, se intenta cancelar la nota.

export class DetectorPinza {
  constructor() {
    this.umbralCierre = 0.3;
    this.umbralApertura = 0.45;
    this.prediccion = false;
    this.horizonteMs = 33;
    this.manos = new Map();
  }

  /**
   * Procesa un cuadro para una mano.
   * clave: identificador estable de la mano; apertura: valor normalizado;
   * tCuadro: instante del cuadro en ms (reloj de performance.now).
   * Devuelve { cerrada, evento } donde evento es null o
   * { tipo: 'pinza' | 'prediccion' | 'confirmada' | 'cancelar', tPrevisto? }.
   */
  procesar(clave, apertura, tCuadro) {
    let e = this.manos.get(clave);
    if (!e) {
      e = { cerrada: false, historial: [], pendiente: null };
      this.manos.set(clave, e);
    }
    e.visto = tCuadro;
    e.historial.push({ t: tCuadro, d: apertura });
    if (e.historial.length > 4) e.historial.shift();

    let evento = null;
    if (!e.cerrada) {
      if (apertura < this.umbralCierre) {
        e.cerrada = true;
        evento = e.pendiente ? { tipo: 'confirmada' } : { tipo: 'pinza' };
        e.pendiente = null;
      } else if (e.pendiente) {
        // Hubo predicción pero no se cerró: si los dedos ya no se acercan
        // o ha pasado demasiado tiempo, fue una falsa alarma.
        const anterior = e.historial[e.historial.length - 2];
        if (apertura >= anterior.d || tCuadro - e.pendiente.tPrevisto > 80) {
          evento = { tipo: 'cancelar' };
          e.pendiente = null;
        }
      } else if (this.prediccion && e.historial.length >= 3) {
        const v = velocidad(e.historial); // unidades de apertura por ms
        // Exigimos un cierre decidido para no disparar con movimientos lentos.
        if (v < -0.002) {
          const tPrevisto = tCuadro + (apertura - this.umbralCierre) / -v;
          if (tPrevisto - tCuadro <= this.horizonteMs) {
            e.pendiente = { tPrevisto };
            evento = { tipo: 'prediccion', tPrevisto };
          }
        }
      }
    } else if (apertura > this.umbralApertura) {
      e.cerrada = false;
    }
    return { cerrada: e.cerrada, evento };
  }

  /** Olvida las manos que no se han visto desde hace un rato. */
  limpiar(tAhora) {
    for (const [clave, e] of this.manos) {
      if (tAhora - e.visto > 500) this.manos.delete(clave);
    }
  }
}

/** Pendiente por mínimos cuadrados de d(t) en el historial. */
function velocidad(historial) {
  const n = historial.length;
  const mt = historial.reduce((a, p) => a + p.t, 0) / n;
  const md = historial.reduce((a, p) => a + p.d, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of historial) {
    num += (p.t - mt) * (p.d - md);
    den += (p.t - mt) ** 2;
  }
  return den > 0 ? num / den : 0;
}
