# English Unblocked

Entrenador de inglés de negocios para I+D / PDM de Cosmewax. Tres modos:

| Modo | Qué hace | Necesita Claude |
|---|---|---|
| **Tarjetas** | Recall activo español → inglés con repetición espaciada (Leitner, 5 cajas) y corrección por diff de palabras. Admite dictado por voz y mide el tiempo de respuesta oral. | No |
| **Conversación** | Simulacro de llamada de 3-5 min con un interlocutor simulado que responde en carácter. Al terminar, corrección estructurada en español. | Sí |
| **Lectura** | Claude genera un texto B1-B2, el alumno lo lee en voz alta y se comparan palabra a palabra el original y lo que entendió el reconocedor. Las palabras falladas se acumulan entre sesiones. | Sí |

Procede de un prototipo de un solo fichero HTML (`english_unblocked_v2.html`, conservado
como referencia) que llamaba a la API de Anthropic desde el navegador. Eso ya no es
posible sin exponer la clave, y todo lo demás estaba en un único fichero de 1.900 líneas.

---

## Puesta en marcha

1. El proyecto ya está en `c:\xampp\htdocs\CosmewaxEnglish`. Arranca Apache desde el panel de XAMPP.
2. Copia `.env.example` a `.env` y rellena `ANTHROPIC_API_KEY`.
3. Abre <https://cosmewaxdevjd/CosmewaxEnglish/> (HTTPS: ver la sección siguiente).
4. Si algo no va: <https://cosmewaxdevjd/CosmewaxEnglish/api/health.php> comprueba PHP,
   extensiones, permisos, presencia de la clave y los datasets. **No gasta tokens.**

El modo Tarjetas funciona sin clave; Conversación y Lectura muestran un aviso hasta
que la haya.

### Requisitos

PHP 8.0+ con `curl`, `openssl` y `mbstring` (los tres vienen de serie en XAMPP).
Sin Composer ni dependencias externas: el autoload PSR-4 son doce líneas en
`src/bootstrap.php`.

El dictado y la lectura en voz alta usan la Web Speech API: **Chrome o Edge**.
En Firefox y Safari los modos siguen funcionando por texto.

### Entra por HTTPS: el micrófono lo exige

> **URL correcta: <https://cosmewaxdevjd/CosmewaxEnglish/>**

El navegador sólo da acceso al micrófono en un **contexto seguro**: `https://` o
`http://localhost`. Por una URL HTTP de red (`http://cosmewaxdevjd/CosmewaxEnglish/`)
el micrófono queda bloqueado. No es un fallo de la aplicación; la app lo detecta y
avisa arriba en lugar de fallar al pulsar el botón.

**Ya está resuelto en este servidor** (2026-07-31): Apache sirve HTTPS con un
certificado propio para `cosmewaxdevjd` (SAN con el nombre de host, `localhost`,
`127.0.0.1` y `10.0.70.95`; válido hasta el 30/07/2031), en lugar del certificado de
fábrica de XAMPP (`CN=localhost`, caducado en 2019).

- Configuración: `C:\xampp\apache\conf\extra\httpd-ssl.conf`
  (copia previa en `httpd-ssl.conf.bak-20260731`).
- Certificado y clave: `C:\xampp\apache\conf\ssl.crt\cosmewaxdevjd.crt` y
  `ssl.key\cosmewaxdevjd.key`.
- **En cada equipo nuevo** hay que instalar el certificado como raíz de confianza, o
  el navegador seguirá avisando y bloqueando el micrófono. Las cinco vías, ordenadas
  de mejor a peor, están en [`certs/LEEME.md`](certs/LEEME.md). Resumen:
  - **Por GPO** (dominio `cosmewax.local`): se hace una vez y el usuario no hace nada.
    Es la opción recomendada.
  - **`certs/InstalarCertificado.exe`**: doble clic, sin consola y sin permisos de
    administrador. No está firmado, así que SmartScreen puede avisar.
  - **`certs/instalar-certificado.bat`**: lo mismo en texto plano y auditable.

Alternativas si no quieres instalar el certificado en un equipo concreto:

- `http://localhost/CosmewaxEnglish/` si estás en el propio servidor.
- Chrome/Edge → `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → añade
  `http://cosmewaxdevjd` → *Enabled* → *Relaunch*.

Todos los modos funcionan escribiendo, sin micrófono. La lectura en voz alta de las
frases del interlocutor (síntesis de voz) **sí** funciona en HTTP: sólo la entrada de
micrófono está restringida.

---

## Estructura

```
index.php                 Shell HTML. Inyecta datos en window.__APP__ y carga el JS.
api/claude.php            ÚNICO punto de contacto con la API de Anthropic.
api/health.php            Diagnóstico de instalación (no llama a la API).
config/config.php         Toda la configuración. Lee .env.
data/*.json               Contenido: mazo, escenarios, temas, categorías.
src/
  App.php                 Contenedor mínimo: construye y comparte los servicios.
  bootstrap.php           Autoload + carga de .env + configuración.
  Api/TaskRouter.php       Valida la petición y la traduce a una llamada al modelo.
  Claude/ClaudeClient.php  Cliente HTTP de la Messages API (cURL).
  Claude/MessagesClient.php    Interfaz que consume TaskRouter (permite dobles/SDK).
  Claude/ModelCapabilities.php Qué parámetros acepta cada familia de modelos.
  Prompts/PromptRegistry.php   Todos los system prompts, en el servidor.
  Support/                 .env, límite de peticiones, lectura de datasets.
  Http/JsonResponse.php    Formato único de respuesta JSON.
assets/css/               tokens → base → components → una hoja por modo.
assets/js/
  main.js                 Arranque y router de modos.
  core/                   config, dom, storage, api, speech.
  lib/                    text.js (normalización y diff), srs.js (Leitner).
  modes/                  flashcards.js, conversation.js, reading.js.
storage/                  Contadores del límite de peticiones. No se sirve.
```

### Decisiones que conviene conocer

**La clave nunca sale del servidor.** El navegador llama a `api/claude.php`, no a
`api.anthropic.com`.

**El cliente no envía prompts, envía tareas.** El endpoint acepta un `task` de una
lista cerrada (`conversation.reply`, `conversation.feedback`, `reading.passage`) más
los datos mínimos. Los prompts se construyen en `PromptRegistry`. Así el endpoint no
es un relay genérico de Claude que cualquiera pueda usar con nuestra clave para otra
cosa, y afinar el tono del interlocutor no requiere desplegar JS.

**El contenido es JSON, no código.** `data/*.json` es la única fuente de verdad para
los prompts del servidor y para el render del cliente. `index.php` proyecta al
navegador una versión sin el campo `context` de cada escenario, que sólo sirve para
el prompt.

**El progreso vive en `localStorage`** detrás de un adaptador asíncrono
(`core/storage.js`). El día que haga falta compartirlo entre dispositivos se cambia
el driver y ningún modo se toca.

**Hay límite de peticiones por IP** (`RATE_LIMIT_MAX` por `RATE_LIMIT_WINDOW`
segundos). El endpoint cuesta dinero por llamada: sin tope, una pestaña en bucle
vacía el saldo.

**`.env` tiene prioridad sobre las variables de entorno del sistema**, al contrario
de lo habitual. Es deliberado: `ANTHROPIC_MODEL` y `ANTHROPIC_API_KEY` son nombres
genéricos que otras herramientas definen, y se comprobó en esta máquina que un
`ANTHROPIC_MODEL` heredado del shell cambiaba en silencio el modelo al que llamaba
la aplicación. Si no hay `.env`, el entorno sigue funcionando como respaldo.

---

## Modelos y coste

Configurado por defecto en **`claude-haiku-4-5`**, el más barato y rápido.

| Modelo | $/millón entrada | $/millón salida |
|---|---|---|
| `claude-haiku-4-5` | 1 | 5 |
| `claude-sonnet-5` | 3 | 15 |
| `claude-opus-5` | 5 | 25 |

**El formato del ID lleva guiones, no puntos**: `claude-haiku-4-5`, nunca
`claude-haiku-4.5` (eso devuelve un error de modelo inexistente).

Se puede subir el modelo de una sola tarea. El feedback se genera **una vez por
llamada**, mientras la conversación consume un turno por frase, así que esto mejora
la corrección sin apenas mover la factura:

```
ANTHROPIC_MODEL=claude-haiku-4-5
MODEL_FEEDBACK=claude-sonnet-5
```

`ModelCapabilities` omite automáticamente los parámetros que el modelo elegido no
acepta (`output_config.effort` no existe en Haiku 4.5 ni Sonnet 4.5; el reintento en
modelo de respaldo sólo está publicado para Opus 5 y Fable 5). Cambiar de modelo en
`.env` no puede provocar un 400 por enviar un parámetro de más.

`max_tokens` está en 8000 para las tres tareas. Es un techo, no un gasto: se factura
lo que el modelo genera. Está holgado para que ningún modelo trunque a media frase,
incluidos los que razonan por defecto.

---

## Cómo extender

**Una tarjeta nueva para todos los alumnos** → añade una entrada a `data/deck.json`.
Al recargar se fusiona con el progreso existente sin borrar las tarjetas que el
alumno haya creado desde el formulario.

**Un escenario de llamada** → una entrada en `data/scenarios.json`:

```json
{
  "id": "audit",
  "category": "cliente",
  "initiator": "assistant",
  "title": "Auditoría de proveedor",
  "desc": "El cliente anuncia una auditoría y pide documentación.",
  "context": "You are a quality manager at a client of Cosmewax announcing an audit...",
  "opening": "Hi, this is Petra from LumaCare. We need to schedule a supplier audit."
}
```

`context` y `opening` sólo los ve el servidor y el prompt; `initiator: "user"` hace
que empiece el alumno (y entonces `context`/`opening` van a `null` y se usa `guide`).

**Un tema de lectura** → una entrada en `data/reading-topics.json`.

**Una categoría de tarjetas** → una entrada en `data/card-categories.json`. Aparece
sola en las pestañas y en el desplegable del formulario.

**Un modo nuevo** → un módulo en `assets/js/modes/` que exporte una fábrica con
`init/show/hide`, una entrada en `MODES` en `main.js` y un botón con su `data-mode`
en `index.php`. Si necesita al modelo: un `case` en `TaskRouter` y su prompt en
`PromptRegistry`.

---

## Contrato del endpoint

```
POST api/claude.php
Content-Type: application/json
X-Requested-With: CosmewaxEnglish     ← obligatoria; corta el uso cruzado

{ "task": "conversation.reply",   "scenarioId": "delay", "messages": [{"role":"user","text":"..."}] }
{ "task": "conversation.feedback","scenarioId": "delay", "messages": [...] }
{ "task": "reading.passage",      "topicId": "pro" }

200 → { "ok": true,  "text": "..." }
4xx/5xx → { "ok": false, "error": { "code": "...", "message": "..." } }
```

Códigos de error relevantes: `invalid_request` (400), `forbidden` (403),
`rate_limited` (429), `usage_limit` (503, tope de gasto de la cuenta),
`not_configured` (503, falta la clave), `network` / `server_error` (502).

Los detalles crudos de la API sólo se devuelven al navegador con `APP_DEBUG=1`;
en el resto de casos van al log de errores de PHP con su `request_id`.

---

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `usage_limit` / "límite de gasto" | La cuenta de Anthropic ha llegado a su tope. Se revisa en la consola de Anthropic, no en el código. |
| `not_found` / "el modelo no existe" | ID mal escrito en `ANTHROPIC_MODEL`. Guiones, no puntos. |
| Aviso "Falta la API key" con `.env` puesto | El fichero se llama `.env` exactamente (no `.env.txt`) y está en la raíz del proyecto. Verifica con `api/health.php`. |
| "Micrófono no disponible en esta dirección" | Origen no seguro. Ver § *El micrófono exige un origen seguro*. |
| El micrófono no aparece estando en localhost | Navegador sin Web Speech API. Usa Chrome o Edge; por texto funciona igual. |
| Se ve `<?php` en el navegador | Estás abriendo el fichero, no la URL. Tiene que ser `http://localhost/...`, con Apache arrancado. |
