# Arquitectura — EsqueleticPHP

Documentación técnica del esqueleto base para aplicaciones PHP internas de Cosmewax.

---

## Flujo de autenticación

```mermaid
sequenceDiagram
    actor U as Usuario
    participant L as login.php
    participant A as auth.php
    participant AD as Active Directory<br/>(cosmewax.local:389)
    participant S as Sesión PHP
    participant I as index.php

    U->>L: GET /login.php
    L-->>U: Formulario de acceso

    U->>A: POST /auth.php<br/>{username, password}
    A->>A: Valida campos vacíos<br/>y caracteres peligrosos

    A->>AD: ldap_connect("ldap://cosmewax.local:389")
    A->>AD: ldap_bind("usuario@cosmewax.local", password)

    alt Credenciales AD incorrectas
        AD-->>A: bind FAIL
        A-->>U: Location: login.php?error=...
        L-->>U: Formulario + mensaje de error
    else Credenciales AD correctas
        AD-->>A: bind OK
        A->>S: session_regenerate_id()<br/>$_SESSION[logged_in, user, login_at]
        A-->>U: Location: index.php
        U->>I: GET /index.php
        I->>S: Verifica $_SESSION[logged_in]
        I-->>U: Dashboard (topbar + contenido)
    end
```

**Ejemplo real:**
- Input: usuario `soporteit`, contraseña de red Windows
- `auth.php` construye UPN: `soporteit@cosmewax.local`
- Bind LDAP en `cosmewax.local:389` → OK
- Si OK → `$_SESSION['user'] = 'soporteit'` → redirect a `index.php`

---

## Flujo de cierre de sesión

```mermaid
sequenceDiagram
    actor U as Usuario
    participant I as index.php
    participant LO as logout.php
    participant S as Sesión PHP
    participant L as login.php

    U->>I: Clic en "Salir"
    I->>LO: GET /logout.php
    LO->>S: $_SESSION = []
    LO->>S: session_destroy()
    LO->>S: Elimina cookie de sesión
    LO-->>U: Location: login.php
    U->>L: GET /login.php
    L-->>U: Formulario limpio
```

---

## Foto de perfil en la topbar (Microsoft Graph)

Feature **opcional**: si el `.env` trae credenciales `GRAPH_*`, la topbar muestra la foto de perfil real, el nombre para mostrar y el cargo del usuario autenticado (leídos de Microsoft 365 / Entra ID). Si faltan, cae al fallback de iniciales sin romper nada. La lógica reutilizable vive en `graph.php`; el sub-proyecto `FotoPerfil/` es una prueba de concepto aislada de la misma idea.

```mermaid
flowchart TD
    A[index.php tras login] --> B{loginOn + sesión activa<br/>y perfil no cacheado?}
    B -- No --> Z[Usa $_SESSION.profile cacheado<br/>o iniciales]
    B -- Sí --> C[graph_config lee GRAPH_* del .env]
    C --> D{graph_is_configured?}
    D -- No --> F[profile = false<br/>→ fallback iniciales]
    D -- Sí --> E[Construye UPN:<br/>usuario@GRAPH_UPN_DOMAIN]
    E --> G[graph_fetch_profile:<br/>token client-credentials +<br/>perfil y foto vía Graph]
    G --> H[Cachea en $_SESSION.profile]
    H --> I[Topbar: foto + nombre + cargo]
    F --> J[Topbar: iniciales del usuario]
```

**Ejemplo real:**
- Input: usuario de sesión `dmanjon`, `GRAPH_UPN_DOMAIN=cosmewax.com`
- UPN construido: `dmanjon@cosmewax.com`
- `graph_fetch_profile` → `{name, jobTitle, photo (data URI)}` → cacheado en `$_SESSION['profile']`
- Output: topbar con foto circular + nombre + cargo
- Si `GRAPH_CLIENT_SECRET` está vacío → `profile = false` → topbar con iniciales `DM`

**Seguridad:** la foto se consulta **solo para el usuario de la sesión** y se cachea en `$_SESSION` (una llamada por sesión, no por carga). No hay endpoint público que permita volcar la foto de otros usuarios del tenant.

---

## Estructura de componentes

```mermaid
classDiagram
    class login_php {
        +Muestra formulario HTML
        +Lee APP_NAME desde .env
        +Redirige si sesión activa
        +Muestra error desde ?error=
    }

    class auth_php {
        +Solo acepta POST
        +Lee .env (AD_HOST, AD_DOMAIN)
        +Valida username y password
        +LDAP bind vs cosmewax.local
        +Crea sesión PHP
        +Redirige según resultado
    }

    class index_php {
        +Verifica sesión (guard)
        +Lee .env (APP_NAME, APP_ENVIRONMENT)
        +Renderiza topbar con env badge
        +Renderiza help panel
        +Muestra usuario activo
        +Perfil/foto vía graph.php (opcional)
        +Enlace logout.php
    }

    class graph_php {
        +graph_config() lee GRAPH_* del .env
        +graph_is_configured() bool
        +graph_fetch_profile(upn)
        +Token client-credentials
        +Cachea perfil en $_SESSION
    }

    class logout_php {
        +Destruye sesión completamente
        +Elimina cookie de sesión
        +Redirige a login.php
    }

    class env_file {
        +AD_HOST: cosmewax.local
        +AD_PORT: 389
        +AD_DOMAIN: cosmewax.local
        +AD_BASE_DN: DC=cosmewax,DC=local
        +APP_NAME: string
        +APP_ENVIRONMENT: string
        +AUTO_REFRESH_INTERVAL_MS: int
        +GRAPH_TENANT_ID: string (opcional)
        +GRAPH_CLIENT_ID: string (opcional)
        +GRAPH_CLIENT_SECRET: string (opcional)
        +GRAPH_UPN_DOMAIN: string
    }

    login_php --> auth_php : POST
    auth_php --> index_php : redirect (OK)
    auth_php --> login_php : redirect (KO)
    index_php --> logout_php : enlace Salir
    index_php ..> graph_php : require (perfil opcional)
    logout_php --> login_php : redirect
    auth_php ..> env_file : readEnv()
    index_php ..> env_file : readEnv()
    graph_php ..> env_file : readEnv() GRAPH_*
    login_php ..> env_file : readEnv() APP_NAME
```

---

## Badge de entorno

```mermaid
flowchart LR
    E[APP_ENVIRONMENT<br/>en .env] --> M{match strtolower}
    M -->|desarrollo / development / dev| D["🟡 DEV<br/>clase: env-dev<br/>color: ámbar"]
    M -->|staging / test| S["🟣 TEST<br/>clase: env-staging<br/>color: morado"]
    M -->|producción / production / prod| P["🟢 PROD<br/>clase: env-prod<br/>color: verde"]
    M -->|otro valor| X["⚪ UPPERCASE del valor<br/>clase: env-dev"]
```

---

## Active Directory — Servidores LDAP

| Servidor                   | Sitio         | Rol |
|----------------------------|---------------|-----|
| `CMW0010.cosmewax.local`   | SITIOJEREZ    | PDC |
| `CMWSCD0001.cosmewax.local`| SITIOVALENCIA |     |
| `CMWPZ0001.cosmewax.local` | SITIOPUZOL    |     |
| `CMWPZ0010.cosmewax.local` | SITIOPUZOL    |     |

Usando `AD_HOST=cosmewax.local`, el DNS del dominio reparte la carga entre los DCs disponibles automáticamente.

---

## CSS — Variables corporativas

Definidas en `css/index.css`:

| Variable              | Valor     | Uso                          |
|-----------------------|-----------|------------------------------|
| `--corp-primary`      | `#587587` | Topbar, botones, acentos     |
| `--corp-primary-dark` | `#46606F` | Hover de botones             |
| `--corp-primary-light`| `#7A95A6` | Iconos, textos secundarios   |
| `--corp-bg`           | `#F0F2F5` | Fondo general de la página   |
| `--corp-bg-soft`      | `#F8F9FB` | Fondos de secciones/cards    |
| `--corp-text`         | `#1A202C` | Texto principal              |
| `--corp-text-soft`    | `#6B7888` | Texto secundario/placeholders|
| `--corp-border`       | `#E2E5EB` | Bordes de cards y tablas     |
