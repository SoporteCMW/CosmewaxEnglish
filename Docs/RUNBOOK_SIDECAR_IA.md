# Runbook — Reactivar el servidor de IA (claude-sidecar)

**Host afectado:** `10.0.70.32:5060` (Ubuntu 22.04) · **Servicio:** `claude-sidecar` (Flask)
**Diagnóstico realizado:** 2026-08-20, ~10:05, desde `cosmewaxdevjd` (10.0.70.95)
**Alcance:** afecta a **todos** los proyectos que usan el sidecar, no sólo a English Unblocked.

---

## Resumen en una línea

El servicio **no está caído**: Flask responde. Lo que falla es el **CLI de Claude**
que hay detrás, que arranca y termina con error en ~1 segundo. Es un problema de
**credenciales del CLI en el host**, y se arregla en `10.0.70.32`, no en el
servidor de la aplicación.

---

## 1. Evidencia del diagnóstico

Todo esto ya está comprobado; no hace falta repetirlo. Se incluye para que quien
entre al host sepa de dónde se parte.

| Prueba | Resultado |
|---|---|
| `ping 10.0.70.32` | responde, 0 % de pérdida |
| `GET http://10.0.70.32:5060/health` | `{"service":"claude-sidecar","status":"ok"}` — **200 en 4 ms** |
| `POST http://10.0.70.32:5060/claude` | **500** `{"error":"claude devolvio error"}` en **1,07–1,20 s** |
| Igual, **sin** campo `model` | mismo 500 en 1,07 s |
| Igual, con `claude-haiku-4-5` | mismo 500 en 1,08 s |
| Igual, con `claude-sonnet-4-6` | mismo 500 en 1,15 s |
| `api/health.php` de la aplicación | `ai_ready:true`, `sidecar_reachable:true`, `db_reachable:true` |
| Log de Apache | errores `[ai] ... (server_error)` desde las **09:11** hasta las **10:02**, desde varios equipos distintos |

Comando para reproducirlo desde cualquier equipo de la LAN:

```bash
curl -s -X POST http://10.0.70.32:5060/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Di exactamente: SIDECAR_OK","timeout":30}'
```

### Qué queda descartado

- **No es la red ni el firewall** — el host responde a ping y `/health` contesta en 4 ms.
- **No es el nombre del modelo** — falla exactamente igual **sin** el parámetro
  `model`. Además `claude-sonnet-4-6` es un identificador válido y correcto.
- **No es la configuración de la aplicación** — `IA_CLI=true`, la URL es la
  correcta y la app llega al servicio sin problema.
- **No es una caída limpia del servicio** — si el proceso estuviera parado,
  tendríamos error de conexión, no un 500 con cuerpo JSON.

### Por qué apunta a las credenciales

El código del sidecar hace esto:

```python
cmd = [_CLAUDE_BIN, '-p', prompt]
if model:
    cmd += ['--model', model]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
if result.returncode != 0:
    return jsonify({'error': result.stderr.strip() or 'claude devolvio error'}), 500
```

Que nos llegue el texto literal `claude devolvio error` significa que
**`returncode != 0` y `stderr` venía vacío**: el CLI arranca, no escribe nada en
error estándar y termina mal, en un segundo. Esa es la firma de una **sesión del
CLI caducada** (o de una cuota agotada), no de un fallo de ejecución. La propia
documentación del sidecar lo recoge: *"si la sesión del CLI caduca, todas las
llamadas empiezan a devolver 500 claude devolvio error"*.

Encaja con el histórico: esta misma mañana varias llamadas **sí** funcionaron
(66 s, 32 s y 44 s en tres pruebas distintas) mientras otras ya fallaban desde
las 09:11. Se fue degradando hasta fallar el 100 %.

---

## 2. Antes de empezar

- Acceso SSH a `10.0.70.32` con permisos `sudo`.
- Un navegador a mano: la reautenticación imprime una URL y hay que pegar un código.
- Saber que **el HOME importa**: `subprocess.run` hereda el entorno del proceso
  del servicio, y las credenciales del CLI viven en el **HOME del usuario que
  ejecuta el servicio**. Autenticarse como `root` cuando el servicio corre con
  otro usuario **no arregla nada** — es el error clásico en esta avería.

---

## 3. Paso 1 — Identificar el servicio y su usuario

```bash
ssh <tu-usuario>@10.0.70.32

systemctl list-units --type=service | grep -i claude
systemctl cat claude-sidecar      # fíjate en User=, Environment=, EnvironmentFile=, WorkingDirectory=
sudo ss -ltnp | grep 5060         # si no es systemd (nohup/screen/tmux): qué PID y qué usuario escucha
```

**Anota el usuario del servicio.** Todos los pasos siguientes se hacen con ese
usuario. En el resto del documento aparece como `<usuario-servicio>`.

---

## 4. Paso 2 — Ver el error real

Este paso es el que decide todo lo demás: el mensaje que a la aplicación le llega
vacío, aquí se ve entero.

```bash
sudo -u <usuario-servicio> -H claude -p "di OK"; echo "exit=$?"
```

> El `-H` es **obligatorio**: fija el HOME de ese usuario. Sin él, el CLI busca
> las credenciales donde no están y el diagnóstico sale falso.
> Si la unidad de systemd define un `Environment=HOME=...` distinto, replícalo aquí.

| Lo que salga | Qué significa | Ir a |
|---|---|---|
| `Invalid API key`, `Please run /login`, o similar | Sesión caducada — **la causa más probable** | Paso 3 |
| `usage limit reached` / rate limit | Cuota agotada de la cuenta | Esperar al reset, o pasar a clave de API (opción C) |
| `command not found` | El PATH de systemd es mínimo y no encuentra el binario | Paso 3 bis |
| Error de permisos sobre `~/.claude` | HOME mal configurado o permisos rotos | Paso 3 bis |
| `exit=0` y responde bien | El CLI está sano: el problema es del servicio → reinícialo (Paso 4) y vuelve a probar |

---

## 5. Paso 3 — Reautenticar el CLI

Siempre **con el usuario del servicio**. Tres opciones, de más a menos recomendable
para un servicio desatendido:

### Opción A — Token de larga duración (recomendada)

```bash
sudo -u <usuario-servicio> -H claude setup-token
```

Imprime una URL. La abres en tu navegador, autenticas y pegas el código que te da.
Queda guardado en el perfil de ese usuario y **no caduca cada pocos días** como la
sesión interactiva, que es justo lo que ha provocado esta avería.

### Opción B — Login interactivo

```bash
sudo -u <usuario-servicio> -H claude
# ya dentro:
/login
```

### Opción C — Clave de API en la unidad de systemd

No caduca nunca, pero **factura a la cuenta de API** (la suscripción del CLI no).

```ini
# /etc/systemd/system/claude-sidecar.service
[Service]
Environment=ANTHROPIC_API_KEY=sk-ant-...
# Mejor todavía, fuera de la unidad y con permisos restringidos:
# EnvironmentFile=/etc/claude-sidecar.env      (chmod 600, propietario root)
```

`ANTHROPIC_API_KEY` tiene **prioridad** sobre el perfil OAuth: si la pones, manda ella.

### Paso 3 bis — Si el problema era el PATH o el HOME

```ini
# /etc/systemd/system/claude-sidecar.service
[Service]
User=<usuario-servicio>
Environment=HOME=/home/<usuario-servicio>
Environment=CLAUDE_PATH=/usr/local/bin/claude    # ruta absoluta: which claude
```

(`which claude` ejecutado con el usuario del servicio te da la ruta exacta.)

### Comprobación obligatoria antes de seguir

```bash
sudo -u <usuario-servicio> -H claude -p "di OK"; echo "exit=$?"
```

No pases al paso 4 hasta que esto dé **`exit=0`** y una respuesta con sentido.

---

## 6. Paso 4 — Reiniciar y verificar en el host

```bash
sudo systemctl daemon-reload            # sólo si has tocado la unidad
sudo systemctl restart claude-sidecar
sudo systemctl status claude-sidecar    # active (running)
```

> ⚠️ **Cuidado al verificar desde el propio host.** El sidecar filtra por prefijo
> de IP (`SIDECAR_ALLOWED_IPS`, por defecto `10.`). Si pruebas contra
> `127.0.0.1` te devolverá **403 forbidden** y parecerá que sigue roto. Usa la IP
> real del host:

```bash
curl -s -X POST http://10.0.70.32:5060/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Di exactamente: SIDECAR_OK","timeout":30}'
```

**Resultado esperado:** `{"text":"SIDECAR_OK"}`

---

## 7. Paso 5 — Verificar desde el servidor de la aplicación

Desde `cosmewaxdevjd` (o cualquier equipo de la LAN 10.x):

```bash
# 1. El sidecar responde de verdad
curl -s -X POST http://10.0.70.32:5060/claude -H "Content-Type: application/json" \
  -d '{"prompt":"Di exactamente: SIDECAR_OK","timeout":30}'

# 2. La aplicación lo ve
curl -s http://localhost/CosmewaxEnglish/api/health.php
#    → "ai_ready":true, "sidecar_reachable":true

# 3. Prueba funcional en la web: entra en Conversación o Listening y genera algo
```

**No hay que tocar nada en el servidor de la aplicación.** En cuanto el CLI vuelva
a autenticarse, los cuatro modos con IA funcionan solos: la app no cachea el
estado del servicio más de 60 segundos.

---

## 8. Si después de todo esto sigue fallando

Recoge esto antes de escalar:

```bash
sudo journalctl -u claude-sidecar -n 100 --no-pager
sudo -u <usuario-servicio> -H claude -p "di OK"; echo "exit=$?"
sudo -u <usuario-servicio> -H claude --version
sudo -u <usuario-servicio> -H ls -la ~/.claude
df -h /                      # un disco lleno también rompe el login del CLI
```

---

## Anexo A — Para que no vuelva a pasar

**1. `/health` está mintiendo.** Sólo comprueba que Flask está vivo: ha estado
devolviendo `status: ok` toda la mañana con el CLI muerto. La monitorización
tiene que hacer un **POST real a `/claude`**, no un GET a `/health`. Por ejemplo,
un cron cada 10 minutos:

```bash
*/10 * * * * curl -s -m 60 -X POST http://10.0.70.32:5060/claude \
  -H "Content-Type: application/json" \
  -d '{"prompt":"di OK","timeout":30}' | grep -q '"text"' \
  || echo "claude-sidecar KO" | mail -s "claude-sidecar KO" it@cosmewax.com
```

**2. El 500 es ciego a propósito.** El servicio descarta `stdout`, que es donde el
CLI escribe el motivo. Dos líneas habrían ahorrado toda la mañana de diagnóstico:

```python
if result.returncode != 0:
    detalle = result.stderr.strip() or result.stdout.strip() or 'claude devolvio error'
    app.logger.error('claude rc=%s: %s', result.returncode, detalle)
    return jsonify({'error': detalle}), 500
```

**3. Usa la opción A o la C del paso 3.** Una sesión interactiva caduca sola y
vuelve a tumbar todos los proyectos a la vez, sin aviso previo.

---

## Anexo B — Mientras el sidecar esté caído

English Unblocked **no está roto**: Tarjetas, Gramática y Pronunciación funcionan
igual, y los otros cuatro modos avisan en pantalla en lugar de fallar. Dos opciones
si la parada va para largo:

| Opción | Cómo | Efecto |
|---|---|---|
| Apagar la IA limpiamente | `IA_CLI=false` en `.env` | Los modos con IA dicen *"desactivados en el servidor"* en vez de *"no disponible, reinténtalo"*; la gente deja de reintentar en bucle. Se revierte con una línea. |
| Pasar a la API pública | `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=sk-ant-...` en `.env` (el modelo ya está en `claude-haiku-4-5`) | Los modos con IA vuelven hoy mismo, pero **consume presupuesto** de la cuenta de API. |

Tras cambiar el `.env` no hace falta reiniciar Apache: la configuración se lee en
cada petición.

---

## Anexo C — Datos de referencia

| Dato | Valor |
|---|---|
| Servicio | `claude-sidecar` (Flask), Ubuntu 22.04 |
| Host y puerto | `10.0.70.32:5060` |
| Endpoint de generación | `POST /claude` — body `{"prompt": "...", "timeout": 120, "model": "..."}` |
| Endpoint de salud | `GET /health` (**no** verifica el CLI) |
| Filtro de acceso | Por prefijo de IP, `SIDECAR_ALLOWED_IPS` (por defecto `10.`) — no hay usuario ni contraseña |
| Ruta al binario | `CLAUDE_PATH` (por defecto `claude`, se busca en el PATH) |
| Puerto de escucha | `SIDECAR_PORT` (por defecto `5060`) |
| Config del cliente | `.env` de cada proyecto: `IA_CLI`, `IA_CLI_URL`, `IA_CLI_MODEL`, `IA_CLI_TIMEOUT` |
| Timeout máximo admitido | 300 s |

**Códigos de error del sidecar y qué significan:**

| Código | Significado | Dónde se arregla |
|---|---|---|
| 403 `forbidden` | La IP de origen no empieza por `10.` (o estás probando desde `127.0.0.1`) | Cliente / `SIDECAR_ALLOWED_IPS` |
| 500 `claude devolvio error` | El CLI terminó con error y sin `stderr` → **credenciales o cuota** | Host de IA (este runbook) |
| 500 `claude CLI no encontrado en PATH` | Binario no localizable por el servicio | `CLAUDE_PATH` en la unidad |
| 504 `timeout tras Ns` | La generación tardó más que el `timeout` pedido | Subir el `timeout` del cliente (máx. 300) |

---

Cuando el incidente quede cerrado, conviene añadir una entrada a
[`FALLOS_RESOLUCIONES.md`](FALLOS_RESOLUCIONES.md) con la causa real que devolvió
el paso 2 y la opción de reautenticación que se aplicó.
