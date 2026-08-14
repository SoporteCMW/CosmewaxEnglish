#!/usr/bin/env node
// PreToolUse guard: bloquea cualquier invocacion de git en este proyecto.
// Se usa junto a permissions.deny porque el modo bypassPermissions no debe
// dejar pasar comandos de git. Los hooks se ejecutan siempre, sea cual sea el modo.

let raw = '';
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    const input = JSON.parse(raw);
    cmd = (input.tool_input && input.tool_input.command) || '';
  } catch {
    process.exit(0); // payload ilegible: no estorbamos
  }

  // "git" solo donde puede empezar un comando: inicio, o tras un operador de shell,
  // admitiendo prefijos sudo, env y asignaciones inline VAR=x.
  // Asi no cazamos github.com, legit ni digit.
  const GIT = /(?:^|[\n;|&(){}`]|\$\()\s*(?:(?:sudo|env)\s+|[A-Za-z_]\w*=\S*\s+)*git(?:\.exe)?(?:\s|$|;|&|\|)/i;

  if (GIT.test(cmd)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'Los comandos de git estan bloqueados en este proyecto (guard: .claude/hooks/block-git.js). No reintentes: pide al usuario que ejecute el comando de git manualmente.'
        }
      })
    );
  }
  process.exit(0);
});
