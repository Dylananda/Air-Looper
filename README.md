# Air Looper

Estación de loops que se toca solo con la cámara del PC. El concepto y las
decisiones están en [`docs/concepto.md`](docs/concepto.md).

## Pruebas

En la carpeta `prueba-latencia` hay dos páginas:

- **`index.html` — prueba de la pinza**: ritmo de batería de fondo, pinza
  pulgar-índice = nota, medidas de latencia y calibración con metrónomo.
- **`teclado.html` — teclado virtual y loops**: teclado de 2 octavas, pads de
  percusión y 4 pistas de loop dibujados sobre la imagen de la cámara. Se
  tocan bajando el dedo a través de la línea de color de cada botón.

Las dos tienen el botón **«Copiar resumen»**, que copia todas las medidas
para pegarlas en el chat.

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

### Cómo usar la prueba de la pinza

1. **Iniciar cámara y audio** y dar permiso a la cámara.
2. **▶ Batería** y tocar encima: junta pulgar e índice para que suene una nota
   (la altura de la mano elige la nota). Compara el sonido percusivo con el de
   ataque suave.
3. **Calibración**: escucha un compás de cuenta y haz la pinza en cada clic.
   Al terminar, **Usar el resultado** guarda la compensación.
4. Toca unos minutos y mira sobre todo la **dispersión** (± ms): si la latencia
   es constante, uno se adapta.

### Cómo usar el teclado virtual

1. Abre <http://localhost:8000/teclado.html> (o el enlace de la otra página).
2. **Iniciar cámara y audio** y, si quieres, **▶ Batería**.
3. Baja el dedo índice **a través de la línea de color** que hay bajo cada
   tecla o pad. Para repetir la nota, súbelo por encima de la línea.
4. **Loops**: golpe en «Pista 1» → cuenta atrás → toca durante el compás que
   se graba → queda en bucle. Otro golpe la silencia en el compás siguiente.
   «Borrar» y luego una pista la vacía. También funciona con clics del ratón.
5. Calibra con golpes (sección «Calibración») y pulsa **Usar el resultado**:
   así lo grabado queda en su sitio.

Consejos: buena luz de frente, mano entera dentro del encuadre, cascos con
cable (el Bluetooth añade 100–200 ms) y probar 60 fps si la cámara los da.
Si «Cámara» marca menos fps de los que declara, casi siempre es por falta de
luz. Prueba con más luz o con «Exposición manual», si tu cámara la ofrece.

### Archivos

- `prueba-latencia/index.html`, `estilos.css` — interfaz.
- `prueba-latencia/teclado.html` — interfaz del teclado virtual y los loops.
- `js/principal.js` — página de la pinza: disparo de notas y dibujo.
- `js/teclado.js` — página del teclado: disposición, golpes, loops y dibujo.
- `js/golpe.js` — detección del golpe (cruce de línea, rearme, predicción).
- `js/looper.js` — pistas de loop: cuenta, grabación, bucle, silenciar al compás.
- `js/pagina.js` — arranque común: cámara, detector, exposición, botones de medidas.
- `js/medidor.js` — medidas de latencia, panel, gráfica, resumen y CSV.
- `js/calibracion-ui.js` — parte visible de la calibración.
- `js/seguimiento.js` — cámara y MediaPipe HandLandmarker.
- `js/pinza.js` — detección de la pinza (histéresis y predicción).
- `js/audio.js` — Web Audio: batería, metrónomo, voces y relojes.
- `js/secuenciador.js` — ritmo programado con antelación.
- `js/calibracion.js` — medida del retraso con metrónomo.
- `js/estadisticas.js` — media, desviación, percentiles.
