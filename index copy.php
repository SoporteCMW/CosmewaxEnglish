<?php
declare(strict_types=1);

session_start();

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

// ── Lectura de .env ───────────────────────────────────────────────────────────
$appName               = 'EsqueleticPHP';
$appEnvironment        = 'Desarrollo';
$autoRefreshIntervalMs = 300000;
$loginOn               = true;

$envPath = __DIR__ . '/.env';
if (is_file($envPath)) {
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;

        if (str_starts_with($line, 'APP_NAME=')) {
            $appName = trim(trim(substr($line, strlen('APP_NAME='))), '"\'');
        } elseif (str_starts_with($line, 'APP_ENVIRONMENT=')) {
            $appEnvironment = trim(trim(substr($line, strlen('APP_ENVIRONMENT='))), '"\'');
        } elseif (str_starts_with($line, 'AUTO_REFRESH_INTERVAL_MS=')) {
            $val = trim(trim(substr($line, strlen('AUTO_REFRESH_INTERVAL_MS='))), '"\'');
            if (ctype_digit($val) && (int)$val > 0) {
                $autoRefreshIntervalMs = (int)$val;
            }
        } elseif (str_starts_with($line, 'LOGIN_ON=')) {
            $val = strtolower(trim(trim(substr($line, strlen('LOGIN_ON='))), '"\''));
            $loginOn = !in_array($val, ['false', '0', 'no', 'off'], true);
        }
    }
}

// ── Protección: redirigir al login si no está autenticado ─────────────────────
if ($loginOn && empty($_SESSION['logged_in'])) {
    header('Location: login.php');
    exit;
}

// ── Badge de entorno ──────────────────────────────────────────────────────────
$envBadge = match (strtolower($appEnvironment)) {
    'desarrollo', 'development', 'dev' => ['label' => 'DEV',     'class' => 'env-dev'],
    'test', 'staging'                  => ['label' => 'TEST',    'class' => 'env-staging'],
    'producción', 'produccion',
    'production', 'prod'               => ['label' => 'PROD',    'class' => 'env-prod'],
    default                            => ['label' => strtoupper($appEnvironment), 'class' => 'env-dev'],
};

// ── Etiqueta legible del intervalo ────────────────────────────────────────────
$autoRefreshMinutes = $autoRefreshIntervalMs / 60000;
if ($autoRefreshMinutes >= 1) {
    $autoRefreshLabel = (fmod($autoRefreshMinutes, 1) == 0)
        ? sprintf('%d min', (int)$autoRefreshMinutes)
        : sprintf('%.1f min', $autoRefreshMinutes);
} else {
    $autoRefreshLabel = sprintf('%d s', (int)round($autoRefreshIntervalMs / 1000));
}

$currentUserRaw = $_SESSION['user'] ?? ($loginOn ? 'usuario' : 'acceso directo');

// ── Perfil del usuario (foto + nombre + cargo) vía Microsoft Graph ────────────
// Idea tomada del sub-proyecto FotoPerfil, pero aquí SOLO para el usuario
// autenticado y cacheada en la sesión (sin endpoint público que exponga a nadie).
// Si el .env no trae credenciales GRAPH_*, la feature se desactiva sola.
$profile = $_SESSION['profile'] ?? null;  // array = ok · false = intentado sin éxito · null = sin intentar

if ($loginOn && !empty($_SESSION['logged_in']) && $profile === null && ($_SESSION['user'] ?? '') !== '') {
    require_once __DIR__ . '/graph.php';
    $graphCfg = graph_config($envPath);
    if (graph_is_configured($graphCfg)) {
        $domain  = $graphCfg['upnDomain'] !== '' ? $graphCfg['upnDomain'] : 'cosmewax.com';
        $upn     = str_contains($currentUserRaw, '@') ? $currentUserRaw : $currentUserRaw . '@' . $domain;
        $profile = graph_fetch_profile($graphCfg, $upn) ?? false;
    } else {
        $profile = false;
    }
    $_SESSION['profile'] = $profile;
}

$displayName = (is_array($profile) && !empty($profile['name']))     ? $profile['name']     : $currentUserRaw;
$jobTitle    = (is_array($profile) && !empty($profile['jobTitle'])) ? $profile['jobTitle'] : '';
$avatarPhoto = (is_array($profile) && !empty($profile['photo']))    ? $profile['photo']    : null;

// Iniciales para el fallback cuando no hay foto disponible
$initials = '';
foreach (preg_split('/\s+/', trim($displayName)) as $part) {
    if ($part !== '') $initials .= mb_strtoupper(mb_substr($part, 0, 1));
    if (mb_strlen($initials) >= 2) break;
}
if ($initials === '') $initials = '?';
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= h($appName) ?> · Cosmewax</title>

    <link rel="icon" type="image/x-icon" href="favicon_circle2.ico">
    <script>
      (function(){
        try {
          var t = localStorage.getItem('siteTheme');
          if (t) document.documentElement.setAttribute('data-theme', t);
        } catch(e) {}
      })();
    </script>
    <link rel="stylesheet" href="assets/fontawesome/css/all.min.css">

    <link rel="stylesheet" href="css/index.css">
    <link rel="stylesheet" href="css/help-panel.css">
</head>
<body>

    <!-- ══ TOPBAR ════════════════════════════════════════════════════════════ -->
    <div class="topbar">
        <div class="topbar-logo">
            <img src="css/logo_blanco.png" alt="Cosmewax" class="topbar-logo-img">
        </div>

        <div class="topbar-section"><?= h($appName) ?></div>

        <div class="topbar-meta">
            Cosmewax &nbsp;
            <span class="env-badge <?= $envBadge['class'] ?>"><?= h($envBadge['label']) ?></span>
        </div>

        <div class="topbar-user" title="<?= h($jobTitle !== '' ? $displayName . ' — ' . $jobTitle : 'Sesión activa') ?>">
            <?php if ($avatarPhoto !== null): ?>
                <img src="<?= h($avatarPhoto) ?>" alt="" class="topbar-avatar">
            <?php else: ?>
                <span class="topbar-avatar topbar-avatar-fallback"><?= h($initials) ?></span>
            <?php endif; ?>
            <span class="topbar-user-info">
                <span class="topbar-user-name"><?= h($displayName) ?></span>
                <?php if ($jobTitle !== ''): ?>
                    <span class="topbar-user-role"><?= h($jobTitle) ?></span>
                <?php endif; ?>
            </span>
            &nbsp;·&nbsp;
            <a href="logout.php" class="topbar-logout" title="Cerrar sesión">
                <i class="fa fa-sign-out-alt"></i> Salir
            </a>
        </div>

        <button class="topbar-theme-btn" id="themeToggle" title="Cambiar tema (claro / oscuro)">
            <i class="fas fa-sun icon-sun"></i>
            <i class="fas fa-moon icon-moon"></i>
        </button>

        <button class="help-btn" id="helpOpenBtn" title="Abrir guía de uso">
            <span class="help-btn-icon">?</span> Ayuda
        </button>
    </div>

    <!-- ══ OVERLAY + PANEL DE AYUDA ══════════════════════════════════════════ -->
    <div class="help-overlay" id="helpOverlay"></div>

    <div class="help-panel" id="helpPanel" role="dialog" aria-label="Guía de uso">
        <div class="help-resize-handle" id="helpResizeHandle"
             title="Arrastrar para redimensionar · Doble clic para restablecer"></div>

        <div class="help-panel-head">
            <div class="help-panel-head-row">
                <div class="help-panel-title">📖 Guía de uso</div>
                <button class="help-close-btn" id="helpCloseBtn" title="Cerrar">✕</button>
            </div>
            <div class="help-search-wrap">
                <span class="help-search-icon">🔍</span>
                <input class="help-search" id="helpSearch" type="search"
                       placeholder="Buscar en la guía…">
            </div>
        </div>

        <div class="help-body" id="helpBody">
            <div class="help-no-results" id="helpNoResults">
                No se encontraron resultados para tu búsqueda.
            </div>

            <!-- 1. ¿Qué es este proyecto? -->
            <div class="help-section" data-kw="proyecto esqueleto plantilla base skeleton php cosmewax">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">🚀</span>
                    <span class="help-section-label">¿Qué es este proyecto?</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p><strong><?= h($appName) ?></strong> es el esqueleto base para nuevas aplicaciones web internas de Cosmewax.</p>
                    <p>Incluye de serie:</p>
                    <ul>
                        <li>Login con autenticación contra el <strong>Active Directory</strong> corporativo</li>
                        <li>Topbar con logo, nombre de app, <strong>badge de entorno</strong> y botón de ayuda</li>
                        <li>Panel de ayuda deslizante (este panel)</li>
                        <li>Gestión de variables de entorno via <code>.env</code></li>
                        <li>Estilos corporativos Cosmewax listos para usar</li>
                    </ul>
                    <div class="help-tip">
                        Para crear un nuevo proyecto a partir de este esqueleto, copia la carpeta y
                        adapta el <code>.env</code>, el título y el contenido del panel de ayuda.
                    </div>
                </div>
            </div>

            <!-- 2. Configuración del .env -->
            <div class="help-section" data-kw="env entorno configuracion variables ad ldap dominio host">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">⚙️</span>
                    <span class="help-section-label">Configurar el .env</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p>El fichero <code>.env</code> (en la raíz del proyecto) controla el comportamiento de la app sin tocar el código.</p>
                    <div class="help-subsection">
                        <div class="help-subsection-title">Active Directory</div>
                        <ul>
                            <li><strong>AD_HOST</strong> — IP o FQDN del servidor AD (ej. <code>192.168.1.10</code>)</li>
                            <li><strong>AD_PORT</strong> — Puerto LDAP: <code>389</code> sin cifrar, <code>636</code> con LDAPS</li>
                            <li><strong>AD_DOMAIN</strong> — Dominio para el UPN: <code>empresa.local</code></li>
                        </ul>
                    </div>
                    <div class="help-subsection">
                        <div class="help-subsection-title">Aplicación</div>
                        <ul>
                            <li><strong>APP_NAME</strong> — Nombre que aparece en la topbar y el &lt;title&gt;</li>
                            <li><strong>APP_ENVIRONMENT</strong> — Entorno visible: <em>Desarrollo</em>, <em>Staging</em> o <em>Producción</em></li>
                        </ul>
                    </div>
                    <div class="help-warn">
                        Nunca subas el <code>.env</code> al repositorio. Está incluido en <code>.gitignore</code>.
                        Usa <code>.env.example</code> como plantilla para nuevas instalaciones.
                    </div>
                </div>
            </div>

            <!-- 3. Autenticación AD -->
            <div class="help-section" data-kw="login autenticacion active directory ldap usuario contrasena sesion">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">🔑</span>
                    <span class="help-section-label">Cómo funciona el login (AD)</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p>El login autentica al usuario contra el Active Directory corporativo mediante LDAP bind.</p>
                    <ul class="help-steps">
                        <li class="help-step">
                            <span class="help-step-num">1</span>
                            <span class="help-step-text">El usuario introduce su usuario y contraseña de red.</span>
                        </li>
                        <li class="help-step">
                            <span class="help-step-num">2</span>
                            <span class="help-step-text"><code>auth.php</code> intenta un bind LDAP con el UPN <code>usuario@dominio.local</code>.</span>
                        </li>
                        <li class="help-step">
                            <span class="help-step-num">3</span>
                            <span class="help-step-text">Si el bind tiene éxito, se crea la sesión PHP y se redirige a <code>index.php</code>.</span>
                        </li>
                        <li class="help-step">
                            <span class="help-step-num">4</span>
                            <span class="help-step-text">Si falla, se vuelve al login con mensaje de error.</span>
                        </li>
                    </ul>
                    <div class="help-tip">
                        Para habilitar LDAP en PHP, descomenta <code>extension=ldap</code> en <code>php.ini</code> y reinicia Apache.
                    </div>
                </div>
            </div>

            <!-- 4. Badge de entorno -->
            <div class="help-section" data-kw="entorno badge dev staging prod desarrollo produccion color topbar">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">🏷️</span>
                    <span class="help-section-label">Badge de entorno en la topbar</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p>El badge de colores en la barra superior indica el entorno activo según el valor de <code>APP_ENVIRONMENT</code> en el <code>.env</code>:</p>
                    <ul>
                        <li><span class="env-badge env-dev">DEV</span> &nbsp;→ <code>Desarrollo</code> / <code>Development</code> / <code>Dev</code></li>
                        <li><span class="env-badge env-staging">TEST</span> &nbsp;→ <code>Staging</code> / <code>Test</code></li>
                        <li><span class="env-badge env-prod">PROD</span> &nbsp;→ <code>Producción</code> / <code>Production</code></li>
                    </ul>
                    <div class="help-tip">
                        Cambiar el badge es tan sencillo como modificar <code>APP_ENVIRONMENT</code> en el <code>.env</code>, sin tocar código.
                    </div>
                </div>
            </div>

            <!-- 5. Foto de perfil (Microsoft Graph) -->
            <div class="help-section" data-kw="foto perfil avatar microsoft graph teams m365 entra topbar usuario">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">🖼️</span>
                    <span class="help-section-label">Foto de perfil en la topbar</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p>La topbar puede mostrar la <strong>foto de perfil real</strong>, el nombre y el cargo del usuario autenticado, leídos de <strong>Microsoft 365 / Entra ID</strong> vía Microsoft Graph.</p>
                    <p>Es opcional: si no se configura, la topbar muestra las iniciales del usuario de red.</p>
                    <div class="help-subsection">
                        <div class="help-subsection-title">Activarlo</div>
                        <ul>
                            <li>Rellena en el <code>.env</code> las variables <code>GRAPH_TENANT_ID</code>, <code>GRAPH_CLIENT_ID</code> y <code>GRAPH_CLIENT_SECRET</code>.</li>
                            <li><code>GRAPH_UPN_DOMAIN</code> es el dominio con que se construye el UPN a partir del usuario de red (<code>usuario@dominio</code>).</li>
                            <li>Requiere una app en Entra ID con permiso de <strong>aplicación</strong> <code>User.Read.All</code>.</li>
                        </ul>
                    </div>
                    <div class="help-tip">
                        La foto solo se consulta para el usuario de la sesión y se <strong>cachea en la sesión</strong>: no hay endpoint público que exponga la foto de otros usuarios. La lógica reutilizable está en <code>graph.php</code>.
                    </div>
                </div>
            </div>

            <!-- 6. Extender el esqueleto -->
            <div class="help-section" data-kw="extender personalizar nuevo proyecto css js php modulos">
                <button class="help-section-toggle">
                    <span class="help-section-emoji">🛠️</span>
                    <span class="help-section-label">Cómo extender este esqueleto</span>
                    <span class="help-section-arrow">›</span>
                </button>
                <div class="help-section-body">
                    <p>El esqueleto está pensado para copiar y adaptar. Puntos de extensión habituales:</p>
                    <ul>
                        <li><strong>Contenido principal</strong> — añade tu HTML dentro del <code>.container</code> en <code>index.php</code></li>
                        <li><strong>CSS</strong> — los módulos viven en <code>css/</code>; crea subcarpetas por componente siguiendo el patrón existente</li>
                        <li><strong>JS</strong> — añade scripts en <code>js/</code> y enlázalos al final de <code>index.php</code></li>
                        <li><strong>API / backend</strong> — crea ficheros PHP en <code>Api/</code> que devuelvan JSON</li>
                        <li><strong>Panel de ayuda</strong> — edita las secciones <code>.help-section</code> dentro de este panel para documentar tu app</li>
                    </ul>
                    <div class="help-tip">
                        La función <code>readEnv()</code> de <code>auth.php</code> puede reutilizarse en cualquier script que necesite leer variables del <code>.env</code>.
                    </div>
                </div>
            </div>

        </div><!-- /help-body -->
    </div><!-- /help-panel -->

    <!-- ══ CONTENIDO PRINCIPAL ════════════════════════════════════════════════ -->
    <div class="container">

        <div class="header">
            <h2 style="font-weight:600; color:var(--corp-primary); font-size:1.1rem; letter-spacing:-.2px;">
                <?= h($appName) ?>
            </h2>
        </div>

        <!-- ── Aquí va el contenido de la aplicación ── -->
        <div style="background:white; border-radius:10px; padding:48px 32px; text-align:center;
                    border:1px solid var(--corp-border); box-shadow:0 1px 4px rgba(88,117,135,.08);">
            <p style="font-size:2.5rem; margin:0 0 12px;">🏗️</p>
            <h3 style="color:var(--corp-primary); margin:0 0 10px;">Panel en construcción</h3>
            <p style="color:var(--corp-text-soft); max-width:420px; margin:0 auto; line-height:1.7;">
                Aquí va el contenido de tu aplicación.<br>
                Este es el esqueleto base — pulsa <strong>Ayuda</strong> para ver cómo extenderlo.
            </p>
        </div>
        <!-- ──────────────────────────────────────────── -->

        <div class="footer" style="margin-top:40px;">
            <span class="footer-brand">COSMEWAX</span>
            &nbsp;·&nbsp; <?= h($appName) ?>
            &nbsp;·&nbsp; <?= h($appEnvironment) ?>
        </div>

    </div><!-- /container -->

    <!-- ══ SCRIPTS ════════════════════════════════════════════════════════════ -->
    <script src="js/help-panel.js"></script>
    <script>
    (function(){
        var btn = document.getElementById('themeToggle');
        if (!btn) return;
        btn.addEventListener('click', function(){
            var curr = document.documentElement.getAttribute('data-theme') || 'light';
            var next = curr === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('siteTheme', next); } catch(e) {}
        });
    })();
    </script>

</body>
</html>
