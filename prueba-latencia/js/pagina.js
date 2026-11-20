// Arranque y piezas comunes de las dos pruebas: botón «Iniciar», cámara,
// detector, bucle por cuadro y botones de medidas (reiniciar, CSV, copiar).
// Usa los elementos con id: btnIniciar, estado, resolucion, fpsPedidos,
// delegado, btnCamara, btnReiniciar, btnCsv, btnCopiar y grafica.

import { crearDetector, abrirCamara } from './seguimiento.js';
import { descargar, copiar } from './medidor.js';

const $ = (id) => document.getElementById(id);

/**
 * motor: MotorAudio; medidor: Medidor; video/capa: elementos.
 * alCuadro(resultado, info): se llama con cada resultado del detector
 *   (info = { captura, tCuadro, intervalo }).
 * opcionesMedidas(): opciones para medidor.pintar / textoResumen.
 * extraResumen(): texto adicional para «Copiar resumen».
 * habilitar: ids de botones que se activan al arrancar.
 * alListo(): se llama cuando todo está en marcha.
 */
export function montarPagina({ titulo, motor, medidor, video, capa, alCuadro, opcionesMedidas, extraResumen, habilitar = [], alListo }) {
  let detector = null;
  let delegado = '';

  function estado(texto, error = false) {
    const el = $('estado');
    el.textContent = texto;
    el.classList.toggle('error', error);
  }

  async function abrirCamaraSegunControles() {
    const [ancho, alto] = $('resolucion').value.split('x').map(Number);
    const fps = Number($('fpsPedidos').value);
    const r = await abrirCamara(video, { ancho, alto, fps });
    capa.width = video.videoWidth;
    capa.height = video.videoHeight;
    Object.assign(medidor.contexto, { ajustes: r.ajustes, fpsPedidos: fps, ancho: video.videoWidth, alto: video.videoHeight });
    medidor.ultimoCuadro = null;
    prepararExposicion(r.pista);
  }

  // Exposición manual: con poca luz la cámara alarga la exposición y baja los
  // fps. Si la cámara lo permite, fijamos un tiempo de exposición corto.
  function prepararExposicion(pista) {
    const caja = $('cajaExposicion');
    if (!caja) return;
    const caps = pista.getCapabilities?.() ?? {};
    const manual = caps.exposureMode?.includes?.('manual') && caps.exposureTime;
    caja.hidden = !manual;
    $('exposicionNo').hidden = Boolean(manual);
    if (!manual) return;
    const deslizador = $('exposicion');
    deslizador.min = caps.exposureTime.min;
    deslizador.max = caps.exposureTime.max;
    deslizador.step = caps.exposureTime.step || 1;
    // Las unidades suelen ser de 100 µs: 160 ≈ 16 ms, lo justo para 60 fps.
    deslizador.value = Math.min(Math.max(160, caps.exposureTime.min), caps.exposureTime.max);
    const aplicar = async () => {
      $('exposicionTxt').textContent = $('expManual').checked ? deslizador.value : 'auto';
      try {
        await pista.applyConstraints({
          advanced: [$('expManual').checked
            ? { exposureMode: 'manual', exposureTime: Number(deslizador.value) }
            : { exposureMode: 'continuous' }],
        });
        medidor.intervalo.vaciar();
      } catch (err) {
        estado(`La cámara no aceptó la exposición: ${err.message || err}`, true);
      }
    };
    $('expManual').onchange = aplicar;
    deslizador.oninput = () => $('expManual').checked && aplicar();
  }

  async function cargarDetector() {
    if (detector) detector.close();
    const r = await crearDetector($('delegado').value);
    detector = r.detector;
    delegado = r.delegado;
    medidor.contexto.delegado = delegado;
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
    alCuadro(resultado, medidor.cuadro(ahora, meta, tInicio, tFin));
  }

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
      for (const id of ['btnCamara', 'btnReiniciar', 'btnCsv', 'btnCopiar', 'btnCalibrar', ...habilitar]) {
        if ($(id)) $(id).disabled = false;
      }
      $('btnIniciar').textContent = 'En marcha';
      estado(`Listo · detector en ${delegado}.`);
      bucleCuadros();
      setInterval(() => {
        medidor.pintar(opcionesMedidas());
        medidor.dibujarGrafica($('grafica'));
      }, 250);
      alListo?.();
    } catch (err) {
      console.error(err);
      estado(`Error: ${err.message || err}`, true);
      $('btnIniciar').disabled = false;
    }
  });

  $('btnCamara').addEventListener('click', async () => {
    $('btnCamara').disabled = true;
    try {
      estado('Reconfigurando la cámara…');
      await abrirCamaraSegunControles();
      if ($('delegado').value !== delegado) await cargarDetector();
      medidor.reiniciar();
      estado(`Listo · detector en ${delegado}.`);
    } catch (err) {
      estado(`Error: ${err.message || err}`, true);
    } finally {
      $('btnCamara').disabled = false;
    }
  });

  $('btnReiniciar').addEventListener('click', () => medidor.reiniciar());

  $('btnCsv').addEventListener('click', () => {
    const texto = medidor.csv();
    if (texto) descargar(`notas-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`, texto);
  });

  $('btnCopiar').addEventListener('click', async () => {
    const ok = await copiar(medidor.textoResumen(titulo, opcionesMedidas(), extraResumen?.()));
    if (ok) {
      const b = $('btnCopiar');
      const antes = b.textContent;
      b.textContent = '¡Copiado! Pégalo en el chat';
      setTimeout(() => (b.textContent = antes), 2500);
    }
  });

  return { estado };
}
