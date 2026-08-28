<?php
declare(strict_types=1);

// ===== ARCHIVO: sso.php — inicio de sesión integrado de Windows (SSPI/NTLM) =====
//
// Cuando esta línea se ejecuta, Apache ya ha hecho todo el trabajo (bloque
// <Files ~ "^sso(_test)?\.php$"> del .htaccess):
//   1. ha identificado al usuario contra el dominio, sin pedirle credenciales
//   2. ha comprobado la autorización con el token de Windows (Require valid-user:
//      cualquier cuenta válida del dominio, igual que el bind de auth.php)
//
// Llegar aquí significa autenticado Y autorizado: este fichero NO consulta LDAP;
// solo abre la sesión de PHP con las mismas claves que auth.php, para que
// index.php y el resto de la aplicación no noten la diferencia.
//
// El formulario de usuario/contraseña (login.php + auth.php) se conserva como
// vía de entrada para equipos fuera del dominio: el SSO añade una puerta, no
// sustituye la otra.

session_start();

// Si ya está autenticado, directo a la app.
if (!empty($_SESSION['logged_in'])) {
    header('Location: index.php');
    exit;
}

// ── Identidad ─────────────────────────────────────────────────────────────────
// REMOTE_USER llega ya en minúsculas y sin dominio (NTLMOmitDomain On +
// NTLMUsernameCase lower en el .htaccess), que es exactamente el formato que
// Session::user() produce a partir de lo que guarda auth.php. Se puede guardar
// tal cual sin normalizar de nuevo.
$usuario = trim($_SERVER['REMOTE_USER'] ?? '');

// Cinturón y tirantes: si el bloque <Files> del .htaccess se perdiera en una
// migración o copia del proyecto, REMOTE_USER llegaría vacío. En ese caso no se
// abre sesión bajo ningún concepto: se devuelve al formulario clásico.
if ($usuario === '') {
    header('Location: login.php?error=' . urlencode('El inicio de sesión integrado no está disponible. Entra con tus credenciales.'));
    exit;
}

// ── Sesión (mismas claves que auth.php) ───────────────────────────────────────
session_regenerate_id(true);
$_SESSION['logged_in']   = true;
$_SESSION['user']        = $usuario;   // Session::user() lo normaliza al leer
$_SESSION['login_at']    = time();
$_SESSION['auth_method'] = 'sso';      // no lo usa nadie; ayuda a auditar

header('Location: index.php');
exit;
