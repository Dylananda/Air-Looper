// Prueba 2: teclado virtual, pads de percusión y botones de loop dibujados
// sobre la imagen de la cámara. Se tocan con «golpes»: la yema del dedo
// atraviesa hacia abajo la línea del borde inferior de un botón. También se
// pueden pulsar con el ratón (útil para probar).

import { MotorAudio, midiAHz } from './audio.js';
import { Secuenciador } from './secuenciador.js';
import { DetectorGolpes } from './golpe.js';
import { Calibracion } from './calibracion.js';
import { Medidor } from './medidor.js';
import { montarCalibracion } from './calibracion-ui.js';
import { montarPagina } from './pagina.js';
import { Looper } from './looper.js';

const $ = (id) => document.getElementById(id);

const ESCALAS = {
  mayor2: [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84], // Do mayor, 2 octavas
  mayor1: [60, 62, 64, 65, 67, 69, 71, 72], // Do mayor, 1 octava
  penta2: [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81], // La menor pentatónica, 2 octavas
};
const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const PADS = [
  { nombre: 'Bombo', sonar: (t, v) => motor.bombo(t, v, motor.busNotas) },
  { nombre: 'Caja', sonar: (t, v) => motor.caja(t, v, motor.busNotas) },
  { nombre: 'Charles', sonar: (t, v) => motor.charles(t, v * 1.6, motor.busNotas) },
  { nombre: 'Palmas', sonar: (t, v) => motor.palmas(t, v, motor.busNotas) },
];
const DEDOS = { indice: [8], 'indice-medio': [8, 12], todos: [8, 12, 16, 20] };

// Geometría (coordenadas normalizadas de pantalla, ya en espejo).
const MARGEN_X = 0.03;
const ALTO_TECLA = 0.2;
const ALTO_PAD = 0.13;
const SEPARACION_PADS = 0.3; // de la línea de las teclas a la de los pads
const ALTO_LOOP = 0.11;
const SEPARACION_LOOPS = 0.25; // de la línea de los pads a la de los loops
const BOTONES_LOOP = ['Pista 1', 'Pista 2', 'Pista 3', 'Pista 4', 'Borrar'];
const FRANJA_PULSADO = 0.12; // bajo la línea: el dedo «mantiene» la tecla

const motor = new MotorAudio();
const sec = new Secuenciador(motor);
const golpes = new DetectorGolpes();
const calibracion = new Calibracion(sec);
const medidor = new Medidor(motor);
const looper = new Looper(sec, (ev, t) => sonarEvento(ev, t, ev.vel));

const video = $('video');
const capa = $('capa');
const g = capa.getContext('2d');

const cancelaciones = new Map(); // dedo → cancelar nota prevista
const sostenidos = new Map(); // dedo → { destino, paso } en modo repetir
const destellos = new Map(); // 'tecla:3' / 'pad:1' → instante del último golpe
let ultimasManos = [];

// ---------------------------------------------------------------------------
// Disposición
// ---------------------------------------------------------------------------

function disposicion() {
  const lineaTeclas = Number($('posicion').value);
  const lineaPads = lineaTeclas - SEPARACION_PADS;
  const lineaLoops = lineaPads - SEPARACION_LOOPS;
  const notas = ESCALAS[$('escala').value];
  const ancho = (1 - 2 * MARGEN_X) / notas.length;
  const teclas = notas.map((midi, i) => ({
    midi,
    x0: MARGEN_X + i * ancho,
    x1: MARGEN_X + (i + 1) * ancho,
  }));
  const anchoPads = 0.7;
  const x0Pads = (1 - anchoPads) / 2;
  const pads = PADS.map((p, i) => ({
    ...p,
    x0: x0Pads + (i * anchoPads) / PADS.length + 0.008,
    x1: x0Pads + ((i + 1) * anchoPads) / PADS.length - 0.008,
  }));
  const anchoLoops = 0.8;
  const x0Loops = (1 - anchoLoops) / 2;
  const loops = BOTONES_LOOP.map((nombre, i) => ({
    nombre,
    x0: x0Loops + (i * anchoLoops) / BOTONES_LOOP.length + 0.008,
    x1: x0Loops + ((i + 1) * anchoLoops) / BOTONES_LOOP.length - 0.008,
  }));
  return {
    lineaTeclas,
    lineaPads,
    lineaLoops,
    teclas,
    pads,
    loops,
    lineas: [
      { id: 'loops', y: lineaLoops, x0: loops[0].x0, x1: loops.at(-1).x1 },
      { id: 'pads', y: lineaPads, x0: pads[0].x0, x1: pads.at(-1).x1 },
      { id: 'teclas', y: lineaTeclas, x0: MARGEN_X, x1: 1 - MARGEN_X },
    ],
  };
}

/** Qué tecla o pad hay en la línea `idLinea` a la altura x (o null). */
function destinoEn(disp, idLinea, x) {
  if (idLinea === 'teclas') {
    const i = disp.teclas.findIndex((t) => x >= t.x0 && x < t.x1);
    return i >= 0 ? { tipo: 'tecla', i } : null;
  }
  const lista = idLinea === 'pads' ? disp.pads : disp.loops;
  const i = lista.findIndex((p) => x >= p.x0 && x <= p.x1);
  return i >= 0 ? { tipo: idLinea === 'pads' ? 'pad' : 'loop', i } : null;
}

/** Qué hay en el punto (x, y) de la pantalla (para los clics del ratón). */
function destinoEnPunto(disp, x, y) {
  const filas = [
    { id: 'teclas', linea: disp.lineaTeclas, alto: ALTO_TECLA },
    { id: 'pads', linea: disp.lineaPads, alto: ALTO_PAD },
    { id: 'loops', linea: disp.lineaLoops, alto: ALTO_LOOP },
  ];
  const fila = filas.find((f) => y <= f.linea && y >= f.linea - f.alto);
  return fila ? { destino: destinoEn(disp, fila.id, x), linea: fila.id } : null;
}

// ---------------------------------------------------------------------------
// Análisis por cuadro
// ---------------------------------------------------------------------------

function analizar(resultado, { captura, tCuadro }) {
  const disp = disposicion();
  const manos = resultado.landmarks || [];
  const lateralidad = resultado.handedness || resultado.handednesses || [];
  const dedos = DEDOS[$('dedos').value];
  const fiable = captura != null;
  ultimasManos = [];

  manos.forEach((puntos, i) => {
    const mano = `${lateralidad[i]?.[0]?.categoryName || 'mano'}${i}`;
    const yemas = [];
    for (const indice of dedos) {
      const clave = `${mano}-${indice}`;
      const x = 1 - puntos[indice].x; // espejo
      const y = puntos[indice].y;
      const ev = golpes.procesar(clave, x, y, tCuadro, disp.lineas);
      yemas.push({ clave, x, y });
      if (!ev) continue;

      if (ev.tipo === 'golpe' || ev.tipo === 'prediccion') {
        const destino = destinoEn(disp, ev.linea.id, ev.x);
        if (destino) tocar(disp, clave, destino, ev, fiable);
      } else if (ev.tipo === 'confirmada') {
        cancelaciones.delete(clave);
      } else if (ev.tipo === 'cancelar') {
        const cancelar = cancelaciones.get(clave);
        cancelaciones.delete(clave);
        sostenidos.delete(clave);
        medidor.cancelacion(Boolean(cancelar && cancelar()));
      }
    }
    ultimasManos.push({ puntos, yemas });
  });
  golpes.limpiar(tCuadro);
  repetirSostenidos(disp);
}

function velocidadADinamica(v) {
  if (!$('dinamica').checked) return 0.8;
  return Math.min(1, Math.max(0.3, 0.35 + (v - golpes.velocidadMinima) / 3));
}

/** Evento grabable a partir de una tecla o pad. */
function eventoDe(disp, destino, vel) {
  if (destino.tipo === 'pad') return { tipo: 'pad', i: destino.i, vel };
  return { tipo: 'tecla', midi: disp.teclas[destino.i].midi, voz: $('voz').value, vel };
}

function sonarEvento(ev, t, vel) {
  if (ev.tipo === 'pad') return PADS[ev.i].sonar(t, vel);
  const f = midiAHz(ev.midi);
  return ev.voz === 'suave' ? motor.notaSuave(t, f, vel) : motor.notaPercusiva(t, f, vel);
}

function sonarDestino(disp, destino, t, vel) {
  return sonarEvento(eventoDe(disp, destino, vel), t, vel);
}

/** Siguiente punto de la rejilla (en semicorcheas por paso) a partir de t. */
function siguientePaso(t, pasosPorPulso) {
  const dur = sec.segPulso / pasosPorPulso;
  const n = Math.ceil((t + 0.003 - sec.t0) / dur);
  return { n, t: sec.t0 + n * dur };
}

function modoRitmo() {
  if (calibracion.activa) return { tipo: 'libre' };
  const [tipo, sub] = $('ritmoNotas').value.split('-');
  return { tipo, pasosPorPulso: Number(sub) / 4 };
}

function tocar(disp, clave, destino, ev, fiable) {
  const esPrediccion = ev.tipo === 'prediccion';
  if (destino.tipo === 'loop') {
    // Los botones de loop actúan al compás: la latencia no importa y no
    // merece la pena arriesgarse con la predicción.
    if (esPrediccion) {
      golpes.dedos.get(clave).pendiente = null;
      return;
    }
    pulsarLoop(destino.i);
    return;
  }
  const tCamara = motor.audibleDesdePerf(ev.tCruce);
  const vel = velocidadADinamica(ev.velocidad);
  const modo = modoRitmo();
  let tNota = motor.ahora;

  // Cuándo sonaría en modo libre (lo antes posible o con latencia fija).
  if ($('latFija').checked && fiable) {
    const objetivo = tCamara + Number($('latFijaMs').value) / 1000;
    if (modo.tipo === 'libre') medidor.latenciaFija(objetivo < tNota);
    if (objetivo >= tNota) tNota = objetivo;
  }
  // Lo que se graba: el instante en que el músico quiso tocar (compensado).
  const tIntencion = tNota - cal.compensacionMs / 1000;
  if (!calibracion.activa) looper.grabar(eventoDe(disp, destino, vel), tIntencion);

  if (modo.tipo !== 'libre') {
    if (!sec.sonando) arrancarBateria();
    const paso = siguientePaso(motor.ahora, modo.pasosPorPulso);
    tNota = paso.t;
    if (modo.tipo === 'repetir') sostenidos.set(clave, { destino, paso: paso.n, linea: ev.linea.id });
  }

  const calibrando = calibracion.activa;
  if (!calibrando || cal.oirGesto) {
    const cancelar = sonarDestino(disp, destino, tNota, vel);
    if (esPrediccion) cancelaciones.set(clave, cancelar);
  }
  destellos.set(`${destino.tipo}:${destino.i}`, performance.now());

  const nombre = destino.tipo === 'pad' ? disp.pads[destino.i].nombre : nombreNota(disp.teclas[destino.i].midi);
  const evento = medidor.nota({
    tNota,
    tCamara: fiable ? tCamara : null,
    esPrediccion,
    sec,
    compensacionMs: cal.compensacionMs,
    calibrando,
    datos: { destino: nombre, velocidad: ev.velocidad.toFixed(2), modo: $('ritmoNotas').value },
  });
  if (calibrando) {
    const golpe = calibracion.registrar(tNota, fiable ? tCamara : null);
    if (golpe) evento.calibracion_ms = golpe.desfaseMs.toFixed(1);
  }
}

/**
 * Modo «repetir»: mientras el dedo siga por debajo de la línea (en la franja
 * de pulsado), la nota se repite en cada paso de la rejilla. Si el dedo se
 * desliza a otra tecla, cambia la nota.
 */
function repetirSostenidos(disp) {
  const modo = modoRitmo();
  if (modo.tipo !== 'repetir' || !sec.sonando) {
    sostenidos.clear();
    return;
  }
  const yemas = new Map(ultimasManos.flatMap((m) => m.yemas.map((y) => [y.clave, y])));
  for (const [clave, s] of sostenidos) {
    const yema = yemas.get(clave);
    const linea = s.linea === 'teclas' ? disp.lineaTeclas : disp.lineaPads;
    if (!yema || yema.y < linea - 0.01 || yema.y > linea + FRANJA_PULSADO) {
      sostenidos.delete(clave);
      continue;
    }
    const destino = destinoEn(disp, s.linea, yema.x) || s.destino;
    s.destino = destino;
    const paso = siguientePaso(motor.ahora, modo.pasosPorPulso);
    // Se programa con poca antelación para poder soltar a tiempo.
    if (paso.n > s.paso && paso.t - motor.ahora < 0.06) {
      sonarDestino(disp, destino, paso.t, 0.7);
      looper.grabar(eventoDe(disp, destino, 0.7), paso.t);
      s.paso = paso.n;
      destellos.set(`${destino.tipo}:${destino.i}`, performance.now());
    }
  }
}

function pulsarLoop(i) {
  if (calibracion.activa) return;
  destellos.set(`loop:${i}`, performance.now());
  if (i === BOTONES_LOOP.length - 1) {
    looper.modoBorrar = !looper.modoBorrar;
    pagina.estado(looper.modoBorrar ? 'Borrar: golpea la pista que quieres vaciar.' : 'Borrado cancelado.');
    return;
  }
  if (!sec.sonando) arrancarBateria();
  looper.compases = Number($('compases').value);
  looper.cuantizar = $('cuantizarGrabacion').checked;
  pagina.estado(looper.pulsar(i, motor.ahora));
}

// Clic con el ratón sobre un botón: como un golpe (útil para probar sin cámara).
capa.addEventListener('pointerdown', (e) => {
  if (!motor.ctx) return;
  const r = capa.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const disp = disposicion();
  const encontrado = destinoEnPunto(disp, x, y);
  if (!encontrado?.destino) return;
  tocar(disp, 'raton', encontrado.destino, { tipo: 'golpe', tCruce: performance.now(), velocidad: 1.5, linea: { id: encontrado.linea } }, false);
});

function nombreNota(midi) {
  return `${NOMBRES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// ---------------------------------------------------------------------------
// Dibujo (el lienzo NO va en espejo: dibujamos en coordenadas de pantalla)
// ---------------------------------------------------------------------------

function dibujar() {
  const w = capa.width;
  const h = capa.height;
  if (!w) return;
  const disp = disposicion();
  const ahora = performance.now();
  const brillo = (clave) => Math.max(0, 1 - (ahora - (destellos.get(clave) ?? -1e9)) / 180);
  g.clearRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const fuente = Math.max(10, Math.round(h * 0.03));

  // Franja de pulsado (sólo en modo repetir)
  if (modoRitmo().tipo === 'repetir') {
    g.fillStyle = '#ffffff14';
    g.fillRect(MARGEN_X * w, disp.lineaTeclas * h, (1 - 2 * MARGEN_X) * w, FRANJA_PULSADO * h);
  }

  // Teclas
  disp.teclas.forEach((t, i) => {
    const b = brillo(`tecla:${i}`);
    const x = t.x0 * w;
    const y = (disp.lineaTeclas - ALTO_TECLA) * h;
    const an = (t.x1 - t.x0) * w;
    const al = ALTO_TECLA * h;
    g.fillStyle = b > 0 ? `rgba(245, 183, 0, ${0.25 + 0.55 * b})` : t.midi % 12 === 0 ? '#ffffff38' : '#ffffff22';
    g.fillRect(x, y, an, al);
    g.strokeStyle = '#ffffff88';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, an - 1, al - 1);
    g.fillStyle = '#ffffffdd';
    g.font = `${t.midi % 12 === 0 ? 'bold ' : ''}${Math.min(fuente, an * 0.42)}px system-ui`;
    g.fillText(NOMBRES[t.midi % 12], x + an / 2, y + al - 6);
  });
  // Línea de golpe de las teclas
  g.strokeStyle = '#2bb8a2';
  g.lineWidth = Math.max(3, h * 0.008);
  g.beginPath();
  g.moveTo(MARGEN_X * w, disp.lineaTeclas * h);
  g.lineTo((1 - MARGEN_X) * w, disp.lineaTeclas * h);
  g.stroke();

  // Pads
  disp.pads.forEach((p, i) => {
    const b = brillo(`pad:${i}`);
    const x = p.x0 * w;
    const y = (disp.lineaPads - ALTO_PAD) * h;
    const an = (p.x1 - p.x0) * w;
    const al = ALTO_PAD * h;
    g.fillStyle = b > 0 ? `rgba(240, 138, 75, ${0.3 + 0.55 * b})` : '#ffffff22';
    g.fillRect(x, y, an, al);
    g.strokeStyle = '#ffffff88';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, an - 1, al - 1);
    g.strokeStyle = '#f08a4b';
    g.lineWidth = Math.max(3, h * 0.008);
    g.beginPath();
    g.moveTo(x, y + al);
    g.lineTo(x + an, y + al);
    g.stroke();
    g.fillStyle = '#ffffffdd';
    g.font = `${fuente}px system-ui`;
    g.fillText(p.nombre, x + an / 2, y + al - 8);
  });

  // Botones de loop
  const tAudio = motor.audibleDesdePerf(performance.now());
  const COLORES = { vacia: '#ffffff22', cuenta: '#f5b700', grabando: '#e5484d', sonando: '#2bb8a2', silenciada: '#ffffff18' };
  disp.loops.forEach((bt, i) => {
    const x = bt.x0 * w;
    const y = (disp.lineaLoops - ALTO_LOOP) * h;
    const an = (bt.x1 - bt.x0) * w;
    const al = ALTO_LOOP * h;
    const pista = looper.pistas[i];
    const esBorrar = !pista;
    let texto = '';
    if (esBorrar) {
      g.fillStyle = looper.modoBorrar ? '#e5484dcc' : '#ffffff22';
      texto = looper.modoBorrar ? 'elige pista' : '';
    } else {
      const parpadeo = Math.floor(ahora / 250) % 2 === 0;
      g.fillStyle = COLORES[pista.estado];
      if (pista.estado === 'cuenta' && !parpadeo) g.fillStyle = '#f5b70066';
      if (pista.estado === 'sonando' || pista.estado === 'grabando') g.globalAlpha = 0.75;
      texto = {
        vacia: 'vacía',
        cuenta: `cuenta ${Math.max(1, Math.ceil(pista.inicio - looper.pulsoEn(tAudio)))}`,
        grabando: '● grabando',
        sonando: `▶ ${pista.eventos.length} notas`,
        silenciada: 'silenciada',
      }[pista.estado];
      if (pista.cambio) texto = pista.cambio.a === 'silenciada' ? 'se silencia…' : 'vuelve…';
    }
    g.fillRect(x, y, an, al);
    g.globalAlpha = 1;
    const b = brillo(`loop:${i}`);
    if (b > 0) {
      g.fillStyle = `rgba(255, 255, 255, ${0.4 * b})`;
      g.fillRect(x, y, an, al);
    }
    // Progreso del bucle o de la grabación
    if (pista && (pista.estado === 'sonando' || pista.estado === 'grabando' || pista.estado === 'silenciada')) {
      g.fillStyle = '#ffffffcc';
      g.fillRect(x, y, an * looper.progreso(pista, tAudio), Math.max(3, al * 0.06));
    }
    g.strokeStyle = pista?.cambio && Math.floor(ahora / 200) % 2 ? '#ffffff' : '#ffffff88';
    g.lineWidth = pista?.cambio ? 3 : 1;
    g.strokeRect(x + 0.5, y + 0.5, an - 1, al - 1);
    g.strokeStyle = esBorrar ? '#e5484d' : '#c9a7ff';
    g.lineWidth = Math.max(3, h * 0.008);
    g.beginPath();
    g.moveTo(x, y + al);
    g.lineTo(x + an, y + al);
    g.stroke();
    g.fillStyle = '#ffffffee';
    g.font = `bold ${fuente}px system-ui`;
    g.fillText(bt.nombre, x + an / 2, y + al * 0.5);
    g.font = `${Math.round(fuente * 0.8)}px system-ui`;
    g.fillText(texto, x + an / 2, y + al - 6);
  });

  // Manos: puntos tenues y yemas activas destacadas
  for (const { puntos, yemas } of ultimasManos) {
    g.fillStyle = '#ffffff66';
    for (const p of puntos) {
      g.beginPath();
      g.arc((1 - p.x) * w, p.y * h, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    for (const y of yemas) {
      const d = golpes.dedos.get(y.clave);
      g.fillStyle = d?.pendiente ? '#f5b700' : d?.armado === false ? '#9a9aa2' : '#2bb8a2';
      g.beginPath();
      g.arc(y.x * w, y.y * h, Math.max(6, h * 0.014), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#000a';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
}

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
    looper.actualizar(motor.ahora);
    if (!calibracion.activa) {
      const cuenta = looper.cuentaAtras(tAudible);
      const grabando = looper.pistas.some((p) => p.estado === 'grabando');
      $('aviso').hidden = cuenta == null && !grabando;
      $('aviso').textContent = cuenta != null ? `${Math.max(1, cuenta)}…` : grabando ? '● Grabando' : '';
    }
  } else {
    indicador.classList.remove('activo', 'acento');
    if (!calibracion.activa) $('aviso').hidden = true;
  }
  dibujar();
  requestAnimationFrame(bucleVisual);
}

// ---------------------------------------------------------------------------
// Montaje y controles
// ---------------------------------------------------------------------------

const cal = montarCalibracion({
  calibracion,
  gesto: 'golpe',
  alCambiar: (activa) => {
    $('btnRitmo').disabled = activa;
    actualizarBotonRitmo();
  },
});

const opcionesMedidas = () => ({
  compensacionMs: cal.compensacionMs,
  prediccionActiva: golpes.prediccion,
  latFijaActiva: $('latFija').checked,
});

const pagina = montarPagina({
  titulo: 'Prueba del teclado virtual',
  motor,
  medidor,
  video,
  capa,
  opcionesMedidas,
  extraResumen: () =>
    [
      `Ajustes: dedos ${$('dedos').value}, escala ${$('escala').value}, ritmo de notas ${$('ritmoNotas').value}, ` +
        `velocidad mínima ${golpes.velocidadMinima}, predicción ${golpes.prediccion ? `sí (${golpes.horizonteMs} ms)` : 'no'}`,
      cal.textoUltimo,
    ].join('\n'),
  habilitar: ['btnRitmo'],
  alCuadro: analizar,
  alListo: () => {
    pagina.estado('Listo. Baja el dedo índice a través de la línea de color de una tecla, un pad o una pista.');
    requestAnimationFrame(bucleVisual);
  },
});

function arrancarBateria() {
  sec.bpm = Number($('bpm').value) || 100;
  sec.iniciar('bateria');
  looper.reanclar();
  medidor.rejilla.vaciar();
  medidor.grabado.vaciar();
  actualizarBotonRitmo();
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

$('velMin').addEventListener('input', (e) => {
  golpes.velocidadMinima = Number(e.target.value);
  $('velMinTxt').textContent = Number(e.target.value).toFixed(2);
});

$('prediccion').addEventListener('change', (e) => {
  golpes.prediccion = e.target.checked;
});

$('horizonte').addEventListener('input', (e) => {
  golpes.horizonteMs = Number(e.target.value);
  $('horizonteTxt').textContent = `${e.target.value} ms`;
});

$('latFijaMs').addEventListener('input', (e) => {
  $('latFijaTxt').textContent = `${e.target.value} ms`;
});

$('ritmoNotas').addEventListener('change', () => {
  sostenidos.clear();
  if ($('ritmoNotas').value !== 'libre' && motor.ctx && !sec.sonando && !calibracion.activa) arrancarBateria();
});
