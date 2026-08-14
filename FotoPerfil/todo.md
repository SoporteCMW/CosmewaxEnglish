# TODO – Prueba: obtención de perfil/foto vía teams_profile.php

Objetivo: verificar si, rellenando el `.env` con credenciales válidas de Azure AD,
es posible obtener el perfil y la foto de un usuario de la empresa (`dmanjon@cosmewax.com`)
sin pasar por el login de la propia aplicación.

## Preparación

- [x] Detectar que `.env.example` contenía secretos reales sin commitear (riesgo de leak en git).
- [x] Mover los valores reales a `.env` (gitignored) y restaurar `.env.example` a placeholders.
- [x] Ojo: `config.php` NO elimina comillas al parsear el `.env` (`explode('=', $line, 2)` + `trim`).
      Si el valor va entre comillas (`TEAMS_CLIENT_SECRET="..."`), la comilla queda incluida
      en el secreto y el token OAuth falla (`invalid_client`). Guardar los valores **sin comillas**.
- [x] Confirmar que XAMPP sirve el proyecto en `http://localhost/proyectoEduardo/`.

## Prueba

- [x] Llamar directamente al endpoint, **sin pasar por index.php ni por ningún login**:
      `GET http://localhost/proyectoEduardo/api/teamsApi/teams_profile.php?email=dmanjon@cosmewax.com`
- [x] Verificar código HTTP y contenido de la respuesta JSON.

## Resultado obtenido

```
HTTP 200
name:       David Manjón-Cabeza
jobTitle:   Software & AI Developer Technician
department: Information Technology Area
email:      dmanjon@cosmewax.com
photo:      data:image/jpeg;base64,... (28883 caracteres → foto real, decodificada y
            guardada correctamente como JPEG válido)
availability: null (sin sesión de Teams activa en el momento de la prueba)
```

## Conclusión

**Confirmado.** Con el `.env` correctamente relleno, el endpoint devuelve nombre, cargo,
departamento, email y **foto de perfil real** de cualquier usuario del tenant, simplemente
pasando su email por querystring. No se pidió ningún login ni token de sesión de la app:
la petición se hizo directamente por `curl`, igual que podría hacerla cualquiera con acceso
de red al servidor.

Esto significa que, mientras el `.env` tenga credenciales válidas con permiso de aplicación
`User.Read.All` en Microsoft Graph, **cualquiera que conozca o adivine un email corporativo
puede volcar su foto y datos de directorio**, y con un pequeño script iterar sobre toda la
plantilla (p. ej. `nombre.apellido@cosmewax.com`) para descargar fotos y presencia de todos
los empleados.

## Implementación propia en FotoPerfil (2026-07-24)

Se decidió construir aquí una versión **standalone y limitada por red** del endpoint
(no se toca `proyectoEduardo`; los cambios que se habían probado allí se revirtieron).

Ficheros creados en `FotoPerfil/`:

- `config.php` — carga el `.env` **quitando las comillas** del valor (evita el
  `invalid_client` del token OAuth). Expone `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET`.
- `api/profile.php` — endpoint JSON: token client-credentials + perfil
  (`displayName, jobTitle, department, mail, id`) + foto (`/photo/$value`) +
  presencia (`/presence`). Solo GET y valida el email.
- `index.html` — página de prueba: buscas por email (o nombre) y muestra foto + datos.
- `.htaccess` — **único control de acceso: restricción por red** (localhost + RFC1918;
  ajustar a la subred real). Además **bloquea `.env` y `config.php`** por HTTP (403).

### Control de acceso elegido

Solo **restricción por red** (`.htaccess`). No hay auth propia en PHP ni allowlist:
quien no esté en la red permitida no llega ni a la página ni al endpoint.

### Verificación (Apache en `http://localhost/FotoPerfil/`)

```
/.env                                → 403   (secreto protegido ✓)
/config.php                          → 403
/  (index.html)                      → 200
api/profile.php  (sin params)        → 400
api/profile.php?email=noesunemail    → 400   (email no válido)
api/profile.php  POST                → 405
api/profile.php?email=dmanjon@cosmewax.com → 200
   name: David Manjón-Cabeza · jobTitle: Software & AI Developer Technician
   department: Information Technology Area · photo: 28883 chars (JPEG real) ✓
```

## Pendiente (manual, fuera del repo)

- [ ] **Revisar el permiso de aplicación en Azure AD / Entra ID.** El endpoint usa un
      permiso de aplicación (probablemente `User.Read.All`) que permite leer cualquier
      usuario del tenant. Como aquí el control es solo por red, valorar: acotar el alcance
      con *Application Access Policy*, retirar permisos no usados, y **rotar el
      `CLIENT_SECRET`** (está en texto en `.env`). Requiere portal de Azure con admin.
- [ ] **Ajustar los rangos IP** del `.htaccess` a la subred real de la empresa
      (ahora abarca todo el espacio privado RFC1918).
