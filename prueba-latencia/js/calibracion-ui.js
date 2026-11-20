// Parte visible de la calibración, compartida por las dos pruebas. Usa los
// elementos con id: btnCalibrar, calBpm, calCompases, calOir, calProgreso,
// calGrafica, calResultado, compActual, btnAplicarComp y aviso.

import { colorCss, fmt } from './medidor.js';

const CLAVE_COMPENSACION = 'airlooper.compensacionMs';
const $ = (id) => document.getElementById(id);

/**
 * calibracion: instancia de Calibracion. gesto: 'pinza' | 'golpe' (textos).
 * alCambiar(activa): avisa al empezar y terminar (p. ej. para bloquear la batería).
 */
export function montarCalibracion({ calibracion, gesto = 'pinza', alCambiar = () => {} }) {
  let compensacionMs = leer();
  let ultimo = null;
  let textoUltimo = '';
  $('compActual').textContent = `${compensacionMs} ms`;

  $('btnCalibrar').addEventListener('click', () => {
    if (calibracion.activa) {
      terminar();
      return;
    }
    calibracion.empezar({
      bpm: Number($('calBpm').value) || 90,
      compases: Math.max(2, Number($('calCompases').value) || 4),
    });
    $('btnCalibrar').textContent = 'Cancelar';
    $('calResultado').innerHTML = '';
    $('calGrafica').hidden = true;
    $('btnAplicarComp').disabled = true;
    alCambiar(true);
  });

  $('btnAplicarComp').addEventListener('click', () => {
    if (!ultimo?.resumen.n) return;
    compensacionMs = Math.round(ultimo.resumen.media);
    $('compActual').textContent = `${compensacionMs} ms`;
    try {
      localStorage.setItem(CLAVE_COMPENSACION, String(compensacionMs));
    } catch {
      /* sin almacenamiento: sólo vale para esta sesión */
    }
  });

  function actualizar(tAudible) {
    if (!calibracion.activa) return;
    const p = calibracion.progreso(tAudible);
    const aviso = $('aviso');
    if (p.fase === 'cuenta') {
      aviso.hidden = false;
      aviso.textContent = p.pulso < 0 ? 'Prepárate…' : `${p.cuenta}…`;
      $('calProgreso').textContent = 'Escucha la cuenta…';
    } else if (p.fase === 'midiendo') {
      aviso.hidden = false;
      aviso.textContent = `¡${gesto === 'pinza' ? 'Pinza' : 'Golpe'} en cada clic! ${p.pulso + 1}/${p.total}`;
      $('calProgreso').textContent = `Midiendo: pulso ${p.pulso + 1} de ${p.total} · ${calibracion.golpes.length} válidos`;
    } else {
      terminar();
    }
  }

  function terminar() {
    const r = calibracion.terminar();
    $('aviso').hidden = true;
    $('btnCalibrar').textContent = 'Empezar calibración';
    $('calProgreso').textContent = '';
    alCambiar(false);
    ultimo = r;

    const perdidos = Math.max(0, r.esperados - calibracion.golpes.length);
    const recuento =
      `${r.resumen.n} de ${r.esperados} válidos · ${r.descartados} atípicos descartados · ` +
      `${perdidos} clics sin gesto (${r.lejos} gestos demasiado lejos de un clic, ${r.dobles} dobles)`;

    if (r.resumen.n < 4) {
      $('calResultado').innerHTML = `<p>Sólo ${r.resumen.n} gestos válidos de ${r.esperados}. Prueba otra vez (¿se ve bien la mano?).</p><p>${recuento}</p>`;
      textoUltimo = `Calibración (${gesto}): ${recuento}`;
      return;
    }
    const s = r.resumen;
    const veredicto =
      s.desv < 15 ? 'muy estable' : s.desv < 25 ? 'estable (tocable)' : s.desv < 40 ? 'irregular' : 'demasiado irregular';
    const lineas = [
      `Retraso medio: ${fmt(s.media, 0)} ms (mediana ${fmt(s.mediana, 0)}) · dispersión ± ${fmt(s.desv)} ms → ${veredicto}`,
      `${recuento} · rango ${fmt(s.min, 0)} … ${fmt(s.max, 0)} ms`,
    ];
    let html = `<p><strong>${lineas[0]}</strong></p><p>${lineas[1]}</p>`;
    if (r.camara.n) {
      const desglose =
        `Desglose: tu ${gesto} ocurrió ${fmt(r.camara.media, 0)} ± ${fmt(r.camara.desv)} ms después de oírse el clic ` +
        `(eso es tu parte, más el retraso interno de la cámara). Los otros ${fmt(s.media - r.camara.media, 0)} ms son ` +
        `del sistema: desde la captura del cuadro hasta que la nota sale por el altavoz (detección + salida de audio).`;
      lineas.push(desglose);
      html += `<p class="ayuda">${desglose}</p>`;
    }
    $('calResultado').innerHTML = html;
    textoUltimo = `Calibración (${gesto}, ${$('calBpm').value} BPM):\n${lineas.join('\n')}`;
    $('btnAplicarComp').disabled = false;
    dibujar(r);
  }

  function dibujar(r) {
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

  return {
    actualizar,
    get compensacionMs() {
      return compensacionMs;
    },
    get oirGesto() {
      return $('calOir').checked;
    },
    get textoUltimo() {
      return textoUltimo;
    },
  };
}

function leer() {
  try {
    return Number(localStorage.getItem(CLAVE_COMPENSACION)) || 0;
  } catch {
    return 0;
  }
}
