// Prueba de latencia: une cámara, detector de manos, pinza, audio, métricas
// y calibración.

import { MotorAudio, midiAHz } from './audio.js';
import { Secuenciador } from './secuenciador.js';
import { crearDetector, abrirCamara, aperturaPinza, PUNTO } from './seguimiento.js';
import { DetectorPinza } from './pinza.js';
import { Calibracion } from './calibracion.js';
import { Ventana } from './estadisticas.js';

const $ = (id) => document.getElementById(id);

// Pentatónica menor de La en dos octavas (MIDI): suena bien sobre cualquier cosa.
const ESCALA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];
const CLAVE_COMPENSACION = 'airlooper.compensacionMs';

const motor = new MotorAudio();
const sec = new Secuenciador(motor);
const pinza = new DetectorPinza();
const calibracion = new Calibracion(sec);

const video = $('video');
const capa = $('capa');
const ctxCapa = capa.getContext('2d');

let detector = null;
let delegado = '';
let ajustesCamara = {};
let funcionando = false;
let ultimoResultadoCal = null;
let compensacionMs = leerCompensacion();

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

const medidas = {
  intervalo: new Ventana(120), // ms entre cuadros de cámara
  deteccion: new Ventana(120), // ms que tarda detectForVideo
  edad: new Ventana(120), // ms desde la captura hasta tener el resultado
  salida: new Ventana(120), // ms desde programar un sonido hasta oírlo
  total: new Ventana(120), // ms totales estimados por cuadro
  pinzaLat: new Ventana(50), // ms captura → altavoz de cada pinza
  rejilla: new Ventana(50), // ms nota vs. corchea más cercana
  grabado: new Ventana(50), // ms nota compensada vs. corchea
  historialTotal: [],
  historialDeteccion: [],
  marcasProcesado: [], // instantes de los últimos cuadros procesados
  pinzas: 0,
  predicciones: 0,
  canceladas: 0,
  falsas: 0,
  tarde: 0,
  conLatFija: 0,
  eventos: [], // para el CSV
};
let ultimoCuadro = null; // { t, presentados }
let hayCaptureTime = false;
const cancelaciones = new Map(); // mano → función para cancelar la nota prevista

function reiniciarMedidas() {
  for (const v of Object.values(medidas)) if (v instanceof Ventana) v.vaciar();
  medidas.historialTotal = [];
  medidas.historialDeteccion = [];
  medidas.pinzas = medidas.predicciones = medidas.canceladas = medidas.falsas = 0;
  medidas.tarde = medidas.conLatFija = 0;
  medidas.eventos = [];
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

$('btnIniciar').addEventListener('click', async () => {
  $('btnIniciar').disabled = true;
  try {
    if (!window.isSecureContext) {
      throw new Error('La cámara sólo funciona en https o en localhost. Abre la página desde http://localhost.');
    }
    estado('Iniciando audio…');
    await motor.iniciar();
    estado('Abriendo la cámara…');
    await abrirCamaraSegunControles();
    estado('Cargando el modelo de manos (la primera vez tarda unos segundos)…');
    await cargarDetector();
    funcionando = true;
    for (const id of ['btnRitmo', 'btnCamara', 'btnReiniciar', 'btnCsv', 'btnCalibrar']) $(id).disabled = false;
    $('btnIniciar').textContent = 'En marcha';
    estado(`Listo · detector en ${delegado}. Junta pulgar e índice para tocar.`);
    bucleCuadros();
    requestAnimationFrame(bucleVisual);
    setInterval(pintarMedidas, 250);
  } catch (err) {
    console.error(err);
    estado(`Error: ${err.message || err}`, true);
    $('btnIniciar').disabled = false;
  }
});

async function abrirCamaraSegunControles() {
  const [ancho, alto] = $('resolucion').value.split('x').map(Number);
  const r = await abrirCamara(video, { ancho, alto, fps: Number($('fpsPedidos').value) });
  ajustesCamara = r.ajustes;
  capa.width = video.videoWidth;
  capa.height = video.videoHeight;
  ultimoCuadro = null;
}

async function cargarDetector() {
  if (detector) detector.close();
  const r = await crearDetector($('delegado').value);
  detector = r.detector;
  delegado = r.delegado;
}

$('btnCamara').addEventListener('click', async () => {
  $('btnCamara').disabled = true;
  try {
    estado('Reconfigurando la cámara…');
    await abrirCamaraSegunControles();
    if ($('delegado').value !== delegado) await cargarDetector();
    reiniciarMedidas();
    estado(`Listo · detector en ${delegado}.`);
  } catch (err) {
    estado(`Error: ${err.message || err}`, true);
  } finally {
    $('btnCamara').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Bucle por cuadro de cámara
// ---------------------------------------------------------------------------

function bucleCuadros() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const siguiente = (ahora, meta) => {
      procesarCuadro(ahora, meta);
      video.requestVideoFrameCallback(siguiente);
    };
    video.requestVideoFrameCallback(siguiente);
  } else {
    // Navegadores sin requestVideoFrameCallback: sondeamos con rAF.
    let ultimoTiempo = -1;
    const sondeo = (ahora) => {
      if (video.currentTime !== ultimoTiempo) {
        ultimoTiempo = video.currentTime;
        procesarCuadro(ahora, {});
      }
      requestAnimationFrame(sondeo);
    };
    requestAnimationFrame(sondeo);
  }
}

function procesarCuadro(ahora, meta) {
  if (!detector || video.readyState < 2) return;

  const tInicio = performance.now();
  let resultado;
  try {
    resultado = detector.detectForVideo(video, tInicio);
  } catch (err) {
    console.warn(err);
    return;
  }
  const tFin = performance.now();

  // Instante de captura del cuadro (Chrome lo da para cámaras locales).
  const captura = meta.captureTime > 0 ? meta.captureTime : null;
  hayCaptureTime = captura != null;
  const tCuadro = captura ?? ahora;
  const presentados = meta.presentedFrames ?? 0;

  if (ultimoCuadro) {
    const saltados = Math.max(1, presentados - ultimoCuadro.presentados);
    medidas.intervalo.agregar((tCuadro - ultimoCuadro.t) / (presentados ? saltados : 1));
  }
  ultimoCuadro = { t: tCuadro, presentados };
  medidas.marcasProcesado.push(tFin);
  while (medidas.marcasProcesado[0] < tFin - 1000) medidas.marcasProcesado.shift();

  const intervalo = medidas.intervalo.resumen().media || 33;
  const salidaMs = motor.retardoSalidaMs();
  const deteccionMs = tFin - tInicio;
  // Sin captureTime suponemos un cuadro entero de retraso de la cámara.
  const edadMs = captura != null ? tFin - captura : tFin - ahora + intervalo;
  // + medio cuadro: de media la pinza ocurre a mitad del intervalo anterior.
  const totalMs = edadMs + salidaMs + intervalo / 2;

  medidas.deteccion.agregar(deteccionMs);
  medidas.edad.agregar(edadMs);
  medidas.salida.agregar(salidaMs);
  medidas.total.agregar(totalMs);
  medidas.historialTotal.push(totalMs);
  medidas.historialDeteccion.push(deteccionMs);
  if (medidas.historialTotal.length > 300) {
    medidas.historialTotal.shift();
    medidas.historialDeteccion.shift();
  }

  analizarManos(resultado, tCuadro, captura, intervalo);
  dibujarManos(resultado);
}

function analizarManos(resultado, tCuadro, captura, intervalo) {
  const manos = resultado.landmarks || [];
  const lateralidad = resultado.handedness || resultado.handednesses || [];
  const vistas = new Set();

  manos.forEach((puntos, i) => {
    let clave = lateralidad[i]?.[0]?.categoryName || `mano${i}`;
    if (vistas.has(clave)) clave += i; // dos manos con la misma etiqueta
    vistas.add(clave);

    const apertura = aperturaPinza(puntos, video.videoWidth, video.videoHeight);
    const { evento } = pinza.procesar(clave, apertura, tCuadro);
    if (!evento) return;

    if (evento.tipo === 'pinza') {
      disparar(clave, puntos, captura ?? tCuadro, captura != null, intervalo, false);
    } else if (evento.tipo === 'prediccion') {
      medidas.predicciones++;
      disparar(clave, puntos, evento.tPrevisto, captura != null, intervalo, true);
    } else if (evento.tipo === 'confirmada') {
      cancelaciones.delete(clave);
    } else if (evento.tipo === 'cancelar') {
      const cancelar = cancelaciones.get(clave);
      cancelaciones.delete(clave);
      if (cancelar && cancelar()) medidas.canceladas++;
      else medidas.falsas++; // ya había empezado a sonar
    }
  });
  pinza.limpiar(tCuadro);
}

/**
 * Hace sonar una nota y registra sus tiempos.
 * tBase: instante físico de referencia (captura del cuadro o cruce previsto),
 * en ms de performance.now().
 */
function disparar(clave, puntos, tBase, baseFiable, intervalo, esPrediccion) {
  const ctx = motor.ctx;
  const tCamara = motor.audibleDesdePerf(tBase); // reloj de audio
  let tNota = ctx.currentTime;

  // Latencia fija: programamos la nota exactamente X ms después de la captura.
  // Elimina la variación de la detección y del búfer de audio a cambio de
  // fijar el retraso al peor caso.
  if ($('latFija').checked && baseFiable) {
    medidas.conLatFija++;
    const objetivo = tCamara + Number($('latFijaMs').value) / 1000;
    if (objetivo >= tNota) tNota = objetivo;
    else medidas.tarde++;
  }

  // Voz y nota
  const medio = {
    x: (puntos[PUNTO.PULGAR].x + puntos[PUNTO.INDICE].x) / 2,
    y: (puntos[PUNTO.PULGAR].y + puntos[PUNTO.INDICE].y) / 2,
  };
  let voz = document.querySelector('input[name="sonido"]:checked').value;
  // La imagen se ve en espejo: x > 0.5 en la cámara es la izquierda en pantalla.
  if (voz === 'lado') voz = medio.x > 0.5 ? 'percusivo' : 'suave';
  const indice = $('notaAltura').checked
    ? Math.min(ESCALA.length - 1, Math.max(0, Math.floor((1 - medio.y) * ESCALA.length)))
    : 5;
  const frecuencia = midiAHz(ESCALA[indice]);

  const calibrando = calibracion.activa;
  if (!calibrando || $('calOir').checked) {
    const cancelar = voz === 'suave' ? motor.notaSuave(tNota, frecuencia) : motor.notaPercusiva(tNota, frecuencia);
    if (esPrediccion) cancelaciones.set(clave, cancelar);
  }

  medidas.pinzas++;
  const latenciaMs = (tNota - tCamara) * 1000;
  if (baseFiable) medidas.pinzaLat.agregar(latenciaMs);

  const evento = {
    instante_ms: performance.now().toFixed(1),
    mano: clave,
    voz,
    prediccion: esPrediccion ? 1 : 0,
    captura_altavoz_ms: baseFiable ? latenciaMs.toFixed(1) : '',
    deteccion_ms: medidas.deteccion.valores.at(-1)?.toFixed(1) ?? '',
    intervalo_ms: intervalo.toFixed(1),
    vs_corchea_ms: '',
    compensado_ms: '',
    calibracion_ms: '',
  };

  if (calibrando) {
    const golpe = calibracion.registrar(tNota, baseFiable ? tCamara : null);
    if (golpe) evento.calibracion_ms = golpe.desfaseMs.toFixed(1);
  } else if (sec.sonando) {
    const oido = sec.rejillaMasCercana(tNota, 2).error * 1000;
    const grabado = sec.rejillaMasCercana(tNota - compensacionMs / 1000, 2).error * 1000;
    medidas.rejilla.agregar(oido);
    medidas.grabado.agregar(grabado);
    evento.vs_corchea_ms = oido.toFixed(1);
    evento.compensado_ms = grabado.toFixed(1);
  }
  medidas.eventos.push(evento);
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function dibujarManos(resultado) {
  const w = capa.width;
  const h = capa.height;
  ctxCapa.clearRect(0, 0, w, h);
  const manos = resultado.landmarks || [];
  const lateralidad = resultado.handedness || resultado.handednesses || [];
  manos.forEach((puntos, i) => {
    ctxCapa.fillStyle = '#ffffffaa';
    for (const p of puntos) {
      ctxCapa.beginPath();
      ctxCapa.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctxCapa.fill();
    }
    const clave = lateralidad[i]?.[0]?.categoryName || `mano${i}`;
    const cerrada = pinza.manos.get(clave)?.cerrada;
    const a = puntos[PUNTO.PULGAR];
    const b = puntos[PUNTO.INDICE];
    ctxCapa.strokeStyle = cerrada ? '#f5b700' : '#2bb8a2';
    ctxCapa.lineWidth = 4;
    ctxCapa.beginPath();
    ctxCapa.moveTo(a.x * w, a.y * h);
    ctxCapa.lineTo(b.x * w, b.y * h);
    ctxCapa.stroke();
    ctxCapa.fillStyle = cerrada ? '#f5b700' : '#2bb8a2';
    ctxCapa.beginPath();
    ctxCapa.arc(((a.x + b.x) / 2) * w, ((a.y + b.y) / 2) * h, cerrada ? 14 : 7, 0, Math.PI * 2);
    ctxCapa.fill();
  });
}

/** Bucle visual: indicador de pulso y progreso de la calibración. */
function bucleVisual() {
  const indicador = $('pulso');
  if (sec.sonando) {
    const tAudible = motor.audibleDesdePerf(performance.now());
    const fase = (tAudible - sec.t0) / sec.segPulso;
    const pulso = Math.floor(fase);
    const encendido = fase >= 0 && fase - pulso < 0.15;
    indicador.classList.toggle('activo', encendido && pulso % 4 !== 0);
    indicador.classList.toggle('acento', encendido && pulso % 4 === 0);
    if (calibracion.activa) mostrarProgresoCalibracion(tAudible);
  } else {
    indicador.classList.remove('activo', 'acento');
  }
  requestAnimationFrame(bucleVisual);
}

const fmt = (x, dec = 1) => (Number.isFinite(x) ? x.toFixed(dec) : '—');
const masMenos = (r, unidad = 'ms') => (r.n ? `${fmt(r.media)} ± ${fmt(r.desv)} ${unidad}` : '—');

function pintarMedidas() {
  if (!funcionando) return;
  const intervalo = medidas.intervalo.resumen();
  const fpsReales = intervalo.n ? 1000 / intervalo.media : NaN;
  const ancho = video.videoWidth;
  const alto = video.videoHeight;
  $('mCamara').textContent =
    `${fmt(fpsReales)} fps reales (pedidos ${$('fpsPedidos').value}, declarados ${fmt(ajustesCamara.frameRate, 0)}) · ${ancho}×${alto}`;
  $('mIntervalo').textContent = `${masMenos(intervalo)}${hayCaptureTime ? '' : ' (sin captureTime)'}`;
  $('mProcesados').textContent = `${medidas.marcasProcesado.length} por segundo`;
  const det = medidas.deteccion.resumen();
  $('mDeteccion').textContent = det.n ? `${masMenos(det)} · p95 ${fmt(det.p95)} · ${delegado}` : '—';
  $('mEdad').textContent = `${masMenos(medidas.edad.resumen())}${hayCaptureTime ? '' : ' (supuesto)'}`;
  const decl = motor.latenciasDeclaradas();
  $('mSalida').textContent =
    `${masMenos(medidas.salida.resumen())} (declarada: base ${fmt(decl.base)}, salida ${decl.salida == null ? '—' : fmt(decl.salida)})`;
  const total = medidas.total.resumen();
  $('mTotal').textContent = total.n ? `${fmt(total.media, 0)} ms · jitter ${fmt(total.desv)} ms · p95 ${fmt(total.p95, 0)}` : '—';

  $('mPinzas').textContent = String(medidas.pinzas);
  const pl = medidas.pinzaLat.resumen();
  $('mPinzaLat').textContent = pl.n ? `${masMenos(pl)} (+ medio cuadro ≈ ${fmt(pl.media + (intervalo.media || 0) / 2, 0)})` : '—';
  $('mRejilla').textContent = medidas.rejilla.n ? masMenos(medidas.rejilla.resumen()) : sec.sonando ? '—' : 'enciende la batería';
  $('mGrabado').textContent = medidas.grabado.n ? `${masMenos(medidas.grabado.resumen())} (comp. ${fmt(compensacionMs, 0)})` : '—';
  $('mPrediccion').textContent = pinza.prediccion || medidas.predicciones
    ? `${medidas.predicciones} disparos · ${medidas.canceladas} cancelados · ${medidas.falsas} falsos audibles`
    : 'desactivada';
  $('mTarde').textContent = medidas.conLatFija
    ? `${medidas.tarde} de ${medidas.conLatFija} llegaron tarde (${fmt((100 * medidas.tarde) / medidas.conLatFija, 0)} %)`
    : $('latFija').checked && !hayCaptureTime ? 'no disponible sin captureTime' : 'desactivada';

  dibujarGrafica();
}

function colorCss(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function dibujarGrafica() {
  const lienzo = $('grafica');
  const g = lienzo.getContext('2d');
  const w = lienzo.width;
  const h = lienzo.height;
  g.clearRect(0, 0, w, h);
  const totales = medidas.historialTotal;
  if (totales.length < 2) return;
  const maximo = Math.max(150, ...totales) * 1.1;
  const y = (v) => h - (v / maximo) * h;
  const x = (i) => (i / 299) * w;

  // Rejilla cada 50 ms
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
  serie(medidas.historialDeteccion, colorCss('--serie2'));
  serie(totales, colorCss('--serie1'));

  const media = medidas.total.resumen().media;
  g.setLineDash([5, 4]);
  g.strokeStyle = colorCss('--serie1');
  g.beginPath();
  g.moveTo(0, y(media));
  g.lineTo(w, y(media));
  g.stroke();
  g.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

$('btnRitmo').addEventListener('click', () => {
  if (calibracion.activa) return;
  if (sec.sonando) {
    sec.parar();
  } else {
    sec.bpm = Number($('bpm').value) || 100;
    sec.iniciar('bateria');
    medidas.rejilla.vaciar();
    medidas.grabado.vaciar();
  }
  actualizarBotonRitmo();
});

$('bpm').addEventListener('change', () => {
  if (sec.sonando && !calibracion.activa) {
    sec.bpm = Number($('bpm').value) || 100;
    sec.iniciar('bateria');
    medidas.rejilla.vaciar();
    medidas.grabado.vaciar();
  }
});

function actualizarBotonRitmo() {
  $('btnRitmo').textContent = sec.sonando && sec.modo === 'bateria' ? '■ Parar' : '▶ Batería';
}

$('volBateria').addEventListener('input', (e) => {
  if (motor.busBateria) motor.busBateria.gain.value = Number(e.target.value);
});

$('umbral').addEventListener('input', (e) => {
  pinza.umbralCierre = Number(e.target.value);
  pinza.umbralApertura = pinza.umbralCierre + 0.15;
  $('umbralTxt').textContent = pinza.umbralCierre.toFixed(2);
});

$('prediccion').addEventListener('change', (e) => {
  pinza.prediccion = e.target.checked;
});

$('horizonte').addEventListener('input', (e) => {
  pinza.horizonteMs = Number(e.target.value);
  $('horizonteTxt').textContent = `${e.target.value} ms`;
});

$('latFijaMs').addEventListener('input', (e) => {
  $('latFijaTxt').textContent = `${e.target.value} ms`;
});

$('btnReiniciar').addEventListener('click', reiniciarMedidas);

$('btnCsv').addEventListener('click', () => {
  if (!medidas.eventos.length) return;
  const columnas = Object.keys(medidas.eventos[0]);
  const lineas = [columnas.join(';'), ...medidas.eventos.map((e) => columnas.map((c) => e[c]).join(';'))];
  const blob = new Blob([lineas.join('\n')], { type: 'text/csv' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `pinzas-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
});

// ---------------------------------------------------------------------------
// Calibración
// ---------------------------------------------------------------------------

$('btnCalibrar').addEventListener('click', () => {
  if (calibracion.activa) {
    terminarCalibracion();
    return;
  }
  calibracion.empezar({
    bpm: Number($('calBpm').value) || 90,
    compases: Math.max(2, Number($('calCompases').value) || 4),
  });
  $('btnCalibrar').textContent = 'Cancelar';
  $('btnRitmo').disabled = true;
  $('calResultado').innerHTML = '';
  $('calGrafica').hidden = true;
  $('btnAplicarComp').disabled = true;
  actualizarBotonRitmo();
});

function mostrarProgresoCalibracion(tAudible) {
  const p = calibracion.progreso(tAudible);
  const aviso = $('aviso');
  if (p.fase === 'cuenta') {
    aviso.hidden = false;
    aviso.textContent = p.pulso < 0 ? 'Prepárate…' : `${p.cuenta}…`;
    $('calProgreso').textContent = 'Escucha la cuenta…';
  } else if (p.fase === 'midiendo') {
    aviso.hidden = false;
    aviso.textContent = `¡Pinza en cada clic! ${p.pulso + 1}/${p.total}`;
    $('calProgreso').textContent = `Midiendo: pulso ${p.pulso + 1} de ${p.total} · ${calibracion.golpes.length} pinzas válidas`;
  } else {
    terminarCalibracion();
  }
}

function terminarCalibracion() {
  const r = calibracion.terminar();
  $('aviso').hidden = true;
  $('btnCalibrar').textContent = 'Empezar calibración';
  $('btnRitmo').disabled = false;
  actualizarBotonRitmo();
  $('calProgreso').textContent = '';
  ultimoResultadoCal = r;

  if (r.resumen.n < 4) {
    $('calResultado').innerHTML = `<p>Sólo ${r.resumen.n} pinzas válidas de ${r.esperados}. Prueba otra vez (¿se ve bien la mano?).</p>`;
    return;
  }
  const s = r.resumen;
  const veredicto =
    s.desv < 15 ? 'muy estable' : s.desv < 25 ? 'estable (tocable)' : s.desv < 40 ? 'irregular' : 'demasiado irregular';
  let html =
    `<p><strong>Retraso medio: ${fmt(s.media, 0)} ms</strong> (mediana ${fmt(s.mediana, 0)})` +
    ` · dispersión ± ${fmt(s.desv)} ms → ${veredicto}</p>` +
    `<p>${s.n} de ${r.esperados} pinzas válidas, ${r.descartados} descartadas · rango ${fmt(s.min, 0)} … ${fmt(s.max, 0)} ms</p>`;
  if (r.camara.n) {
    html +=
      `<p class="ayuda">Desglose aproximado: la cámara captó la pinza ${fmt(r.camara.media, 0)} ± ${fmt(r.camara.desv)} ms ` +
      `después de oírse el clic (tu reacción + retraso interno de la cámara); el resto, ` +
      `${fmt(s.media - r.camara.media, 0)} ms, es detección + programación del sonido.</p>`;
  }
  $('calResultado').innerHTML = html;
  $('btnAplicarComp').disabled = false;
  dibujarCalibracion(r);
}

function dibujarCalibracion(r) {
  const lienzo = $('calGrafica');
  lienzo.hidden = false;
  const g = lienzo.getContext('2d');
  const w = lienzo.width;
  const h = lienzo.height;
  g.clearRect(0, 0, w, h);
  const valores = calibracion.golpes.map((x) => x.desfaseMs);
  const min = Math.min(0, ...valores) - 20;
  const max = Math.max(...valores) + 20;
  const x = (v) => ((v - min) / (max - min)) * w;
  g.fillStyle = colorCss('--suave');
  g.strokeStyle = colorCss('--borde');
  g.font = '11px system-ui';
  for (let v = Math.ceil(min / 50) * 50; v <= max; v += 50) {
    g.beginPath();
    g.moveTo(x(v), 0);
    g.lineTo(x(v), h);
    g.stroke();
    g.fillText(`${v}`, x(v) + 2, h - 4);
  }
  const validos = new Set(r.validos);
  calibracion.golpes.forEach((golpe, i) => {
    g.fillStyle = validos.has(golpe) ? colorCss('--serie1') : colorCss('--aviso');
    g.beginPath();
    g.arc(x(golpe.desfaseMs), 14 + ((i * 11) % (h - 34)), 4, 0, Math.PI * 2);
    g.fill();
  });
  g.strokeStyle = colorCss('--texto');
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x(r.resumen.media), 0);
  g.lineTo(x(r.resumen.media), h);
  g.stroke();
  g.lineWidth = 1;
}

$('btnAplicarComp').addEventListener('click', () => {
  if (!ultimoResultadoCal?.resumen.n) return;
  compensacionMs = Math.round(ultimoResultadoCal.resumen.media);
  guardarCompensacion(compensacionMs);
  medidas.grabado.vaciar();
});

function leerCompensacion() {
  try {
    return Number(localStorage.getItem(CLAVE_COMPENSACION)) || 0;
  } catch {
    return 0;
  }
}

function guardarCompensacion(ms) {
  $('compActual').textContent = `${ms} ms`;
  try {
    localStorage.setItem(CLAVE_COMPENSACION, String(ms));
  } catch {
    /* sin almacenamiento: sólo vale para esta sesión */
  }
}

function estado(texto, error = false) {
  const el = $('estado');
  el.textContent = texto;
  el.classList.toggle('error', error);
}

$('compActual').textContent = `${compensacionMs} ms`;
