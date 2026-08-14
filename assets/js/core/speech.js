/**
 * Envoltura de Web Speech API (dictado + síntesis).
 *
 * Concentra aquí las dos rarezas del navegador: el prefijo `webkit` y que sólo
 * puede haber un reconocimiento activo a la vez (dos instancias simultáneas se
 * pelean por el micrófono y una falla en silencio).
 */

let activeDictation = null;

function RecognitionClass() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isDictationSupported() {
  return RecognitionClass() !== null;
}

export function isSynthesisSupported() {
  return 'speechSynthesis' in window;
}

export function describeSpeechError(code) {
  switch (code) {
    case 'not-allowed':
    case 'permission-denied':
      return 'Permiso de micrófono denegado. Revisa los permisos del navegador para esta página, o usa el modo texto.';
    case 'no-speech':
      return 'No se detectó voz. Pulsa el micrófono y habla justo después.';
    case 'audio-capture':
      return 'No se ha encontrado micrófono en este dispositivo.';
    case 'network':
      return 'El reconocimiento de voz necesita conexión y no pudo contactar con el servicio.';
    default:
      return 'No se pudo procesar el audio. Inténtalo de nuevo.';
  }
}

export const UNSUPPORTED_MESSAGE =
  'Este navegador no soporta reconocimiento de voz (funciona mejor en Chrome/Edge). Usa el campo de texto.';

export const INSECURE_CONTEXT_MESSAGE =
  'El micrófono está bloqueado porque la página no se sirve en un contexto seguro. ' +
  'Entra por https:// o por http://localhost/CosmewaxEnglish/. ' +
  'Con una URL http:// de red (http://cosmewaxdevjd/…) el navegador no da acceso al micrófono. ' +
  'Mientras tanto, todos los modos funcionan escribiendo.';

/**
 * Por qué no se puede dictar, o null si sí se puede.
 *
 * El orden importa: en Chrome sobre HTTP de red el constructor
 * `webkitSpeechRecognition` **existe**, así que comprobar sólo el soporte da un
 * falso positivo y el fallo llega después como un `not-allowed` sin explicación.
 * `isSecureContext` es la comprobación que de verdad decide.
 */
export function dictationUnavailableReason() {
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    return INSECURE_CONTEXT_MESSAGE;
  }
  if (!isDictationSupported()) {
    return UNSUPPORTED_MESSAGE;
  }

  return null;
}

export class Dictation {
  constructor({ continuous = false, interim = false, lang = 'en-US' } = {}) {
    this.options = { continuous, interim, lang };
    this.recognition = null;
    this.listening = false;
    this.startedAt = null;
  }

  get isListening() {
    return this.listening;
  }

  /** Milisegundos desde que se pulsó el micrófono hasta el primer resultado. */
  get latencyMs() {
    return this.startedAt === null ? null : Date.now() - this.startedAt;
  }

  /**
   * @param {{onFinal?:Function,onInterim?:Function,onError?:Function,onEnd?:Function}} handlers
   * @returns {boolean} false si el navegador no lo soporta
   */
  start(handlers = {}) {
    const Recognition = RecognitionClass();
    if (!Recognition) return false;

    if (activeDictation && activeDictation !== this) {
      activeDictation.stop();
    }

    const recognition = new Recognition();
    recognition.lang = this.options.lang;
    recognition.continuous = this.options.continuous;
    recognition.interimResults = this.options.interim;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += `${piece} `;
        else interimChunk += piece;
      }
      if (finalChunk && handlers.onFinal) handlers.onFinal(finalChunk, this.latencyMs);
      if (interimChunk && handlers.onInterim) handlers.onInterim(interimChunk);
    };

    recognition.onerror = (event) => {
      this.listening = false;
      if (handlers.onError) handlers.onError(event.error, describeSpeechError(event.error));
    };

    recognition.onend = () => {
      this.listening = false;
      if (activeDictation === this) activeDictation = null;
      if (handlers.onEnd) handlers.onEnd();
    };

    this.recognition = recognition;
    this.startedAt = Date.now();
    this.listening = true;
    activeDictation = this;

    try {
      recognition.start();
      return true;
    } catch (err) {
      this.listening = false;
      activeDictation = null;
      if (handlers.onError) {
        handlers.onError('start-failed', 'No se pudo iniciar el micrófono. Inténtalo de nuevo.');
      }
      return false;
    }
  }

  stop() {
    if (this.recognition && this.listening) {
      try {
        this.recognition.stop();
      } catch (err) {
        /* ya estaba parado */
      }
    }
    this.listening = false;
  }
}

/**
 * Locución en curso. Cualquier cosa que interrumpa la síntesis —hablar otra vez
 * o cancelar— invalida la anterior.
 *
 * Lo necesita speakTracked(): un pasaje largo se dice en varias locuciones
 * encadenadas, y `cancel()` dispara el `onend` de la que suena en ese momento.
 * Sin este contador, detener el audio arrancaría el trozo siguiente en lugar de
 * callarse.
 */
let speechRun = 0;

function startRun() {
  speechRun += 1;
  return speechRun;
}

export function speak(text, { rate = 0.95, lang = 'en-US' } = {}) {
  if (!isSynthesisSupported() || !text) return;
  startRun();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

/**
 * Parte un texto largo en trozos de frase entera, sin cortar palabras.
 *
 * Una frase más larga que el tope se queda entera: partirla por la mitad se
 * oiría peor que decirla de una vez.
 */
function splitForSpeech(text, maxChars = 220) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = '';

  sentences.forEach((sentence) => {
    if (current !== '' && (current + sentence).length > maxChars) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  });
  if (current.trim() !== '') chunks.push(current.trim());

  return chunks;
}

/**
 * Como speak(), pero avisa al terminar y aguanta textos largos.
 *
 * Lo necesita el modo Listening para saber cuándo el "audio" ha acabado y volver
 * a poner el botón en "Reproducir". `onEnd` se llama también en error: si no, un
 * fallo de la síntesis dejaría el botón congelado en "Detener" para siempre.
 *
 * El pasaje se dice por frases, no de una sola vez: desde que dura varios
 * minutos (largo de examen B2) una única locución no llega al final —Chrome
 * corta la síntesis a los pocos segundos— y el alumno se quedaba sin la mitad
 * del audio del que luego le preguntan. El corte entre trozos es inaudible y
 * `onEnd` sigue llegando una sola vez, al acabar el último.
 */
export function speakTracked(text, { rate = 0.95, lang = 'en-US', onEnd } = {}) {
  if (!isSynthesisSupported() || !text) {
    if (onEnd) onEnd();
    return;
  }

  const run = startRun();
  window.speechSynthesis.cancel();
  const chunks = splitForSpeech(text);

  const sayChunk = (index) => {
    // Otra locución (o una cancelación) ha tomado el relevo: aquí no se sigue.
    if (run !== speechRun) return;
    if (index >= chunks.length) {
      if (onEnd) onEnd();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.onend = () => sayChunk(index + 1);
    utterance.onerror = () => {
      if (run === speechRun && onEnd) onEnd();
    };
    window.speechSynthesis.speak(utterance);
  };

  sayChunk(0);
}

/** Encola varias palabras con una pausa entre ellas (repaso de pronunciación). */
export function speakSequence(words, { rate = 0.85, gapMs = 900, lang = 'en-US' } = {}) {
  if (!isSynthesisSupported() || !words.length) return;
  startRun();
  window.speechSynthesis.cancel();
  words.forEach((word, index) => {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = lang;
    utterance.rate = rate;
    window.setTimeout(() => window.speechSynthesis.speak(utterance), index * gapMs);
  });
}

export function cancelSpeech() {
  if (!isSynthesisSupported()) return;
  startRun();
  window.speechSynthesis.cancel();
}
