# EsqueleticPHP

Esqueleto base para nuevas aplicaciones web internas con autenticación Active Directory.

Incluye de serie: login con autenticación contra Active Directory, topbar corporativa con badge de entorno, panel de ayuda deslizante y estilos listos para extender.

---

## Características

- **Login AD** — autenticación via LDAP bind (sin almacenar contraseñas)
- **Topbar** — logo, nombre de app, badge de entorno (DEV / TEST / PROD), usuario activo y enlace de cierre de sesión
- **Foto de perfil** — opcionalmente, la topbar muestra la foto de perfil real, nombre y cargo del usuario vía Microsoft Graph (con fallback a iniciales)
- **Panel de ayuda** — sidebar deslizante con búsqueda en tiempo real, secciones expandibles, lightbox y redimensionado persistente
- **Badge de entorno** — controlado por `APP_ENVIRONMENT` en `.env`, sin tocar código
- **Tema oscuro / claro** — toggle persistente (localStorage) en topbar y login; sin flash al cargar gracias al anti-flash script en `<head>`
- **CSS modular** — variables de color, topbar, tarjetas, tablas, filtros, badges de estado
- **Protección de rutas** — `index.php` redirige a login si no hay sesión activa

---

## Estructura de ficheros

```
EsqueleticPHP/
├── .env                    ← configuración local (AD, nombre de app, entorno)
├── .env.example            ← plantilla sin credenciales reales
├── .gitignore
│
├── login.php               ← formulario de acceso
├── auth.php                ← valida credenciales via LDAP → crea sesión
├── index.php               ← panel principal (protegido por sesión)
├── logout.php              ← destruye sesión
├── graph.php               ← helper Microsoft Graph (foto y datos de perfil)
│
├── assets/
│   └── css/
│       └── login.css       ← estilos de la página de login
│
├── css/
│   ├── index.css           ← estilos globales + topbar + badges de entorno
│   ├── help-panel.css      ← panel de ayuda deslizante
│   ├── Filtro/             ← estilos de filtros y Select2
│   ├── Tabla/              ← tabla sticky, columnas, etiquetas de departamento
│   ├── Tarjetas/           ← tarjetas de estadísticas
│   └── Formatos/           ← badges de estado
│
├── js/
│   └── help-panel.js       ← lógica del panel de ayuda
│
└── Docs/
    └── ARQUITECTURA.md     ← diagrama de flujo y documentación técnica
```

---

## Instalación y configuración

### Requisitos
- XAMPP 8.x (PHP 8.1+, Apache)
- Extensión PHP `ldap` habilitada
- Acceso de red al servidor AD

### Puesta en marcha

1. Copiar la carpeta en `C:\xampp\htdocs\NombreApp`
2. Copiar `.env.example` → `.env` y completar los valores:

```env
AD_HOST=tudominio.local
AD_PORT=389
AD_DOMAIN=tudominio.local
AD_BASE_DN=DC=tudominio,DC=local

APP_NAME=NombreApp
APP_ENVIRONMENT=Desarrollo

# Foto de perfil en la topbar (opcional — ver sección más abajo)
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_UPN_DOMAIN=tudominio.com
```

3. Abrir `http://localhost/NombreApp/login.php`
4. Introducir usuario de red (solo el nombre corto, sin dominio: `usuario` en lugar de `dominio\usuario`)

---

## Badge de entorno

El valor de `APP_ENVIRONMENT` en `.env` determina el color del badge en la topbar:

| Valor en `.env`                        | Badge  | Color   |
|----------------------------------------|--------|---------|
| `Desarrollo` / `Development` / `Dev`   | DEV    | Ámbar   |
| `Staging` / `Test`                     | TEST   | Morado  |
| `Producción` / `Production` / `Prod`   | PROD   | Verde   |

---

## Foto de perfil (Microsoft Graph)

De forma **opcional**, la topbar puede mostrar la foto de perfil real, el nombre para mostrar y el cargo del usuario autenticado, leídos de Microsoft 365 / Entra ID vía Microsoft Graph. Si no se configura, la topbar muestra las iniciales del usuario de red (sin romper nada).

### Cómo funciona

1. Tras el login, `index.php` construye el UPN del usuario como `usuario@GRAPH_UPN_DOMAIN`.
2. `graph.php` pide un token de aplicación (client credentials) y consulta a Graph el perfil (`displayName`, `jobTitle`, `department`, `mail`) y la foto (`/photo/$value`).
3. El resultado se **cachea en la sesión** (`$_SESSION['profile']`): solo se llama a Graph una vez por sesión, no en cada carga.
4. Se consulta **únicamente al usuario de la sesión** — no hay endpoint público que permita volcar la foto de otros usuarios.

### Configuración

En el `.env`:

| Variable              | Descripción                                                              |
|-----------------------|--------------------------------------------------------------------------|
| `GRAPH_TENANT_ID`     | ID del tenant de Entra ID                                                |
| `GRAPH_CLIENT_ID`     | ID de la aplicación registrada en Entra ID                               |
| `GRAPH_CLIENT_SECRET` | Secreto de cliente de esa aplicación                                     |
| `GRAPH_UPN_DOMAIN`    | Dominio para construir el UPN a partir del usuario de red (`cosmewax.com`)|

Requiere una app registrada en Entra ID con permiso de **aplicación** `User.Read.All` (y consentimiento de admin). Si las tres primeras variables están vacías, la feature se desactiva sola.

> Requisitos PHP: extensiones `curl` y `mbstring` habilitadas.

---

## Tema oscuro / claro

El esqueleto incluye un toggle de tema persistente en la topbar (app principal) y en el card del login.

- El tema se guarda en `localStorage` con la clave `siteTheme` (`'light'` / `'dark'`).
- Un script anti-flash en `<head>` aplica el tema guardado **antes** de que el navegador pinte, evitando el parpadeo blanco.
- Valores por defecto: **claro**. El oscuro sobreescribe las variables CSS via `html[data-theme="dark"]`.
- El botón del login usa **SVG inline** (no depende de Font Awesome) para renderizar al instante.

---

## Extender el esqueleto

1. **Contenido** — añadir HTML dentro del bloque `<!-- contenido -->` en `index.php`
2. **CSS** — crear módulos en `css/` siguiendo el patrón existente
3. **JS** — añadir scripts en `js/` y enlazarlos al final de `index.php`
4. **API backend** — crear ficheros PHP en `Api/` que devuelvan JSON
5. **Panel de ayuda** — editar las secciones `.help-section` en `index.php`

---

## Seguridad

- Las contraseñas **nunca** se almacenan — solo se usan para el bind LDAP puntual
- El `.env` está en `.gitignore` — nunca sube al repositorio
- `index.php` verifica la sesión en cada carga y redirige al login si no existe
- `auth.php` solo acepta `POST` y bloquea caracteres nulos/newlines en el username
- La foto de perfil se consulta **solo para el usuario de la sesión** y se cachea en `$_SESSION` — no se expone ningún endpoint que permita volcar la foto de otros usuarios del tenant
