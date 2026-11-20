// Utilidades estadísticas sencillas para las métricas de latencia.

/** Resume un array de números: n, media, desviación típica, mediana, p95, mín y máx. */
export function resumir(valores) {
  const v = valores.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { n: 0, media: NaN, desv: NaN, mediana: NaN, p95: NaN, min: NaN, max: NaN };
  const media = v.reduce((a, b) => a + b, 0) / n;
  const varianza = n > 1 ? v.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1) : 0;
  const ord = [...v].sort((a, b) => a - b);
  return {
    n,
    media,
    desv: Math.sqrt(varianza),
    mediana: percentilOrdenado(ord, 50),
    p95: percentilOrdenado(ord, 95),
    min: ord[0],
    max: ord[n - 1],
  };
}

function percentilOrdenado(ord, p) {
  if (ord.length === 1) return ord[0];
  const pos = (p / 100) * (ord.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < ord.length ? ord[i] * (1 - f) + ord[i + 1] * f : ord[i];
}

/** Mediana y desviación absoluta mediana (para descartar valores atípicos). */
export function medianaYMad(valores) {
  const ord = [...valores].sort((a, b) => a - b);
  const mediana = percentilOrdenado(ord, 50);
  const desvios = ord.map((x) => Math.abs(x - mediana)).sort((a, b) => a - b);
  return { mediana, mad: percentilOrdenado(desvios, 50) };
}

/** Ventana deslizante con los últimos N valores. */
export class Ventana {
  constructor(tamano = 120) {
    this.tamano = tamano;
    this.valores = [];
  }
  agregar(x) {
    if (x == null || !Number.isFinite(x)) return;
    this.valores.push(x);
    if (this.valores.length > this.tamano) this.valores.shift();
  }
  vaciar() {
    this.valores = [];
  }
  get n() {
    return this.valores.length;
  }
  resumen() {
    return resumir(this.valores);
  }
}
