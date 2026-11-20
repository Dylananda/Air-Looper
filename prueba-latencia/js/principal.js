// Prueba 1: pinza pulgar-índice. Une cámara, detector, pinza, audio,
// medidas y calibración.

import { MotorAudio, midiAHz } from './audio.js';
import { Secuenciador } from './secuenciador.js';
import { aperturaPinza, PUNTO } from './seguimiento.js';
import { DetectorPinza } from './pinza.js';
import { Calibracion } from './calibracion.js';
import { Medidor } from './medidor.js';
import { montarCalibracion } from './calibracion-ui.js';
import { montarPagina } from './pagina.js';

const $ = (id) => document.getElementById(id);

// Pentatónica menor de La en dos octavas (MIDI): suena bien sobre cualquier cosa.
const ESCALA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];

const motor = new MotorAudio();
const sec = new Secuenciador(motor);
const pinza = new DetectorPinza();
const calibracion = new Calibracion(sec);
const medidor = new Medidor(motor);

const video = $('video');
const capa = $('capa');
const ctxCapa = capa.getContext('2d');
const cancelaciones = new Map(); // mano → función para cancelar la nota prevista

const opcionesMedidas = () => ({
  compensacionMs: cal.compensacionMs,
  prediccionActiva: pinza.prediccion,
  latFijaActiva: $('latFija').checked,
});

const cal = montarCalibracion({
  calibracion,
  gesto: 'pinza',
  alCambiar: (activa) => {
    $('btnRitmo').disabled = activa;
    actualizarBotonRitmo();
  },
});

const pagina = montarPagina({
  titulo: 'Prueba de la pinza',
  motor,
  medidor,
  video,
  capa,
  opcionesMedidas,
  extraResumen: () => cal.textoUltimo,
  habilitar: ['btnRitmo'],
  alCuadro: (resultado, info) => {
    analizarManos(resultado, info);
    dibujarManos(resultado);
  },
  alListo: () => {
    pagina.estado('Listo. Junta pulgar e índice para tocar.');
    requestAnimationFrame(bucleVisual);
  },
});

// ---------------------------------------------------------------------------
// Pinzas
// ---------------------------------------------------------------------------

function claveMano(lateralidad, i) {
  return lateralidad[i]?.[0]?.categoryName || `mano${i}`;
}

function analizarManos(resultado, { captura, tCuadro }) {
  const manos = resultado.landmarks || [];
  const lateralidad = resultado.handedness || resultado.handednesses || [];
  const vistas = new Set();

  manos.forEach((puntos, i) => {
    let clave = claveMano(lateralidad, i);
    if (vistas.has(clave)) clave += i; // dos manos con la misma etiqueta
    vistas.add(clave);

    const apertura = aperturaPinza(puntos, video.videoWidth, video.videoHeight);
    const { evento } = pinza.procesar(clave, apertura, tCuadro);
    if (!evento) return;

    if (evento.tipo === 'pinza') {
      disparar(clave, puntos, tCuadro, captura != null, false);
    } else if (evento.tipo === 'prediccion') {
      disparar(clave, puntos, evento.tPrevisto, captura != null, true);
    } else if (evento.tipo === 'confirmada') {
      cancelaciones.delete(clave);
    } else if (evento.tipo === 'cancelar') {
      const cancelar = cancelaciones.get(clave);
      cancelaciones.delete(clave);
      medidor.cancelacion(Boolean(cancelar && cancelar()));
    }
  });
  pinza.limpiar(tCuadro);
}

/**
 * Hace sonar una nota y registra sus tiempos.
 * tBase: instante físico de referencia (captura del cuadro o cruce previsto),
 * en ms de performance.now(). baseFiable: si viene de captureTime.
 */
function disparar(clave, puntos, tBase, baseFiable, esPrediccion) {
  const tCamara = motor.audibleDesdePerf(tBase); // reloj de audio
  let tNota = motor.ahora;

  // Latencia fija: programamos la nota exactamente X ms después de la captura.
  if ($('latFija').checked && baseFiable) {
    const objetivo = tCamara + Number($('latFijaMs').value) / 1000;
    medidor.latenciaFija(objetivo < tNota);
    if (objetivo >= tNota) tNota = objetivo;
  }

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
  if (!calibrando || cal.oirGesto) {
    const cancelar = voz === 'suave' ? motor.notaSuave(tNota, frecuencia) : motor.notaPercusiva(tNota, frecuencia);
    if (esPrediccion) cancelaciones.set(clave, cancelar);
  }

  const evento = medidor.nota({
    tNota,
    tCamara: baseFiable ? tCamara : null,
    esPrediccion,
    sec,
    compensacionMs: cal.compensacionMs,
    calibrando,
    datos: { mano: clave, voz },
  });
  if (calibrando) {
    const golpe = calibracion.registrar(tNota, baseFiable ? tCamara : null);
    if (golpe) evento.calibracion_ms = golpe.desfaseMs.toFixed(1);
  }
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
    const cerrada = pinza.manos.get(claveMano(lateralidad, i))?.cerrada;
    const a = puntos[PUNTO.PULGAR];
    const b = puntos[PUNTO.INDICE];
    const color = cerrada ? '#f5b700' : '#2bb8a2';
    ctxCapa.strokeStyle = color;
    ctxCapa.lineWidth = 4;
    ctxCapa.beginPath();
    ctxCapa.moveTo(a.x * w, a.y * h);
    ctxCapa.lineTo(b.x * w, b.y * h);
    ctxCapa.stroke();
    ctxCapa.fillStyle = color;
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
    cal.actualizar(tAudible);
  } else {
    indicador.classList.remove('activo', 'acento');
  }
  requestAnimationFrame(bucleVisual);
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

function arrancarBateria() {
  sec.bpm = Number($('bpm').value) || 100;
  sec.iniciar('bateria');
  medidor.rejilla.vaciar();
  medidor.grabado.vaciar();
}

$('btnRitmo').addEventListener('click', () => {
  if (calibracion.activa) return;
  if (sec.sonando) sec.parar();
  else arrancarBateria();
  actualizarBotonRitmo();
});

$('bpm').addEventListener('change', () => {
  if (sec.sonando && !calibracion.activa) arrancarBateria();
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
