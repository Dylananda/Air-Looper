// Cámara y detector de manos (MediaPipe HandLandmarker).

// Versión fijada de la librería y modelo oficial de Google.
const VERSION_MP = '0.10.14';
const URL_MP = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION_MP}`;
const URL_MODELO =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/**
 * Crea el detector. Intenta usar la GPU y, si falla, la CPU.
 * Devuelve { detector, delegado }.
 */
export async function crearDetector(delegadoPreferido = 'GPU') {
  const { FilesetResolver, HandLandmarker } = await import(`${URL_MP}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`${URL_MP}/wasm`);
  const opciones = (delegado) => ({
    baseOptions: { modelAssetPath: URL_MODELO, delegate: delegado },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    const detector = await HandLandmarker.createFromOptions(vision, opciones(delegadoPreferido));
    return { detector, delegado: delegadoPreferido };
  } catch (err) {
    if (delegadoPreferido === 'CPU') throw err;
    console.warn('No se pudo usar la GPU, se usa la CPU:', err);
    const detector = await HandLandmarker.createFromOptions(vision, opciones('CPU'));
    return { detector, delegado: 'CPU' };
  }
}

/** Abre la webcam pidiendo resolución y fps; devuelve los ajustes reales. */
export async function abrirCamara(video, { ancho = 640, alto = 480, fps = 60 } = {}) {
  if (video.srcObject) {
    for (const pista of video.srcObject.getTracks()) pista.stop();
  }
  const flujo = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: ancho },
      height: { ideal: alto },
      frameRate: { ideal: fps },
      facingMode: 'user',
    },
  });
  video.srcObject = flujo;
  await video.play();
  const pista = flujo.getVideoTracks()[0];
  return { pista, ajustes: pista.getSettings() };
}

// Índices de los puntos de MediaPipe que usamos.
export const PUNTO = { MUNECA: 0, PULGAR: 4, INDICE: 8, BASE_MEDIO: 9 };

/**
 * Distancia pulgar-índice normalizada por el tamaño de la mano (muñeca →
 * base del dedo medio), para que no dependa de lo lejos que esté la mano.
 */
export function aperturaPinza(puntos, ancho, alto) {
  const d = (a, b) => Math.hypot((a.x - b.x) * ancho, (a.y - b.y) * alto);
  const tamano = d(puntos[PUNTO.MUNECA], puntos[PUNTO.BASE_MEDIO]) || 1;
  return d(puntos[PUNTO.PULGAR], puntos[PUNTO.INDICE]) / tamano;
}
