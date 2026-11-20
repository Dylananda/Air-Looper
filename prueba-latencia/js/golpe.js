// Detección de golpes: la yema de un dedo atraviesa hacia abajo una línea
// horizontal (el borde inferior de una tecla o de un pad) con suficiente
// velocidad. Funciona como una baqueta: un golpe por cada bajada.
//
// Coordenadas: normalizadas (0–1) y ya en espejo, como se ven en pantalla;
// y crece hacia abajo. Tiempos en ms de performance.now().
//
// - El instante del golpe se interpola entre los dos cuadros en que la yema
//   está por encima y por debajo de la línea, así no depende de cuándo cayó
//   el cuadro (menos jitter).
// - Tras un golpe el dedo queda «desarmado» hasta que vuelve a subir: si
//   sigue bajando y cruza otra línea (de un pad a una tecla) no suena dos veces.
// - Predicción opcional: con la velocidad de los últimos cuadros se calcula
//   cuándo cruzará la línea; si es antes del horizonte, se dispara ya. Si en
//   el cuadro siguiente el dedo frena o sube sin cruzar, se cancela.

export class DetectorGolpes {
  constructor() {
    this.velocidadMinima = 0.6; // alturas de pantalla por segundo
    this.prediccion = false;
    this.horizonteMs = 33;
    this.dedos = new Map();
  }

  /**
   * Procesa un cuadro para un dedo.
   * lineas: [{ id, y, x0, x1 }] ordenadas de arriba abajo.
   * Devuelve un evento o null:
   *   { tipo: 'golpe' | 'prediccion', linea, x, tCruce, velocidad }
   *   { tipo: 'confirmada' } | { tipo: 'cancelar' }
   */
  procesar(clave, x, y, t, lineas) {
    let d = this.dedos.get(clave);
    if (!d) {
      d = { historial: [], armado: true, lineaDisparo: null, pendiente: null };
      this.dedos.set(clave, d);
    }
    d.visto = t;
    d.historial.push({ t, x, y });
    if (d.historial.length > 4) d.historial.shift();
    const anterior = d.historial.length > 1 ? d.historial[d.historial.length - 2] : null;
    const { vx, vy } = velocidades(d.historial); // por ms
    d.vy = vy;

    // ¿Se cumplió o falló la predicción anterior?
    if (d.pendiente) {
      const L = d.pendiente.linea.y;
      if (y >= L) {
        d.pendiente = null;
        d.armado = false;
        d.lineaDisparo = L;
        return { tipo: 'confirmada' };
      }
      if (vy <= 0 || t - d.pendiente.tCruce > 80) {
        d.pendiente = null;
        return { tipo: 'cancelar' };
      }
      return null;
    }

    // Rearme: el dedo vuelve a subir o queda por encima de la línea del golpe.
    if (!d.armado && (vy * 1000 < -0.3 || (d.lineaDisparo != null && y < d.lineaDisparo - 0.03))) {
      d.armado = true;
    }
    if (!d.armado || !anterior) return null;

    const vyPorSegundo = vy * 1000;
    if (vyPorSegundo < this.velocidadMinima) return null;

    for (const linea of lineas) {
      // Cruce real entre el cuadro anterior y este.
      if (anterior.y < linea.y && y >= linea.y) {
        const f = (linea.y - anterior.y) / (y - anterior.y);
        const xc = anterior.x + f * (x - anterior.x);
        if (xc < linea.x0 || xc > linea.x1) continue;
        d.armado = false;
        d.lineaDisparo = linea.y;
        return {
          tipo: 'golpe',
          linea,
          x: xc,
          tCruce: anterior.t + f * (t - anterior.t),
          velocidad: vyPorSegundo,
        };
      }
    }

    if (this.prediccion && vy > 0) {
      for (const linea of lineas) {
        if (y >= linea.y) continue;
        const dt = (linea.y - y) / vy;
        if (dt > this.horizonteMs) break; // las siguientes líneas están más abajo
        const xp = x + vx * dt;
        if (xp < linea.x0 || xp > linea.x1) continue;
        d.pendiente = { linea, tCruce: t + dt };
        return { tipo: 'prediccion', linea, x: xp, tCruce: t + dt, velocidad: vyPorSegundo };
      }
    }
    return null;
  }

  /** Olvida los dedos que no se han visto desde hace un rato. */
  limpiar(tAhora) {
    for (const [clave, d] of this.dedos) {
      if (tAhora - d.visto > 300) this.dedos.delete(clave);
    }
  }
}

/** Velocidad (por ms) en x e y por mínimos cuadrados sobre el historial. */
function velocidades(historial) {
  const n = historial.length;
  if (n < 2) return { vx: 0, vy: 0 };
  // Con pocos puntos pesa más el último tramo: usamos como mucho 3.
  const h = historial.slice(-3);
  const mt = h.reduce((a, p) => a + p.t, 0) / h.length;
  const mx = h.reduce((a, p) => a + p.x, 0) / h.length;
  const my = h.reduce((a, p) => a + p.y, 0) / h.length;
  let den = 0;
  let nx = 0;
  let ny = 0;
  for (const p of h) {
    den += (p.t - mt) ** 2;
    nx += (p.t - mt) * (p.x - mx);
    ny += (p.t - mt) * (p.y - my);
  }
  return den > 0 ? { vx: nx / den, vy: ny / den } : { vx: 0, vy: 0 };
}
