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
// - La velocidad es la mayor entre la del tramo que cruza y la media de los
//   últimos cuadros: un golpe corto que frena justo al cruzar también cuenta.
// - Rearme: para volver a sonar en la MISMA línea basta con que la yema haya
//   subido un poco por encima de ella (histéresis). Para sonar en una línea
//   MÁS BAJA (de un pad a una tecla) hace falta haber subido el dedo: así una
//   sola bajada no suena dos veces.
// - Predicción opcional: con la velocidad de los últimos cuadros se calcula
//   cuándo cruzará la línea; si es antes del horizonte, se dispara ya. Si en
//   el cuadro siguiente el dedo frena o sube sin cruzar, se cancela.
// - Los cruces que no suenan se cuentan por motivo, para poder ajustar.

const HISTERESIS = 0.015; // fracción de la altura de pantalla
const VEL_SUBIDA = -0.3; // alturas/s: «ha subido el dedo»
const HUECO_MAX_MS = 120; // más que esto entre cuadros: la mano se perdió

export class DetectorGolpes {
  constructor() {
    this.velocidadMinima = 0.3; // alturas de pantalla por segundo
    this.prediccion = false;
    this.horizonteMs = 33;
    this.dedos = new Map();
    this.rechazos = { lento: 0, sinRearmar: 0, fuera: 0 };
    this.trasPerdida = 0; // golpes que sonaron justo después de perder la mano
  }

  reiniciarRecuentos() {
    this.rechazos = { lento: 0, sinRearmar: 0, fuera: 0 };
    this.trasPerdida = 0;
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
      d = { historial: [], ultimaLinea: null, yMin: Infinity, subio: true, pendiente: null };
      this.dedos.set(clave, d);
    }
    d.visto = t;
    let anterior = d.historial.at(-1) ?? null;
    const hueco = anterior && t - anterior.t > HUECO_MAX_MS;
    if (hueco) d.historial = []; // la velocidad de antes ya no sirve
    d.historial.push({ t, x, y });
    if (d.historial.length > 4) d.historial.shift();
    const { vx, vy } = velocidades(d.historial); // por ms
    d.vy = vy;

    // ¿Se cumplió o falló la predicción anterior?
    if (d.pendiente) {
      const L = d.pendiente.linea.y;
      if (y >= L) {
        this._marcarGolpe(d, L);
        d.pendiente = null;
        return { tipo: 'confirmada' };
      }
      if (vy <= 0 || t - d.pendiente.tCruce > 80) {
        d.pendiente = null;
        return { tipo: 'cancelar' };
      }
      return null;
    }

    // Seguimiento para el rearme
    if (vy * 1000 < VEL_SUBIDA) d.subio = true;
    if (!anterior) {
      d.yMin = Math.min(d.yMin, y);
      return null;
    }
    const yMinAntes = Math.min(d.yMin, anterior.y);
    d.yMin = Math.min(yMinAntes, y);

    // Velocidad: la del tramo que cruza o la media, la mayor.
    const dt = t - anterior.t;
    const vTramo = dt > 0 ? ((y - anterior.y) / dt) * 1000 : 0;
    const vMedia = hueco ? vTramo : vy * 1000;
    const velocidad = Math.max(vTramo, vMedia);

    for (const linea of lineas) {
      if (!(anterior.y < linea.y && y >= linea.y)) continue; // no cruza hacia abajo
      const f = (linea.y - anterior.y) / (y - anterior.y);
      const xc = anterior.x + f * (x - anterior.x);
      if (xc < linea.x0 || xc > linea.x1) {
        this.rechazos.fuera++;
        continue;
      }
      if (!this._armadoPara(d, linea.y, yMinAntes)) {
        this.rechazos.sinRearmar++;
        return null;
      }
      if (velocidad < this.velocidadMinima) {
        this.rechazos.lento++;
        return null;
      }
      this._marcarGolpe(d, linea.y);
      if (hueco) this.trasPerdida++;
      return {
        tipo: 'golpe',
        linea,
        x: xc,
        // Tras perder la mano no sabemos cuándo cruzó: usamos este cuadro.
        tCruce: hueco ? t : anterior.t + f * dt,
        velocidad,
      };
    }

    if (this.prediccion && vy > 0 && vy * 1000 >= this.velocidadMinima) {
      for (const linea of lineas) {
        if (y >= linea.y) continue;
        const falta = (linea.y - y) / vy;
        if (falta > this.horizonteMs) break; // las siguientes líneas están más abajo
        const xp = x + vx * falta;
        if (xp < linea.x0 || xp > linea.x1 || !this._armadoPara(d, linea.y, d.yMin)) continue;
        d.pendiente = { linea, tCruce: t + falta };
        return { tipo: 'prediccion', linea, x: xp, tCruce: t + falta, velocidad: vy * 1000 };
      }
    }
    return null;
  }

  /** ¿Puede este dedo sonar al cruzar la línea en y = L? */
  _armadoPara(d, L, yMin) {
    if (d.ultimaLinea == null) return true;
    // Misma línea o una más alta: basta con haber estado por encima.
    if (L <= d.ultimaLinea + 1e-6) return yMin < L - HISTERESIS;
    // Una línea más baja: hay que haber subido el dedo desde el último golpe.
    return d.subio;
  }

  _marcarGolpe(d, L) {
    d.ultimaLinea = L;
    d.subio = false;
    d.yMin = Infinity;
  }

  /** ¿Está el dedo desarmado (recién golpeado)? Para dibujarlo. */
  desarmado(clave) {
    const d = this.dedos.get(clave);
    return Boolean(d && d.ultimaLinea != null && !d.subio && d.yMin >= d.ultimaLinea - HISTERESIS);
  }

  /** Olvida los dedos que no se han visto desde hace un rato. */
  limpiar(tAhora) {
    for (const [clave, d] of this.dedos) {
      if (tAhora - d.visto > 1000) this.dedos.delete(clave);
    }
  }
}

/** Velocidad (por ms) en x e y por mínimos cuadrados sobre los últimos 3 puntos. */
function velocidades(historial) {
  const h = historial.slice(-3);
  if (h.length < 2) return { vx: 0, vy: 0 };
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
