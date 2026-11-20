// Medidas de latencia compartidas por las dos pruebas (pinza y teclado):
// tiempos por cuadro de cámara, tiempos de cada nota disparada, panel en
// pantalla, gráfica, resumen para copiar y CSV.

import { Ventana } from './estadisticas.js';

const fmt = (x, dec = 1) => (Number.isFinite(x) ? x.toFixed(dec) : '—');
const masMenos = (r, unidad = 'ms') => (r.n ? `${fmt(r.media)} ± ${fmt(r.desv)} ${unidad}` : '—');

export class Medidor {
  constructor(motor) {
    this.motor = motor;
    this.contexto = { delegado: '', ajustes: {}, fpsPedidos: '', ancho: 0, alto: 0 };
    this.hayCaptureTime = false;
    this.reiniciar();
  }

  reiniciar() {
    this.intervalo = new Ventana(120); // ms entre cuadros de cámara
    this.deteccion = new Ventana(120); // ms que tarda el detector
    this.edad = new Ventana(120); // ms desde la captura hasta tener el resultado
    this.salida = new Ventana(120); // ms desde programar un sonido hasta oírlo
    this.total = new Ventana(120); // ms totales estimados por cuadro
    this.notaLat = new Ventana(50); // ms gesto/captura → altavoz de cada nota
    this.rejilla = new Ventana(50); // ms nota vs. corchea más cercana
    this.grabado = new Ventana(50); // ms nota compensada vs. corchea
    this.historialTotal = [];
    this.historialDeteccion = [];
    this.marcasProcesado = [];
    this.notas = 0;
    this.predicciones = 0;
    this.canceladas = 0;
    this.falsas = 0;
    this.tarde = 0;
    this.conLatFija = 0;
    this.eventos = [];
    this.ultimoCuadro = null;
  }

  /**
   * Registra un cuadro procesado. ahora/meta: argumentos de
   * requestVideoFrameCallback; tInicio/tFin: antes y después del detector.
   * Devuelve { captura, tCuadro, intervalo }.
   */
  cuadro(ahora, meta, tInicio, tFin) {
    // Instante de captura del cuadro (Chrome lo da para cámaras locales).
    const captura = meta.captureTime > 0 ? meta.captureTime : null;
    this.hayCaptureTime = captura != null;
    const tCuadro = captura ?? ahora;
    const presentados = meta.presentedFrames ?? 0;

    if (this.ultimoCuadro) {
      const saltados = Math.max(1, presentados - this.ultimoCuadro.presentados);
      this.intervalo.agregar((tCuadro - this.ultimoCuadro.t) / (presentados ? saltados : 1));
    }
    this.ultimoCuadro = { t: tCuadro, presentados };
    this.marcasProcesado.push(tFin);
    while (this.marcasProcesado[0] < tFin - 1000) this.marcasProcesado.shift();

    const intervalo = this.intervalo.resumen().media || 33;
    const salidaMs = this.motor.retardoSalidaMs();
    const deteccionMs = tFin - tInicio;
    // Sin captureTime suponemos un cuadro entero de retraso de la cámara.
    const edadMs = captura != null ? tFin - captura : tFin - ahora + intervalo;
    // + medio cuadro: de media el gesto ocurre a mitad del intervalo anterior.
    const totalMs = edadMs + salidaMs + intervalo / 2;

    this.deteccion.agregar(deteccionMs);
    this.edad.agregar(edadMs);
    this.salida.agregar(salidaMs);
    this.total.agregar(totalMs);
    this.historialTotal.push(totalMs);
    this.historialDeteccion.push(deteccionMs);
    if (this.historialTotal.length > 300) {
      this.historialTotal.shift();
      this.historialDeteccion.shift();
    }
    return { captura, tCuadro, intervalo };
  }

  /**
   * Registra una nota. tNota: reloj de audio en que sonará; tCamara: instante
   * audible del gesto (captura o cruce estimado) o null; sec: secuenciador;
   * datos: columnas extra para el CSV.
   */
  nota({ tNota, tCamara, esPrediccion, sec, compensacionMs, calibrando, datos = {} }) {
    this.notas++;
    if (esPrediccion) this.predicciones++;
    const latenciaMs = tCamara != null ? (tNota - tCamara) * 1000 : null;
    if (latenciaMs != null) this.notaLat.agregar(latenciaMs);

    const evento = {
      instante_ms: performance.now().toFixed(1),
      ...datos,
      prediccion: esPrediccion ? 1 : 0,
      gesto_altavoz_ms: latenciaMs != null ? latenciaMs.toFixed(1) : '',
      deteccion_ms: this.deteccion.valores.at(-1)?.toFixed(1) ?? '',
      intervalo_ms: (this.intervalo.resumen().media || 0).toFixed(1),
      vs_corchea_ms: '',
      compensado_ms: '',
      calibracion_ms: '',
    };
    if (!calibrando && sec.sonando) {
      const oido = sec.rejillaMasCercana(tNota, 2).error * 1000;
      const grabado = sec.rejillaMasCercana(tNota - compensacionMs / 1000, 2).error * 1000;
      this.rejilla.agregar(oido);
      this.grabado.agregar(grabado);
      evento.vs_corchea_ms = oido.toFixed(1);
      evento.compensado_ms = grabado.toFixed(1);
    }
    this.eventos.push(evento);
    return evento;
  }

  /** Resultado de intentar cancelar una nota prevista que no llegó a ocurrir. */
  cancelacion(conseguida) {
    if (conseguida) this.canceladas++;
    else this.falsas++; // ya había empezado a sonar
  }

  latenciaFija(llegoTarde) {
    this.conLatFija++;
    if (llegoTarde) this.tarde++;
  }

  /** Líneas «etiqueta: valor» con todas las medidas. */
  lineas({ compensacionMs = 0, prediccionActiva = false, latFijaActiva = false } = {}) {
    const c = this.contexto;
    const intervalo = this.intervalo.resumen();
    const fpsReales = intervalo.n ? 1000 / intervalo.media : NaN;
    const det = this.deteccion.resumen();
    const decl = this.motor.latenciasDeclaradas();
    const total = this.total.resumen();
    const nl = this.notaLat.resumen();
    return {
      mCamara:
        `${fmt(fpsReales)} fps reales (pedidos ${c.fpsPedidos}, declarados ${fmt(c.ajustes.frameRate, 0)}) · ${c.ancho}×${c.alto}` +
        (fpsReales < 0.8 * (c.ajustes.frameRate || 0)
          ? ' ⚠ la cámara da menos fps de los que declara: casi siempre es por poca luz (prueba más luz o la exposición manual)'
          : ''),
      mIntervalo: `${masMenos(intervalo)}${this.hayCaptureTime ? '' : ' (sin captureTime)'}`,
      mProcesados: `${this.marcasProcesado.length} por segundo`,
      mDeteccion: det.n ? `${masMenos(det)} · p95 ${fmt(det.p95)} · ${c.delegado}` : '—',
      mEdad: `${masMenos(this.edad.resumen())}${this.hayCaptureTime ? '' : ' (supuesto)'}`,
      mSalida: `${masMenos(this.salida.resumen())} (declarada: base ${fmt(decl.base)}, salida ${decl.salida == null ? '—' : fmt(decl.salida)})`,
      mTotal: total.n ? `${fmt(total.media, 0)} ms · jitter ${fmt(total.desv)} ms · p95 ${fmt(total.p95, 0)}` : '—',
      mNotas: String(this.notas),
      mNotaLat: nl.n ? masMenos(nl) : '—',
      mRejilla: this.rejilla.n ? masMenos(this.rejilla.resumen()) : '—',
      mGrabado: this.grabado.n ? `${masMenos(this.grabado.resumen())} (comp. ${fmt(compensacionMs, 0)})` : '—',
      mPrediccion: prediccionActiva || this.predicciones
        ? `${this.predicciones} disparos · ${this.canceladas} cancelados · ${this.falsas} falsos audibles`
        : 'desactivada',
      mTarde: this.conLatFija
        ? `${this.tarde} de ${this.conLatFija} llegaron tarde (${fmt((100 * this.tarde) / this.conLatFija, 0)} %)`
        : latFijaActiva && !this.hayCaptureTime ? 'no disponible sin captureTime' : 'desactivada',
    };
  }

  /** Escribe las medidas en los elementos con esos id (si existen). */
  pintar(opciones) {
    for (const [id, texto] of Object.entries(this.lineas(opciones))) {
      const el = document.getElementById(id);
      if (el) el.textContent = texto;
    }
  }

  /** Texto plano con todas las medidas visibles, para copiar y pegar. */
  textoResumen(titulo, opciones, extra = '') {
    const filas = [];
    for (const [id] of Object.entries(this.lineas(opciones))) {
      const dd = document.getElementById(id);
      const dt = dd?.previousElementSibling;
      if (dd && dt) filas.push(`${dt.textContent}: ${dd.textContent}`);
    }
    const nav = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(', ') || navigator.userAgent;
    return [`== ${titulo} ==`, ...filas, extra, `Navegador: ${nav}`].filter(Boolean).join('\n');
  }

  csv() {
    if (!this.eventos.length) return null;
    const columnas = Object.keys(this.eventos[0]);
    return [columnas.join(';'), ...this.eventos.map((e) => columnas.map((c) => e[c] ?? '').join(';'))].join('\n');
  }

  dibujarGrafica(lienzo) {
    if (!lienzo) return;
    const g = lienzo.getContext('2d');
    const w = lienzo.width;
    const h = lienzo.height;
    g.clearRect(0, 0, w, h);
    const totales = this.historialTotal;
    if (totales.length < 2) return;
    const maximo = Math.max(150, ...totales) * 1.1;
    const y = (v) => h - (v / maximo) * h;
    const x = (i) => (i / 299) * w;

    g.strokeStyle = colorCss('--borde');
    g.fillStyle = colorCss('--suave');
    g.font = '11px system-ui';
    g.lineWidth = 1;
    for (let v = 50; v < maximo; v += 50) {
      g.beginPath();
      g.moveTo(0, y(v));
      g.lineTo(w, y(v));
      g.stroke();
      g.fillText(`${v} ms`, 4, y(v) - 3);
    }
    const serie = (datos, color) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      datos.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
      g.stroke();
    };
    serie(this.historialDeteccion, colorCss('--serie2'));
    serie(totales, colorCss('--serie1'));
    const media = this.total.resumen().media;
    g.setLineDash([5, 4]);
    g.strokeStyle = colorCss('--serie1');
    g.beginPath();
    g.moveTo(0, y(media));
    g.lineTo(w, y(media));
    g.stroke();
    g.setLineDash([]);
  }
}

export function colorCss(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

/** Descarga un texto como archivo. */
export function descargar(nombre, texto, tipo = 'text/csv') {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
}

/** Copia al portapapeles; si no se puede, muestra el texto para copiarlo a mano. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    window.prompt('Copia este texto (Ctrl+C):', texto);
    return false;
  }
}

export { fmt, masMenos };
