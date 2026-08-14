/* ═══════════════════════════════════════════════════════════════════════════
   CosmewaxEnglish · esquema SQL Server
   Se ejecuta con `php tools/instalar_bd.php`. Idempotente: puede reejecutarse.
   Los lotes se separan con GO (el instalador parte el fichero por esa marca).

   Dos mitades bien distintas:

   · CATÁLOGO (card, grammar_item, profile, scenario, …) — contenido de la
     aplicación, igual para todos. Sale de los ficheros JSON de `data` en la primera
     instalación y a partir de ahí la BD es la fuente de verdad. Los JSON se
     conservan como semilla y como respaldo de arranque si el servidor no
     responde.

   · PROGRESO (app_user, user_state) — datos de cada persona, clave por usuario
     del AD. Aquí el JSON se guarda tal cual en `payload`: el cliente ya tenía
     esa forma en localStorage y reescribir los seis modos para normalizar cada
     estructura habría multiplicado el riesgo sin aportar nada al alumno.
     SQL Server 2019 sabe consultar dentro con JSON_VALUE y OPENJSON, así que
     los informes siguen siendo posibles (hay ejemplos al final del fichero).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Catálogo: categorías de tarjeta ──────────────────────────────────────── */
IF OBJECT_ID('dbo.card_category', 'U') IS NULL
CREATE TABLE dbo.card_category (
    id          VARCHAR(40)    NOT NULL PRIMARY KEY,
    label       NVARCHAR(120)  NOT NULL,
    form_label  NVARCHAR(160)  NULL,   -- etiqueta larga, para el formulario de alta
    sort_order  INT            NOT NULL DEFAULT 0
);
GO

/* ── Catálogo: mazo de tarjetas ───────────────────────────────────────────────
   `is_seed` distingue las tarjetas que vienen del mazo base de las que crea una
   persona (al ascender una palabra del cuaderno o con el formulario). Sin esa
   marca, reinstalar el catálogo borraría las tarjetas propias de la gente. */
IF OBJECT_ID('dbo.card', 'U') IS NULL
CREATE TABLE dbo.card (
    id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    category_id  VARCHAR(40)    NOT NULL,
    es           NVARCHAR(500)  NOT NULL,
    en           NVARCHAR(500)  NOT NULL,
    note         NVARCHAR(1000) NULL,
    sort_order   INT            NOT NULL DEFAULT 0,
    is_seed      BIT            NOT NULL DEFAULT 1,
    owner_user   VARCHAR(128)   NULL,   -- NULL = del mazo común
    created_at   DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_card_category FOREIGN KEY (category_id) REFERENCES dbo.card_category(id)
);
GO

/* El mazo se identifica por el texto en inglés, no por el id: al ampliar la
   semilla los ids se desplazan y el progreso de la gente se despegaría de su
   tarjeta. Es la misma decisión que ya tomaba el cliente al fusionar mazos. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_card_en_seed' AND object_id = OBJECT_ID('dbo.card'))
CREATE UNIQUE INDEX UX_card_en_seed ON dbo.card(en) WHERE is_seed = 1;
GO

/* ── Catálogo: gramática ──────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.grammar_item', 'U') IS NULL
CREATE TABLE dbo.grammar_item (
    id          VARCHAR(60)    NOT NULL PRIMARY KEY,
    level       VARCHAR(10)    NOT NULL,
    title       NVARCHAR(300)  NOT NULL,
    payload     NVARCHAR(MAX)  NOT NULL,   -- el resto del ítem, tal cual
    sort_order  INT            NOT NULL DEFAULT 0,
    CONSTRAINT CK_grammar_payload CHECK (ISJSON(payload) = 1)
);
GO

/* ── Catálogo: perfiles profesionales ─────────────────────────────────────────
   Los tres `*_hint` son material de prompt y NO se envían al navegador: el
   repositorio tiene una proyección de cliente que sólo saca id y label. */
IF OBJECT_ID('dbo.profile', 'U') IS NULL
CREATE TABLE dbo.profile (
    id             VARCHAR(40)    NOT NULL PRIMARY KEY,
    label          NVARCHAR(160)  NOT NULL,
    topic_hint     NVARCHAR(MAX)  NULL,
    vocab_hint     NVARCHAR(MAX)  NULL,
    scenario_hint  NVARCHAR(MAX)  NULL,
    sort_order     INT            NOT NULL DEFAULT 0
);
GO

/* ── Catálogo: escenarios de conversación ─────────────────────────────────────
   `context` es material de prompt: tampoco sale del servidor.
   `generated_by` distingue los escenarios del catálogo (NULL) de los que genera
   una persona con la IA, que sustituyen al fichero storage/generated-scenarios.json. */
IF OBJECT_ID('dbo.scenario_group', 'U') IS NULL
CREATE TABLE dbo.scenario_group (
    id          VARCHAR(40)    NOT NULL PRIMARY KEY,
    label       NVARCHAR(300)  NOT NULL,
    who_label   NVARCHAR(120)  NULL,   -- como se llama al interlocutor en el chat
    -- 'profesional' | 'cotidiano': el selector agrupa los grupos en dos bloques.
    -- El inglés de la vida diaria se practica aparte del de trabajo a propósito:
    -- son registros distintos y mezclarlos en una sola lista los diluía.
    mode        VARCHAR(20)    NOT NULL DEFAULT 'profesional',
    sort_order  INT            NOT NULL DEFAULT 0
);
GO

/* Instalaciones anteriores a los grupos con modo: la columna se añade sin tocar
   los datos, con 'profesional' por defecto, que es lo que había. */
IF COL_LENGTH('dbo.scenario_group', 'mode') IS NULL
ALTER TABLE dbo.scenario_group ADD mode VARCHAR(20) NOT NULL DEFAULT 'profesional';
GO

IF OBJECT_ID('dbo.scenario', 'U') IS NULL
CREATE TABLE dbo.scenario (
    id            VARCHAR(80)    NOT NULL PRIMARY KEY,
    category      VARCHAR(40)    NOT NULL,
    initiator     VARCHAR(20)    NOT NULL DEFAULT 'assistant',
    title         NVARCHAR(300)  NOT NULL,
    [desc]        NVARCHAR(1000) NULL,
    opening       NVARCHAR(MAX)  NULL,
    guide         NVARCHAR(MAX)  NULL,
    context       NVARCHAR(MAX)  NULL,
    generated_by  VARCHAR(128)   NULL,
    -- Perfil profesional con el que se generó. El selector agrupa los generados
    -- por este campo: quien cambia de perfil no pierde de vista los de antes,
    -- ni se los encuentra etiquetados con el perfil que tenga puesto hoy.
    profile_id    VARCHAR(40)    NULL,
    created_at    DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
    sort_order    INT            NOT NULL DEFAULT 0
);
GO

/* Instalaciones anteriores al agrupado por perfil: la columna se añade vacía.
   Los escenarios que ya había quedan en un grupo "sin perfil", que es lo único
   que se puede afirmar de ellos sin inventarse con qué perfil se crearon. */
IF COL_LENGTH('dbo.scenario', 'profile_id') IS NULL
ALTER TABLE dbo.scenario ADD profile_id VARCHAR(40) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_scenario_generated' AND object_id = OBJECT_ID('dbo.scenario'))
CREATE INDEX IX_scenario_generated ON dbo.scenario(generated_by, created_at DESC);
GO

/* ── Catálogo: temas de lectura ───────────────────────────────────────────── */
IF OBJECT_ID('dbo.reading_topic', 'U') IS NULL
CREATE TABLE dbo.reading_topic (
    id          VARCHAR(40)    NOT NULL PRIMARY KEY,
    title       NVARCHAR(300)  NOT NULL,
    [desc]      NVARCHAR(1000) NULL,
    -- Material de prompt: no sale del servidor, igual que profile.*_hint.
    prompt      NVARCHAR(MAX)  NULL,
    sort_order  INT            NOT NULL DEFAULT 0
);
GO

/* ── Catálogo: grupos de pares mínimos (modo Pronunciación) ───────────────────
   Cada fila es un contraste de sonidos (TH vs S, V vs B, …) con su explicación
   en español y su lista de pares en JSON. Los pares van en una sola columna y no
   en una tabla hija a propósito: no se consultan por separado, siempre se cargan
   los del grupo entero, y así el catálogo se siembra igual que `grammar_item`. */
IF OBJECT_ID('dbo.minimal_pair_group', 'U') IS NULL
CREATE TABLE dbo.minimal_pair_group (
    id          VARCHAR(40)    NOT NULL PRIMARY KEY,
    label       NVARCHAR(200)  NOT NULL,
    tip         NVARCHAR(MAX)  NULL,      -- cómo se articula el sonido, en español
    pairs       NVARCHAR(MAX)  NOT NULL,  -- [{"a":"think","b":"sink"}, …]
    sort_order  INT            NOT NULL DEFAULT 0,
    CONSTRAINT CK_minimal_pair_json CHECK (ISJSON(pairs) = 1)
);
GO

/* ── Progreso: registro de usuarios ───────────────────────────────────────────
   Se llena solo al entrar. Sirve para saber quién usa la aplicación sin tener
   que abrir el progreso de nadie. */
IF OBJECT_ID('dbo.app_user', 'U') IS NULL
CREATE TABLE dbo.app_user (
    user_key    VARCHAR(128)  NOT NULL PRIMARY KEY,   -- usuario AD en minúsculas, sin dominio
    first_seen  DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
    last_seen   DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME()
);
GO

/* ── Progreso: estado por usuario y clave ─────────────────────────────────────
   Las doce claves que antes vivían en localStorage:
     deck · srs · voice-stats · conversations · read-stats · listen-stats
     grammar-srs · notebook · streak · profile · pron-stats · generated-pairs  */
IF OBJECT_ID('dbo.user_state', 'U') IS NULL
CREATE TABLE dbo.user_state (
    user_key    VARCHAR(128)   NOT NULL,
    state_key   VARCHAR(60)    NOT NULL,
    payload     NVARCHAR(MAX)  NOT NULL,
    updated_at  DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_user_state PRIMARY KEY (user_key, state_key),
    CONSTRAINT FK_user_state_user FOREIGN KEY (user_key) REFERENCES dbo.app_user(user_key) ON DELETE CASCADE,
    CONSTRAINT CK_user_state_json CHECK (ISJSON(payload) = 1)
);
GO

/* ── Semillas del catálogo que no vienen de JSON ──────────────────────────────
   Las categorías y los grupos los inserta el instalador desde los ficheros;
   aquí sólo se garantiza la categoría 'personal', que no está en el mazo base
   pero la necesita el cuaderno para ascender palabras. */
IF NOT EXISTS (SELECT 1 FROM dbo.card_category WHERE id = 'personal')
INSERT INTO dbo.card_category (id, label, sort_order) VALUES ('personal', N'Mis palabras', 99);
GO

/* ═══════════════════════════════════════════════════════════════════════════
   Consultas de ejemplo para informes sobre el progreso en JSON.

   -- Quién ha usado la aplicación y cuándo
   SELECT user_key, first_seen, last_seen FROM dbo.app_user ORDER BY last_seen DESC;

   -- Racha actual y mejor racha de cada persona
   SELECT user_key,
          JSON_VALUE(payload, '$.current') AS racha_actual,
          JSON_VALUE(payload, '$.best')    AS mejor_racha
   FROM dbo.user_state WHERE state_key = 'streak';

   -- Palabras del cuaderno por persona
   SELECT s.user_key, COUNT(*) AS palabras
   FROM dbo.user_state s CROSS APPLY OPENJSON(s.payload)
   WHERE s.state_key = 'notebook' GROUP BY s.user_key ORDER BY palabras DESC;

   -- Tarjetas dominadas (caja 5 de Leitner) por persona
   SELECT s.user_key, COUNT(*) AS dominadas
   FROM dbo.user_state s CROSS APPLY OPENJSON(s.payload) AS c
   WHERE s.state_key = 'srs' AND JSON_VALUE(c.value, '$.box') = '5'
   GROUP BY s.user_key ORDER BY dominadas DESC;
   ═══════════════════════════════════════════════════════════════════════════ */
