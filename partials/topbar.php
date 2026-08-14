<?php

declare(strict_types=1);

/**
 * Topbar corporativa, común con el resto de aplicaciones de la casa.
 *
 * Espera en el ámbito:
 *   $appName        string  nombre visible (APP_NAME)
 *   $appEnvironment string  Desarrollo | Staging | Producción (APP_ENVIRONMENT)
 *   $loginOn        bool    si el login está activo
 *
 * La foto y el cargo se leen de Microsoft Graph **sólo si el .env trae las
 * credenciales GRAPH_***. Sin ellas la topbar muestra las iniciales del usuario
 * de red y no se pierde nada. La consulta se cachea en la sesión: es una llamada
 * HTTP externa y repetirla en cada carga añadiría medio segundo a cada página.
 */

use Cosmewax\English\Support\Session;

$envBadge = match (strtolower(trim($appEnvironment))) {
    'desarrollo', 'development', 'dev' => ['label' => 'DEV', 'class' => 'env-dev'],
    'test', 'staging' => ['label' => 'TEST', 'class' => 'env-staging'],
    'producción', 'produccion', 'production', 'prod' => ['label' => 'PROD', 'class' => 'env-prod'],
    default => ['label' => strtoupper(trim($appEnvironment)), 'class' => 'env-dev'],
};

$currentUser = $loginOn ? (string) ($_SESSION['user'] ?? 'usuario') : 'acceso directo';

// null = sin intentar · false = intentado y sin éxito · array = perfil
$graphProfile = $_SESSION['profile'] ?? null;

if ($loginOn && Session::isAuthenticated() && $graphProfile === null && $currentUser !== '') {
    $graphProfile = false;
    $graphFile = BASE_PATH . '/graph.php';
    if (is_file($graphFile)) {
        require_once $graphFile;
        $graphCfg = graph_config(BASE_PATH . '/.env');
        if (graph_is_configured($graphCfg)) {
            $domain = $graphCfg['upnDomain'] !== '' ? $graphCfg['upnDomain'] : 'cosmewax.com';
            $upn = str_contains($currentUser, '@') ? $currentUser : $currentUser . '@' . $domain;
            $graphProfile = graph_fetch_profile($graphCfg, $upn) ?? false;
        }
    }
    $_SESSION['profile'] = $graphProfile;
}

$displayName = (is_array($graphProfile) && !empty($graphProfile['name']))
    ? (string) $graphProfile['name']
    : $currentUser;
$jobTitle = (is_array($graphProfile) && !empty($graphProfile['jobTitle']))
    ? (string) $graphProfile['jobTitle']
    : '';
$avatarPhoto = (is_array($graphProfile) && !empty($graphProfile['photo']))
    ? (string) $graphProfile['photo']
    : null;

$initials = '';
foreach (preg_split('/\s+/', trim($displayName)) ?: [] as $part) {
    if ($part !== '') {
        $initials .= mb_strtoupper(mb_substr($part, 0, 1));
    }
    if (mb_strlen($initials) >= 2) {
        break;
    }
}
if ($initials === '') {
    $initials = '?';
}
?>
<div class="topbar">
  <div class="topbar-logo">
    <img src="css/logo_blanco.png" alt="Cosmewax" class="topbar-logo-img">
  </div>

  <div class="topbar-section"><?= e($appName) ?></div>

  <div class="topbar-meta">
    Cosmewax&nbsp;
    <span class="env-badge <?= e($envBadge['class']) ?>"><?= e($envBadge['label']) ?></span>
  </div>

  <div class="topbar-user" title="<?= e($jobTitle !== '' ? $displayName . ' — ' . $jobTitle : 'Sesión activa') ?>">
    <?php if ($avatarPhoto !== null): ?>
      <img src="<?= e($avatarPhoto) ?>" alt="" class="topbar-avatar">
    <?php else: ?>
      <span class="topbar-avatar topbar-avatar-fallback"><?= e($initials) ?></span>
    <?php endif; ?>
    <span class="topbar-user-info">
      <span class="topbar-user-name"><?= e($displayName) ?></span>
      <?php if ($jobTitle !== ''): ?>
        <span class="topbar-user-role"><?= e($jobTitle) ?></span>
      <?php endif; ?>
    </span>
    <?php if ($loginOn): ?>
      &nbsp;·&nbsp;
      <a href="logout.php" class="topbar-logout" title="Cerrar sesión">
        <i class="fa fa-sign-out-alt"></i> Salir
      </a>
    <?php endif; ?>
  </div>

  <button type="button" class="topbar-theme-btn" id="themeToggle" title="Cambiar tema (claro / oscuro)">
    <i class="fas fa-sun icon-sun"></i>
    <i class="fas fa-moon icon-moon"></i>
  </button>
</div>
