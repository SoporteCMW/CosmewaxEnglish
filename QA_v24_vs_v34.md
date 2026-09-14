# QA — English Unblocked: comparativa v24 → v34

**Fecha del análisis:** 2026-08-28
**Archivos comparados:** `english_unblocked_v24.html` vs `english_unblocked_v34.html`
**Método:** diff de código fuente + verificación programática de cada cambio (no solo revisión visual). Cada punto de este documento fue comprobado contra el código real de ambos archivos antes de incluirse.

---

## 1. Resumen ejecutivo

| | v24 | v34 |
|---|---|---|
| Estructuras de Gramática | 20 (B2/C1) | **40 (B1/B2/C1/C2)** |
| Selector de nivel CEFR | No existe | **Sí (B1/B2/C1/C2)** |
| Subpestañas del Cuaderno | 2 (Marcadas, Vocabulario de Tarjetas) | **3 (Palabras Marcadas, Vocabulario, Gramática)** |
| Repaso de palabras marcadas | Solo vía "Añadir a Tarjetas" (duplicaba en el mazo) | **Repetición espaciada propia, sin duplicar** |
| Exportar / Importar progreso | Presente | **Eliminado** |
| Vocabulario base (Tarjetas) | 157 tarjetas | 157 tarjetas (sin cambios) |
| Escenarios de Conversación | 22 | 22 (sin cambios) |
| Pares mínimos de Pronunciación | 74 (16 grupos) | 74 (16 grupos, sin cambios) |

**Nota importante para IT:** esta versión (v34) **incluye un bug conocido y aceptado deliberadamente por el propietario del producto**: el botón "🪄 Generar vocabulario para mi perfil activo" en Tarjetas falla porque el lote solicitado a la IA (30 palabras) supera el límite de tokens de respuesta disponible por llamada. Existe una corrección ya desarrollada (reducir a 15 palabras) pero **se descartó a petición explícita del propietario** para esta versión. Ver sección 5.

---

## 2. Cambios funcionales nuevos en v34

### 2.1 Gramática ampliada a B1–C2 (antes solo B2–C1)
- Se añadieron 20 estructuras nuevas: 10 de nivel B1 (presente simple/continuo, comparativos, primer condicional, etc.) y 10 de nivel C2 (subjuntivo formal, inversión, cleft sentences, etc.).
- El filtro de nivel dentro de la pestaña de Gramática pasa de mostrar `Todas / B2 / C1` a `Todas / B1 / B2 / C1 / C2`.
- El subtítulo de la pestaña cambia de "Estructuras B2-C1" a "Estructuras B1-C2".

### 2.2 Selector de nivel CEFR (nuevo)
- Nuevo desplegable en la barra superior, junto al de perfil profesional.
- Afecta a la complejidad del contenido generado por IA en: Lectura, Listening, Conversación (tanto el lenguaje del interlocutor como el criterio de corrección), generación de vocabulario y escenarios por perfil.
- La corrección de Gramática usa el nivel propio de cada estructura (B1/B2/C1/C2 ya fijado en cada una), no el selector global.

### 2.3 Cuaderno: nueva subpestaña "Gramática"
- Antes: 2 subpestañas (Marcadas, Vocabulario de Tarjetas).
- Ahora: 3 subpestañas (Palabras Marcadas, Vocabulario, Gramática).
- La subpestaña de Gramática muestra las 40 estructuras en modo lectura, filtrables por nivel, con su nivel de dominio (Leitner) visible.

### 2.4 Repaso propio para "Palabras Marcadas" (cambio de arquitectura)
- **Antes (v24):** cada palabra marcada tenía un botón "➕ Añadir a Tarjetas" que la copiaba al mazo de Tarjetas (categoría "Cuaderno") para poder repasarla con repetición espaciada. Esto generaba una copia duplicada del dato.
- **Ahora (v34):** cada palabra marcada tiene su propio nivel Leitner desde el momento en que se marca. Hay un botón "▶ Repasar (X pendientes hoy)" que abre una sesión de práctica (igual que Tarjetas: escribir/dictar, corrección con IA, puntuar Otra vez/Bien/Fácil) directamente sobre las palabras marcadas, sin pasar por el mazo de Tarjetas.
- El botón "➕ Añadir a Tarjetas" y toda su lógica asociada se eliminaron.

### 2.5 Eliminación de Exportar / Importar progreso
- Los botones "📤 Exportar" y "📥 Importar" desaparecen de la barra superior.
- El input de archivo oculto y el banner de confirmación de importación también se eliminaron.
- Las funciones JS asociadas (`exportProgress`, `importProgress`, `confirmImportYes`, `confirmImportNo`) se eliminaron del código.

---

## 3. Cambios de nomenclatura / reorganización (sin cambio de lógica)

| Elemento | v24 | v34 |
|---|---|---|
| Orden de pestañas principales | Cuaderno, Gramática, Pronunciación, **Tarjetas Vocabulario**, Conversación, Lectura, Listening | Cuaderno, **Tarjetas de Vocabulario**, **Tarjetas de Gramática**, Pronunciación, Conversación, Lectura, Listening |
| Pestaña "Gramática" | "📐 Gramática" | "📐 Tarjetas de Gramática" |
| Pestaña "Tarjetas" | "📇 Tarjetas Vocabulario" | "📇 Tarjetas de Vocabulario" |
| Subpestaña Cuaderno 1 | "🖊️ Marcadas" | "🖊️ Palabras Marcadas" |
| Subpestaña Cuaderno 2 | "📇 Vocabulario de Tarjetas" | "📇 Vocabulario" |
| Categoría "personal" en Tarjetas | Etiquetada "Cuaderno" | Etiquetada **"Propias"** (para no confundir con el Cuaderno real, ya que dejaron de estar conectados) |
| Cabecera superior derecha | "Cosmewax · I+D / PDM" | "Cosmewax · Plataforma para aprender inglés" |
| Subtítulo de Conversación | "Simulacro de llamada de 3-5 min · el cliente responde..." | "Simulacro de llamada · el cliente/proveedor/interlocutor responde..." |

---

## 4. Lo que NO ha cambiado entre v24 y v34 (confirmado por código, no solo por descarte)

- Mazo base de Tarjetas: **157 tarjetas**, sin cambios.
- Escenarios de Conversación: **22**, sin cambios (11 cliente + 1 presentación + 10 cotidianos).
- Pares mínimos de Pronunciación: **74 pares en 16 grupos**, sin cambios.
- Perfiles profesionales: **8**, sin cambios.
- Duraciones de Conversación: 5 / 15 / 30 min, sin cambios.
- Longitud de Lectura/Listening: 500-600 palabras, sin cambios.
- Auto-envío por voz en Conversación (con cuenta atrás cancelable): sin cambios.
- Corrección con IA en Tarjetas, Gramática y Listening, con resaltado en negrita/subrayado del fallo concreto: sin cambios de lógica (solo se replicó el mismo patrón en el nuevo repaso de palabras marcadas).

---

## 5. Bug conocido en v34 — pendiente de decisión de negocio

**Módulo:** Tarjetas de Vocabulario → botón "🪄 Generar vocabulario para mi perfil activo"

**Síntoma:** al pulsar el botón, tras varios segundos aparece el aviso genérico *"No se pudo generar el vocabulario (fallo de red, de la API, o de formato)."* y no se añade ninguna tarjeta nueva.

**Causa raíz confirmada:** el prompt solicita 30 términos de vocabulario completos (traducción + término + frase de ejemplo + categoría cada uno). Esto requiere aproximadamente **1200 tokens** de respuesta, pero el límite técnico disponible por llamada en este entorno es de **1000 tokens**. La respuesta de la IA se corta a mitad de la estructura JSON, y el `JSON.parse()` posterior falla, mostrando el error genérico sin más detalle.

**Corrección disponible pero no aplicada:** reducir el lote solicitado de 30 a 15 términos (cabe con margen, ~600 de 1000 tokens). Esta corrección fue desarrollada y validada, pero **se decidió no incluirla en v34** a petición explícita del propietario del producto, quien solicitó mantener v34 en el estado exacto en que fue aprobada originalmente.

**Impacto:** el resto de la app no se ve afectado. El vocabulario base (157 tarjetas) funciona con normalidad; solo falla la generación adicional por perfil.

---

## 6. Plan de pruebas para IT

### 6.1 Regresión — funciones que deben seguir funcionando igual que en v24

| # | Módulo | Caso de prueba | Resultado esperado |
|---|---|---|---|
| R1 | Tarjetas de Vocabulario | Responder una tarjeta del mazo base (texto o voz) | Corrige con IA, muestra forma más adecuada y alternativas si las hay |
| R2 | Conversación | Iniciar una llamada de cliente, hablar por voz | Transcribe, muestra cuenta atrás de auto-envío, permite cancelar/editar |
| R3 | Lectura | Generar un texto y leerlo en voz alta | Genera 500-600 palabras, corrige por difusión de palabras y da un análisis de pronunciación con puntuación |
| R4 | Listening | Generar un audio y responder preguntas | Reproduce el texto, corrige cada respuesta con IA |
| R5 | Pronunciación | Practicar un grupo de pares mínimos | Fase de discriminación + producción, con nota explicativa del par |
| R6 | Cuaderno → Palabras Marcadas | Marcar una palabra en Conversación/Lectura/Listening/Gramática | Se añade a "Palabras Marcadas" con traducción y ejemplo |

### 6.2 Funcionalidad nueva — verificar que funciona como se describe

| # | Módulo | Caso de prueba | Resultado esperado |
|---|---|---|---|
| N1 | Barra superior | Cambiar el selector de nivel a "B1" y generar un texto de Lectura | El texto generado debe usar vocabulario y estructuras más simples que en B2 |
| N2 | Tarjetas de Gramática | Filtrar por nivel "B1" | Deben aparecer exactamente 10 estructuras (presente simple/continuo, comparativos, etc.) |
| N3 | Tarjetas de Gramática | Filtrar por nivel "C2" | Deben aparecer exactamente 10 estructuras (subjuntivo, inversión, etc.) |
| N4 | Cuaderno → Gramática | Abrir la subpestaña y filtrar por nivel | Debe mostrar las estructuras correspondientes en modo lectura, con nivel de dominio visible |
| N5 | Cuaderno → Palabras Marcadas | Marcar una palabra nueva, luego pulsar "▶ Repasar" | Debe abrir una tarjeta de práctica pidiendo traducir al inglés |
| N6 | Cuaderno → Palabras Marcadas | Responder correctamente en el repaso y pulsar "Bien" | El nivel de dominio de esa palabra debe subir (verificable visualmente en la lista) |
| N7 | Cuaderno → Palabras Marcadas | Confirmar que NO aparece ningún botón "Añadir a Tarjetas" | El botón no debe existir en ningún punto de la interfaz |
| N8 | Barra superior | Confirmar que NO aparecen los botones "Exportar" / "Importar" | Ninguno de los dos botones debe ser visible |

### 6.3 Bug conocido — confirmar que el comportamiento es el documentado (no un nuevo fallo)

| # | Módulo | Caso de prueba | Resultado esperado (documentado como bug conocido) |
|---|---|---|---|
| B1 | Tarjetas de Vocabulario | Pulsar "🪄 Generar vocabulario para mi perfil activo" | Tras varios segundos, aviso de error genérico. No se añade ninguna tarjeta. **Este comportamiento es el bug documentado en la sección 5, no debe reportarse como hallazgo nuevo.** |

---

## 7. Notas para el equipo de IT

- Esta build depende de la API de Anthropic (Claude) para: Conversación, Lectura, Listening, corrección de Gramática/Tarjetas/Cuaderno, y generación de vocabulario/escenarios por perfil. Sin conexión a la API, estos módulos mostrarán errores — es el comportamiento esperado, no un bug.
- El micrófono requiere que el artefacto esté abierto en su propia pestaña (no en un iframe incrustado) para funcionar correctamente.
- Cualquier hallazgo fuera de lo descrito en las secciones 5 y 6.3 debe reportarse como bug nuevo con: módulo, pasos exactos, texto visible en pantalla al fallar, y navegador utilizado.
