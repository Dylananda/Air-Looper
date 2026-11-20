# Air Looper — concepto y decisiones

Documento vivo: aquí se apuntan las decisiones tomadas y lo que se aprende en
cada prueba. Lo más reciente va al final, en el registro de decisiones.

## Concepto

Una estación de loops que se toca **solo con la cámara del PC**: sin placas,
sin cables, sin controladores.

- Programa para PC (más adelante quizá móvil). Con una webcam basta para tener
  un pequeño estudio: **4–8 pistas de loop a un tempo fijo**.
- **Grabar pista**: gesto → cuenta de 4 tiempos → graba un compás → queda en
  bucle, cuantizado al tempo.
- **Lanzar y silenciar pistas siempre al compás**, así la latencia no se nota.
- **Tocar notas**: pinza pulgar-índice en zonas del aire (o sobre un papel).
- **Gestos continuos**:
  - altura de la mano → volumen o filtro;
  - lado a lado → paneo o mezcla entre pistas;
  - distancia entre manos → efecto;
  - giro de muñeca → potenciómetro.
- **Órdenes**: puño = grabar, palma = parar, barrido = cambiar instrumento…
- **Modos separados** para que no se disparen gestos sin querer (p. ej. una
  mano toca y la otra manda).
- **Solo encima del loop**:
  - sonidos de ataque suave;
  - modo theremín (altura = nota, pinza = suena);
  - escala bloqueada a la del loop;
  - compensación de latencia al grabar.

## El riesgo principal: la latencia

- Webcam a 30 fps ≈ 80–120 ms en total; a 60 fps, menos.
- Lo que importa es que sea **constante**: a un retraso fijo uno se adapta; a
  uno irregular, no.
- Ideas para reducirla o hacerla constante:
  - **Predecir el golpe** por la trayectoria del dedo y programar el sonido
    para el instante previsto.
  - **Calibrar** el retraso de cada usuario y **compensarlo al grabar**.
  - **Latencia fija**: programar cada nota a un retraso fijo desde la captura
    del cuadro, en vez de "lo antes posible". Se pierden unos ms pero
    desaparece la variación de la detección y del búfer de audio.

### Componentes de la latencia (de la mano al oído)

| Tramo | Valor típico | ¿Varía? |
|---|---|---|
| La pinza ocurre entre dos cuadros (media: medio intervalo) | 8 ms a 60 fps · 17 ms a 30 fps | Sí, uniforme entre 0 y 1 cuadro |
| Exposición, sensor, USB, controlador (antes de la marca `captureTime`) | 10–50 ms | Poco (depende de la cámara) |
| Captura → resultado de la detección (cola + MediaPipe) | 10–30 ms | Algo (GPU/CPU ocupadas) |
| Programar el sonido → oírlo (búfer y salida de audio) | 10–50 ms | Poco; mucho más con Bluetooth |

El primer tramo es el **jitter irreducible** de la cámara: a 30 fps, ±17 ms;
a 60 fps, ±8 ms. La predicción por trayectoria es la única forma de recortarlo.

## Primer paso: prueba de latencia

Antes de diseñar nada más, comprobar si tocar con la cámara es tocable.
Está en [`prueba-latencia/`](../prueba-latencia/) (ver el README para
arrancarla).

- Página web (HTML + JS) servida en localhost, con **MediaPipe
  HandLandmarker** y **Web Audio**.
- Ritmo de batería sencillo en bucle de fondo.
- Al juntar pulgar e índice suena una nota: **percusiva** o de **ataque
  suave**, para comparar (o una por cada lado de la pantalla).
- En pantalla: **fps reales** de la cámara, **tiempo de detección**,
  **latencia total estimada** y su **variación (jitter)**.
- **Modo calibración**: pinza al ritmo de un metrónomo durante unos compases;
  mide el retraso medio y su dispersión.
- Extras para experimentar: predicción por trayectoria, latencia fija desde
  la captura, descarga de las medidas en CSV.

### Qué mide exactamente

- **Latencia total estimada (por cuadro)**: `captura → resultado` + `salida de
  audio` + medio intervalo entre cuadros. No incluye el retraso interno de la
  cámara antes de la marca `captureTime` (no se puede ver desde el navegador).
- **Captura → altavoz (por pinza)**: desde el instante de captura del cuadro
  en que se detectó la pinza hasta que la nota sale por el altavoz, usando el
  reloj de salida de Web Audio (`getOutputTimestamp`).
- **Lo que oyes: nota vs. corchea**: diferencia entre cuándo suena la nota y la
  corchea más cercana de la batería. Si la latencia es constante, la media se
  irá a ~0 sola (uno se adapta) y lo que cuenta es la **desviación**.
- **Lo que se grabaría (compensado)**: lo mismo, restando la compensación de
  la calibración. Es lo que acabaría en un loop grabado.
- **Calibración**: retraso entre el clic programado y el momento en que la
  pinza llega al motor de audio. Incluye todo (salida de audio, reacción
  humana, cámara, detección); es exactamente lo que hay que restar al grabar.

### Criterios para decidir si es tocable (propuesta, a revisar con la práctica)

- Dispersión de la calibración < 25 ms → tocable; < 15 ms → muy bien.
- Desviación "lo que oyes" < 25 ms tras unos minutos tocando.
- Latencia total < ~120 ms con sonidos suaves; los percusivos exigen menos.
- Sensación subjetiva tras unos minutos encima del ritmo.

### Para medir la latencia real (sin estimaciones)

Grabar con el móvil en cámara lenta (240 fps) la mano haciendo la pinza junto
al altavoz: contar los fotogramas entre el contacto de los dedos y el inicio
del sonido en la pista de audio del vídeo.

## Registro de decisiones

- **2026-11-20** — Se empieza por una prueba de latencia en web (HTML + JS,
  MediaPipe HandLandmarker 0.10.14 desde CDN, Web Audio sintetizado, sin
  dependencias ni compilación). Se decide qué tecnología usar para el
  programa final según lo que salga de esta prueba.
- **2026-11-20** — Pinza = distancia pulgar-índice normalizada por el tamaño de
  la mano (muñeca → base del dedo medio), con histéresis (cierra < 0,30, abre
  > 0,45) para evitar disparos dobles.
- **2026-11-20** — La batería se programa con antelación (~120 ms) en el reloj
  de audio para que la detección, que bloquea el hilo principal, no afecte al
  ritmo.

## Pendiente de decidir

- Resultado de la prueba: ¿es tocable? ¿A qué fps / resolución? ¿Con qué
  sonidos?
- ¿Merece la pena la predicción por trayectoria (aciertos vs. falsos
  disparos)?
- ¿Latencia fija o "lo antes posible"?
- Tecnología del programa final (web/PWA, Electron, nativo…).
- Mapa de gestos y modos (qué mano toca, qué mano manda).
