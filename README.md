# Air Looper

Estación de loops que se toca solo con la cámara del PC. El concepto y las
decisiones están en [`docs/concepto.md`](docs/concepto.md).

## Prueba de latencia

Primer paso del proyecto: una página web para comprobar si tocar con la
cámara es tocable (ritmo de batería de fondo, pinza pulgar-índice = nota,
medidas de latencia y calibración con metrónomo).

### Arrancarla

La cámara solo funciona en `https` o en `localhost`, así que hay que servir la
carpeta con cualquier servidor local. Con Python:

```bash
cd prueba-latencia
```

```bash
python3 -m http.server 8000
```

Y abrir <http://localhost:8000> en **Chrome o Edge** (son los que dan la marca
de tiempo de captura de cada cuadro; en Firefox funciona pero algunas medidas
salen como "supuesto"). Hace falta conexión a internet la primera vez para
descargar MediaPipe y el modelo de manos.

### Cómo usarla

1. **Iniciar cámara y audio** y dar permiso a la cámara.
2. **▶ Batería** y tocar encima: junta pulgar e índice para que suene una nota
   (la altura de la mano elige la nota). Compara el sonido percusivo con el de
   ataque suave.
3. **Calibración**: escucha un compás de cuenta y haz la pinza en cada clic.
   Al terminar, **Usar el resultado** guarda la compensación.
4. Toca unos minutos y mira sobre todo la **dispersión** (± ms): si la latencia
   es constante, uno se adapta.

Consejos: buena luz de frente, mano entera dentro del encuadre, cascos con
cable (el Bluetooth añade 100–200 ms) y probar 60 fps si la cámara los da.

### Archivos

- `prueba-latencia/index.html`, `estilos.css` — interfaz.
- `js/principal.js` — bucle por cuadro, disparo de notas, métricas, calibración en pantalla.
- `js/seguimiento.js` — cámara y MediaPipe HandLandmarker.
- `js/pinza.js` — detección de la pinza (histéresis y predicción).
- `js/audio.js` — Web Audio: batería, metrónomo, voces y relojes.
- `js/secuenciador.js` — ritmo programado con antelación.
- `js/calibracion.js` — medida del retraso con metrónomo.
- `js/estadisticas.js` — media, desviación, percentiles.
