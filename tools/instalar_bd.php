<?php

declare(strict_types=1);

/**
 * Instalador de la base de datos.
 *
 *   php tools/instalar_bd.php            crea/actualiza el esquema y siembra
 *   php tools/instalar_bd.php --resembrar vuelve a volcar los catálogos
 *
 * Crea `CosmewaxEnglish` en el servidor de `DB_HOST_DEV` con autenticación
 * integrada de Windows, aplica `sql/schema.sql` y siembra los catálogos desde
 * `data/*.json`. Es idempotente: reejecutarlo no duplica nada.
 *
 * El sembrado NUNCA toca el progreso ni las tarjetas propias de la gente
 * (`card.is_seed = 0`). Sin `--resembrar`, tampoco pisa un catálogo ya cargado:
 * la BD pasa a ser la fuente de verdad en cuanto se instala, y machacarla en
 * cada despliegue anularía cualquier corrección hecha directamente en SQL.
 *
 * Sólo CLI. Por web no tiene sentido: es una operación de despliegue y por
 * navegador quedaría expuesta a quien alcanzase la URL.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Este instalador sólo se ejecuta desde la línea de comandos.\n");
}

require __DIR__ . '/../src/bootstrap.php';

use Cosmewax\English\Support\Env;

$resembrar = in_array('--resembrar', $argv, true);
$host = Env::get('DB_HOST_DEV', 'CMW0090');
$dbname = Env::get('DB_NAME', 'CosmewaxEnglish');
$dataDir = BASE_PATH . '/data';
$schemaFile = BASE_PATH . '/sql/schema.sql';

function say(string $msg): void
{
    echo $msg . PHP_EOL;
}

/** Nombre de BD dentro de un identificador delimitado: no admite parámetro. */
function quoteIdent(string $name): string
{
    if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $name)) {
        throw new RuntimeException("Nombre de base de datos no válido: {$name}");
    }

    return '[' . $name . ']';
}

function connect(string $host, string $database): PDO
{
    return new PDO(
        "sqlsrv:Server={$host};Database={$database};TrustServerCertificate=1",
        null,
        null,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::SQLSRV_ATTR_ENCODING => PDO::SQLSRV_ENCODING_UTF8,
        ]
    );
}

/** @return array<int,array<string,mixed>> */
function loadJson(string $dataDir, string $name): array
{
    $path = "{$dataDir}/{$name}.json";
    if (!is_file($path)) {
        say("  aviso: falta {$name}.json, se omite");

        return [];
    }
    $decoded = json_decode((string) file_get_contents($path), true);

    return is_array($decoded) ? $decoded : [];
}

try {
    if (!is_file($schemaFile)) {
        throw new RuntimeException("No se encuentra {$schemaFile}");
    }

    // ── 1. Base de datos ─────────────────────────────────────────────────────
    $master = connect($host, 'master');
    say('Conectado a ' . $host . ' como ' . $master->query('SELECT SUSER_SNAME()')->fetchColumn());

    $stmt = $master->prepare('SELECT COUNT(*) FROM sys.databases WHERE name = ?');
    $stmt->execute([$dbname]);

    if ((int) $stmt->fetchColumn() === 0) {
        $master->exec('CREATE DATABASE ' . quoteIdent($dbname));
        say("Base de datos {$dbname} creada.");
    } else {
        say("Base de datos {$dbname} ya existe.");
    }

    // ── 2. Esquema ───────────────────────────────────────────────────────────
    $pdo = connect($host, $dbname);
    // PDO no entiende el separador GO de SSMS: se parte y se ejecuta por lotes.
    $batches = preg_split('/^\s*GO\s*$/mi', (string) file_get_contents($schemaFile)) ?: [];
    $applied = 0;
    foreach ($batches as $batch) {
        if (trim($batch) === '') {
            continue;
        }
        $pdo->exec($batch);
        $applied++;
    }
    say("Esquema aplicado ({$applied} lotes).");

    // ── 3. Catálogos ─────────────────────────────────────────────────────────
    $counts = [];
    foreach (
        [
            'card_category' => 'card-categories',
            'scenario_group' => 'scenario-groups',
            'profile' => 'profiles',
            'reading_topic' => 'reading-topics',
            'grammar_item' => 'grammar',
            'scenario' => 'scenarios',
            'card' => 'deck',
            'minimal_pair_group' => 'minimal-pairs',
        ] as $table => $file
    ) {
        $stmt = $pdo->query("SELECT COUNT(*) FROM dbo.{$table}" . ($table === 'card' ? ' WHERE is_seed = 1' : ''));
        $counts[$table] = (int) $stmt->fetchColumn();
    }

    $poblado = array_sum($counts) > 1; // >1: el esquema siembra la categoría 'personal'
    if ($poblado && !$resembrar) {
        say('Catálogo ya cargado; se conserva. Usa --resembrar para volcarlo de nuevo.');

        // Una tabla nueva en una instalación ya poblada se queda vacía, y el
        // repositorio la sirve desde `data/` sin decir nada. Se avisa aquí: la
        // aplicación funciona, pero la BD no es todavía la fuente de verdad.
        $vacias = array_keys(array_filter($counts, static fn (int $n): bool => $n === 0));
        if ($vacias !== []) {
            say('  aviso: sin filas en ' . implode(', ', $vacias)
                . ' — se servirán desde data/*.json. Ejecuta --resembrar para cargarlas.');
        }
    } else {
        $pdo->beginTransaction();

        // card_category
        $rows = loadJson($dataDir, 'card-categories');
        $stmt = $pdo->prepare(
            'MERGE dbo.card_category AS t
             USING (SELECT ? AS id, ? AS label, ? AS form_label, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET label = s.label, form_label = s.form_label, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, label, form_label, sort_order)
                  VALUES (s.id, s.label, s.form_label, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([$r['id'] ?? '', $r['label'] ?? '', $r['formLabel'] ?? null, $i]);
        }
        say('  card_category  ' . count($rows));

        // scenario_group
        $rows = loadJson($dataDir, 'scenario-groups');
        $stmt = $pdo->prepare(
            'MERGE dbo.scenario_group AS t
             USING (SELECT ? AS id, ? AS label, ? AS who_label, ? AS mode, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET label = s.label, who_label = s.who_label,
                  mode = s.mode, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, label, who_label, mode, sort_order)
                  VALUES (s.id, s.label, s.who_label, s.mode, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([
                $r['id'] ?? '', $r['label'] ?? '', $r['whoLabel'] ?? null,
                $r['mode'] ?? 'profesional', $i,
            ]);
        }
        say('  scenario_group ' . count($rows));

        // minimal_pair_group: los pares van tal cual en una columna JSON
        $rows = loadJson($dataDir, 'minimal-pairs');
        $stmt = $pdo->prepare(
            'MERGE dbo.minimal_pair_group AS t
             USING (SELECT ? AS id, ? AS label, ? AS tip, ? AS pairs, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET label = s.label, tip = s.tip,
                  pairs = s.pairs, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, label, tip, pairs, sort_order)
                  VALUES (s.id, s.label, s.tip, s.pairs, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([
                $r['id'] ?? '', $r['label'] ?? '', $r['tip'] ?? null,
                json_encode($r['pairs'] ?? [], JSON_UNESCAPED_UNICODE), $i,
            ]);
        }
        say('  minimal_pairs  ' . count($rows));

        // profile
        $rows = loadJson($dataDir, 'profiles');
        $stmt = $pdo->prepare(
            'MERGE dbo.profile AS t
             USING (SELECT ? AS id, ? AS label, ? AS topic_hint, ? AS vocab_hint,
                           ? AS scenario_hint, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET label = s.label, topic_hint = s.topic_hint,
                  vocab_hint = s.vocab_hint, scenario_hint = s.scenario_hint, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, label, topic_hint, vocab_hint, scenario_hint, sort_order)
                  VALUES (s.id, s.label, s.topic_hint, s.vocab_hint, s.scenario_hint, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([
                $r['id'] ?? '', $r['label'] ?? '',
                $r['topicHint'] ?? null, $r['vocabHint'] ?? null, $r['scenarioHint'] ?? null, $i,
            ]);
        }
        say('  profile        ' . count($rows));

        // reading_topic
        $rows = loadJson($dataDir, 'reading-topics');
        $stmt = $pdo->prepare(
            'MERGE dbo.reading_topic AS t
             USING (SELECT ? AS id, ? AS title, ? AS [desc], ? AS prompt, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET title = s.title, [desc] = s.[desc],
                  prompt = s.prompt, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, title, [desc], prompt, sort_order)
                  VALUES (s.id, s.title, s.[desc], s.prompt, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([$r['id'] ?? '', $r['title'] ?? '', $r['desc'] ?? null, $r['prompt'] ?? null, $i]);
        }
        say('  reading_topic  ' . count($rows));

        // grammar_item: id/level/title en columnas, el resto en payload JSON
        $rows = loadJson($dataDir, 'grammar');
        $stmt = $pdo->prepare(
            'MERGE dbo.grammar_item AS t
             USING (SELECT ? AS id, ? AS level, ? AS title, ? AS payload, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED THEN UPDATE SET level = s.level, title = s.title,
                  payload = s.payload, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, level, title, payload, sort_order)
                  VALUES (s.id, s.level, s.title, s.payload, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $rest = $r;
            unset($rest['id'], $rest['level'], $rest['title']);
            $stmt->execute([
                $r['id'] ?? '', $r['level'] ?? '', $r['title'] ?? '',
                json_encode($rest, JSON_UNESCAPED_UNICODE), $i,
            ]);
        }
        say('  grammar_item   ' . count($rows));

        // scenario (los del catálogo: generated_by NULL)
        $rows = loadJson($dataDir, 'scenarios');
        $stmt = $pdo->prepare(
            'MERGE dbo.scenario AS t
             USING (SELECT ? AS id, ? AS category, ? AS initiator, ? AS title, ? AS [desc],
                           ? AS opening, ? AS guide, ? AS context, ? AS sort_order) AS s ON t.id = s.id
             WHEN MATCHED AND t.generated_by IS NULL THEN UPDATE SET category = s.category,
                  initiator = s.initiator, title = s.title, [desc] = s.[desc], opening = s.opening,
                  guide = s.guide, context = s.context, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (id, category, initiator, title, [desc], opening, guide, context, sort_order)
                  VALUES (s.id, s.category, s.initiator, s.title, s.[desc], s.opening, s.guide, s.context, s.sort_order);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([
                $r['id'] ?? '', $r['category'] ?? '', $r['initiator'] ?? 'assistant',
                $r['title'] ?? '', $r['desc'] ?? null, $r['opening'] ?? null,
                $r['guide'] ?? null, $r['context'] ?? null, $i,
            ]);
        }
        say('  scenario       ' . count($rows));

        // card: se casa por `en`, nunca por id (ver comentario en schema.sql)
        $rows = loadJson($dataDir, 'deck');
        $stmt = $pdo->prepare(
            'MERGE dbo.card AS t
             USING (SELECT ? AS en, ? AS category_id, ? AS es, ? AS note, ? AS sort_order) AS s
                ON t.en = s.en AND t.is_seed = 1
             WHEN MATCHED THEN UPDATE SET category_id = s.category_id, es = s.es,
                  note = s.note, sort_order = s.sort_order
             WHEN NOT MATCHED THEN INSERT (en, category_id, es, note, sort_order, is_seed)
                  VALUES (s.en, s.category_id, s.es, s.note, s.sort_order, 1);'
        );
        foreach ($rows as $i => $r) {
            $stmt->execute([$r['en'] ?? '', $r['cat'] ?? '', $r['es'] ?? '', $r['note'] ?? null, $i]);
        }
        say('  card           ' . count($rows));

        $pdo->commit();
        say('Catálogo sembrado.');
    }

    // ── 4. Resumen ───────────────────────────────────────────────────────────
    say('');
    say('Contenido actual:');
    foreach (
        ['card_category', 'card', 'grammar_item', 'profile',
            'scenario_group', 'scenario', 'reading_topic', 'minimal_pair_group',
            'app_user', 'user_state'] as $t
    ) {
        printf("  %-16s %d%s", $t, (int) $pdo->query("SELECT COUNT(*) FROM dbo.{$t}")->fetchColumn(), PHP_EOL);
    }
    say('');
    say('Listo.');
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'ERROR: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
