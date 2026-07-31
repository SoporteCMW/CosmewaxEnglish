/**
 * Comparación de texto: normalización, distancia de edición y diff por palabras.
 *
 * Aislado de la UI a propósito — es la parte con lógica real (y la única que
 * merece test unitario si algún día se añaden).
 */

// Diacríticos combinantes (U+0300..U+036F) que deja NFD al descomponer.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '') // quita tildes/diacríticos tras NFD
    .replace(/[^a-z0-9'\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeWord(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9']/g, '');
}

/**
 * El campo `en` de una tarjeta admite alternativas con "/" ("client / customer")
 * y siglas entre paréntesis ("Cosmetic Product Safety Report (CPSR)"). Esto lo
 * expande a la lista plana de respuestas aceptadas.
 */
export function parseAlternatives(english) {
  const alternatives = [];
  String(english)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      alternatives.push(part);
      const match = part.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (match) {
        alternatives.push(match[1].trim());
        alternatives.push(match[2].trim());
      }
    });

  return alternatives;
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Diff por palabras (subsecuencia común más larga) entre lo dicho/escrito y la
 * respuesta correcta más cercana.
 *
 * @returns {Array<{type:'match'|'missing'|'extra', word:string}>}
 */
export function wordDiff(userWords, correctWords) {
  const a = userWords.map(normalizeWord);
  const b = correctWords.map(normalizeWord);
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: 'match', word: correctWords[j - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: 'extra', word: userWords[i - 1] });
      i -= 1;
    } else {
      ops.push({ type: 'missing', word: correctWords[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    ops.push({ type: 'extra', word: userWords[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    ops.push({ type: 'missing', word: correctWords[j - 1] });
    j -= 1;
  }

  return ops.reverse();
}

export function splitWords(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

/**
 * Corrige la respuesta de una tarjeta.
 *
 * @returns {{classification:'correct'|'close'|'incorrect', correctAlt:string, diffOps:Array|null, userAnswer:string}}
 */
export function evaluateAnswer(userInput, card) {
  const alternatives = parseAlternatives(card.en);
  const normalizedUser = normalize(userInput);
  const normalizedAlternatives = alternatives.map(normalize);

  const exactIndex = normalizedAlternatives.indexOf(normalizedUser);
  if (exactIndex !== -1) {
    return {
      classification: 'correct',
      correctAlt: alternatives[exactIndex],
      diffOps: null,
      userAnswer: userInput,
    };
  }

  let bestIndex = 0;
  let bestDistance = Infinity;
  normalizedAlternatives.forEach((candidate, index) => {
    const distance = levenshtein(normalizedUser, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  const closest = alternatives[bestIndex];
  // Umbral proporcional: un fallo de una letra en "resin" no es lo mismo que en
  // "Cosmetic Product Safety Report".
  const threshold = Math.max(2, Math.round(normalizedAlternatives[bestIndex].length * 0.25));

  return {
    classification: bestDistance <= threshold ? 'close' : 'incorrect',
    correctAlt: closest,
    diffOps: wordDiff(splitWords(userInput), splitWords(closest)),
    userAnswer: userInput,
  };
}
