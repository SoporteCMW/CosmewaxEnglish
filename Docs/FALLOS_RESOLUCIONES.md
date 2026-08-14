# Histórico de fallos y resoluciones

Registro cronológico inverso (más reciente primero) de bugs detectados,
su causa raíz y cómo se resolvieron.

---

## 2026-08-14 — El turno dictado en Conversación se enviaba vacío

**Síntoma**: En Conversación, al responder por voz aparecía el aviso "Enviando automáticamente…", pasaba el segundo y pico y **no se enviaba nada**: la barra desaparecía, el campo quedaba en blanco y la conversación no avanzaba. Cancelar tampoco servía de nada, porque dejaba el campo vacío en lugar de la transcripción para corregirla. Escribiendo a mano sí funcionaba, que es lo que hacía difícil de ver el fallo.

**Causa raíz**: El chat se repinta entero (`el.body.innerHTML = chatHtml()`), lo que reconstruye el `<input id="convInput">`. Ese input no llevaba atributo `value`, así que cada repintado lo devolvía vacío. El reconocedor escribía la transcripción en el elemento y acto seguido `scheduleAutoSend()` repintaba para sacar el aviso — destruyendo justo lo que se acababa de dictar. Al vencer el temporizador, `sendTurn()` leía el campo, lo encontraba vacío y salía sin enviar. Escribir a mano no lo sufría porque teclear no provoca ningún repintado.

Ya existía en el prototipo de un solo fichero (`english_unblocked_v12.html`) y llegó al portarlo; `v13` lo corrigió allí con una variable `convPendingTranscript`, y de ahí salió detectarlo aquí.

**Resolución**: El texto sin enviar pasa a vivir en el estado del modo (`state.draft`), no sólo en el DOM. El campo se dibuja con `value="${escapeHtml(state.draft)}"`, el evento `input` mantiene el borrador al día, el resultado del dictado lo escribe **antes** de repintar y se limpia al enviar, al cambiar de escenario y al terminar. Cubierto con una prueba de regresión que recorre dictar → enviar solo, dictar → cancelar → corregir → enviar, y escribir → repintar.

**Prevención**: En un modo que repinta por `innerHTML`, **cualquier valor que el alumno introduzca tiene que estar en el estado**, no sólo en el elemento; el `<input>` se dibuja desde ahí. La regla vale para todo lo que sobreviva a un repintado (texto, foco, scroll). Se revisaron los otros cuatro modos con micrófono: Tarjetas, Listening y Pronunciación leen el campo sin repintar por medio y Lectura no tiene campo, así que ninguno estaba afectado. Al escribir pruebas con DOM simulado, **no guardar la referencia a un elemento entre repintados**: hay que volver a buscarlo, como hace el navegador, o el fallo se esconde.

---

## 2026-08-14 — El recorte de escenarios generados nunca llegaba a ejecutarse

**Síntoma**: Ninguno visible para el usuario. Salió al probar la tarea nueva `scenario.everyday`: cada generación dejaba en el log `no se pudo recortar el histórico: SQLSTATE[42000] ... El número de filas proporcionadas para una cláusula OFFSET debe ser un entero`. El tope de 60 escenarios por persona (`GeneratedScenarioRepository::trim()`) llevaba desde su escritura sin aplicarse, así que la tabla `dbo.scenario` podía crecer sin límite por usuario.

**Causa raíz**: La consulta usaba `OFFSET ? ROWS` con el valor pasado como parámetro en `execute()`. El driver ODBC de SQL Server liga los marcadores como texto (`NVARCHAR`) y `OFFSET` exige un entero, así que rechazaba la sentencia. El error estaba envuelto en un `try/catch` que lo mandaba al log y seguía — correcto para no romper la generación, pero también la razón de que pasara desapercibido tanto tiempo.

**Resolución**: Interpolar la constante de clase en el SQL en lugar de pasarla como parámetro, dejando el `generated_by` (lo único que viene de fuera) como parámetro:
```php
// src/Db/GeneratedScenarioRepository.php — trim()
'... ORDER BY created_at DESC OFFSET ' . self::MAX_SCENARIOS . ' ROWS'
$stmt->execute([$this->user]);
```
Verificado invocando `trim()` por reflexión: ya no registra error y no borra nada por debajo del tope.

**Prevención**: En SQL Server, `TOP`, `OFFSET` y `FETCH NEXT` no admiten parámetros ligados por este driver — van interpolados, y por eso el valor debe ser siempre una constante del código, nunca entrada del usuario. Y cuando un `catch` sólo escribe en el log, conviene revisar el log después de ejercitar el camino: un fallo silencioso puede durar meses.

---

## 2026-07-25 — `git pull` fallaba con "refusing to merge unrelated histories"

**Síntoma**: `git pull` abortaba con `fatal: refusing to merge unrelated histories`. La rama local y `origin/main` aparecían divergidas (4 y 1 commits) y `git merge-base` no devolvía nada.

**Causa raíz**: El repositorio se había inicializado dos veces por separado — un `git init` local (raíz `6a27af7 Initial commit`, con 4 commits de trabajo real) y un `first commit` distinto creado aparte en GitHub (`06fc4f7`, subido probablemente desde un ZIP descargado: incluía una carpeta duplicada `EsqueleticPHP-main/` con el proyecto entero dentro de sí mismo). Al no compartir commit raíz, Git trata ambas historias como "no relacionadas" y se niega a fusionarlas por defecto.

**Resolución**: Se verificó por hash (MD5, archivo por archivo) que el snapshot de GitHub era **superconjunto** del local — contenía todo el trabajo local (login opcional, ITIL, README sin datos sensibles) más las features `graph.php` y `FotoPerfil/`. Con copia de seguridad previa del usuario, se alineó el local al remoto (`git reset --hard origin/main`), se eliminó la carpeta duplicada `EsqueleticPHP-main/` y se subió un commit de limpieza. Desde entonces ambas ramas comparten historia y `pull`/`push` funcionan como fast-forward.

**Prevención**: Nunca inicializar el repo por segundo lado (evitar "Add a README" al crear el repo en GitHub si ya existe historia local, y no subir un ZIP como commit paralelo). Para vincular local ↔ remoto nuevo: crear el repo **vacío** en GitHub y usar `git remote add` + `git push -u`. Si vuelve a aparecer "unrelated histories", identificar cuál es la historia canónica y comparar contenidos **antes** de recurrir a `--allow-unrelated-histories`.

---

## 2026-06-09 — Regex de username bloqueaba usuarios AD válidos

**Síntoma**: Al intentar hacer login, el formulario devolvía inmediatamente "Nombre de usuario no válido." sin llegar a intentar el bind LDAP.

**Causa raíz**: El regex `/^[\w.\-]+$/u` solo permitía ASCII puro (letras, dígitos, punto, guion, barra baja). Cualquier nombre de usuario con caracteres fuera de ese set — incluyendo nombres con acentos u otros caracteres válidos en el dominio — era rechazado antes de contactar con el AD.

**Resolución**: Reemplazado el regex restrictivo por una validación mínima que solo bloquea bytes nulos y saltos de línea, los únicos vectores reales de inyección en un LDAP bind simple (no en una búsqueda con filtro):
```php
// auth.php — línea 42
if (preg_match('/[\x00\n\r]/', $username)) { ... }
```

**Prevención**: Para LDAP bind con UPN (`usuario@dominio`), no se necesita whitelist de caracteres. Solo bloquear `\x00`, `\n`, `\r`. Si se añade búsqueda LDAP con filtro en el futuro, usar `ldap_escape()` en los valores que vayan dentro del filtro.

---
