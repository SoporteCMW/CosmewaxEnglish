<?php
// ===== ARCHIVO: sso_test.php (TEMPORAL — borrar cuando el SSO esté probado) =====
// Diagnóstico del inicio de sesión integrado de Windows (SSPI/NTLM).
// No consulta LDAP ni abre sesión: solo muestra lo que Apache entrega.

header('Content-Type: text/html; charset=utf-8');

$usuario   = $_SERVER['REMOTE_USER'] ?? '';
$tipo_auth = $_SERVER['AUTH_TYPE']   ?? '';
$logon     = $_SERVER['LOGON_USER']  ?? '';
$ip        = $_SERVER['REMOTE_ADDR'] ?? '';

$autenticado = ($usuario !== '');

$modulos     = function_exists('apache_get_modules') ? apache_get_modules() : [];
$modulo_ntlm = in_array('mod_authn_ntlm', $modulos, true)
            || in_array('auth_ntlm_module', $modulos, true);

function e($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Diagnóstico de inicio de sesión integrado</title>
<style>
  body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; padding: 32px;
         background: #f5f5f5; color: #242424; }
  .caja { max-width: 720px; margin: 0 auto; background: #fff; padding: 24px 28px;
          border: 1px solid #e1dfdd; border-radius: 10px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 20px; color: #605e5c; font-size: 13px; }
  .estado { padding: 12px 16px; border-radius: 8px; font-weight: 600; margin-bottom: 20px; }
  .ok  { background: #dff6dd; color: #0b6a4f; border: 1px solid #0b6a4f33; }
  .mal { background: #fde7e9; color: #a4262c; border: 1px solid #a4262c33; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #edebe9;
           vertical-align: top; }
  th { width: 40%; font-weight: 600; color: #605e5c; }
  code { font-family: Consolas, monospace; background: #f3f2f1; padding: 1px 5px;
         border-radius: 3px; }
  .vacio { color: #a19f9d; font-style: italic; }
  ol { font-size: 14px; color: #605e5c; line-height: 1.6; }
</style>
</head>
<body>
<div class="caja">
  <h1>Diagnóstico de inicio de sesión integrado</h1>
  <p class="sub">Cosmewax English &mdash; comprobación de SSPI/NTLM</p>

  <?php if ($autenticado): ?>
    <div class="estado ok">
      CORRECTO &mdash; Apache ha identificado al usuario sin pedir credenciales.
    </div>
  <?php else: ?>
    <div class="estado mal">
      SIN IDENTIFICAR &mdash; Apache no ha entregado ningún usuario.
    </div>
  <?php endif; ?>

  <table>
    <tr>
      <th>Usuario (<code>REMOTE_USER</code>)</th>
      <td><?= $autenticado ? '<strong>' . e($usuario) . '</strong>' : '<span class="vacio">vacío</span>' ?></td>
    </tr>
    <tr>
      <th>Tipo de autenticación</th>
      <td><?= $tipo_auth !== '' ? e($tipo_auth) : '<span class="vacio">vacío</span>' ?></td>
    </tr>
    <tr>
      <th><code>LOGON_USER</code></th>
      <td><?= $logon !== '' ? e($logon) : '<span class="vacio">vacío</span>' ?></td>
    </tr>
    <tr>
      <th>Módulo <code>auth_ntlm_module</code> cargado</th>
      <td><?= $modulo_ntlm ? 'sí' : 'no' ?></td>
    </tr>
    <tr>
      <th>Extensión LDAP de PHP</th>
      <td><?= extension_loaded('ldap') ? 'disponible' : 'NO disponible' ?></td>
    </tr>
    <tr>
      <th>Tu dirección IP</th>
      <td><?= e($ip) ?></td>
    </tr>
  </table>

  <?php if (!$autenticado): ?>
    <h2 style="font-size:15px;margin:24px 0 8px;">Qué revisar</h2>
    <ol>
      <li>¿El navegador trata este sitio como zona de intranet? Edge y Chrome
          envían las credenciales automáticamente solo en esa zona.</li>
      <li>¿El equipo está unido al dominio <code>COSMEWAX.LOCAL</code>?</li>
    </ol>
  <?php endif; ?>
</div>
</body>
</html>
