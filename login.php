<?php
declare(strict_types=1);

session_start();

// Si ya está autenticado, redirigir al panel
if (!empty($_SESSION['logged_in'])) {
    header('Location: index.php');
    exit;
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

// Leer variables de .env necesarias en login
$appName = 'EsqueleticPHP';
$loginOn = true;
$envPath = __DIR__ . '/.env';
if (is_file($envPath)) {
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (str_starts_with($line, 'APP_NAME=')) {
            $appName = trim(trim(substr($line, strlen('APP_NAME='))), '"\'');
        } elseif (str_starts_with($line, 'LOGIN_ON=')) {
            $val = strtolower(trim(trim(substr($line, strlen('LOGIN_ON='))), '"\''));
            $loginOn = !in_array($val, ['false', '0', 'no', 'off'], true);
        }
    }
}

// Si el login está desactivado, acceso directo a la app
if (!$loginOn) {
    header('Location: index.php');
    exit;
}

$error = isset($_GET['error']) ? h(trim($_GET['error'])) : null;
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Acceso · <?= h($appName) ?></title>
    <link rel="icon" type="image/x-icon" href="favicon_circle2.ico">
    <script>
      (function(){
        try {
          var t = localStorage.getItem('siteTheme');
          if (t) document.documentElement.setAttribute('data-theme', t);
        } catch(e) {}
      })();
    </script>
    <link rel="stylesheet" href="assets/css/login.css">
</head>
<body class="login-body">
    <main class="login-shell">
        <section class="login-hero" aria-label="<?= h($appName) ?>">
            <img class="login-logo" src="cosmewax-logo.svg" alt="Cosmewax">
            <div>
                <p class="eyebrow">Cosmewax · Acceso interno</p>
                <h1><?= h($appName) ?></h1>
                <p>Acceso privado. Usa tu cuenta de red (AD) para entrar al panel.</p>
            </div>
        </section>

        <section class="login-card">
            <button type="button" class="login-theme-btn" id="themeToggle" title="Cambiar tema">
                <!-- Sol (tema claro activo) -->
                <svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                <!-- Luna (tema oscuro activo) -->
                <svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
            </button>
            <p class="eyebrow">Acceso privado</p>
            <h2>Iniciar sesión</h2>
            <p class="muted">Introduce tus credenciales de red corporativa.</p>

            <?php if ($error): ?>
                <div class="alert alert-error" role="alert"><?= $error ?></div>
            <?php endif; ?>

            <form method="post" action="auth.php" class="login-form">
                <label>
                    Usuario
                    <input type="text" name="username" autocomplete="username"
                           required autofocus placeholder="tu.usuario">
                </label>
                <label>
                    Contraseña
                    <input type="password" name="password" autocomplete="current-password"
                           required placeholder="••••••••">
                </label>
                <button type="submit">Entrar</button>
            </form>

            <div class="login-sep">o</div>
            <a class="sso-btn" href="sso.php">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z"/>
                </svg>
                Entrar con mi cuenta de Windows
            </a>
        </section>
    </main>
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
