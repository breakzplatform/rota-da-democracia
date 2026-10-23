// Instagram sharing: the Web Share API with a file lets phones offer Instagram
// (Stories, Feed, Direct) in the share sheet. Without file sharing, download.
import { copyText } from "./common.js";

export const SITE_URL = "https://rotadademocracia.online";

export function canShareFiles() {
  if (!navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([""], "teste.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Instagram drops the share text, so the caption also goes to the clipboard
// to be pasted there. Both calls start in the same tick to keep the click's
// user activation, which Safari requires for share() and the clipboard.
// Returns the status message to show.
export async function shareImage(blob, filename, caption) {
  const file = new File([blob], filename, { type: "image/png" });
  const copied = copyText(caption);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
    } catch (error) {
      if (error?.name === "AbortError") return "";
      download(blob, filename);
      return "Não foi possível abrir o compartilhamento. A imagem foi baixada.";
    }
    return (await copied) ? "Legenda copiada: cole no Instagram." : "";
  }
  download(blob, filename);
  return (await copied)
    ? "Imagem baixada e legenda copiada. Poste pelo Instagram no celular."
    : "Imagem baixada. Poste pelo Instagram no celular.";
}

// ---- Personalized story ------------------------------------------------

const RED = "#c80000";
const YELLOW = "#ffe403";
const BLUE = "#0034d2";
const GREEN = "#02ab20";
const INK = "#142026";
const DISPLAY = '"Roboto Condensed", "Arial Narrow", sans-serif';
const MONO = '"Roboto Mono", ui-monospace, monospace';

let fontsReady = null;
function loadFonts() {
  fontsReady ??= Promise.all([
    new FontFace("Roboto Condensed", "url(/assets/fonts/roboto-condensed-latin.woff2)", { weight: "100 900" }),
    new FontFace("Roboto Mono", "url(/assets/fonts/roboto-mono-latin.woff2)", { weight: "100 700" }),
  ].map((face) => face.load().then((loaded) => document.fonts.add(loaded))))
    // The fallback fonts still draw a readable story.
    .catch(() => {});
  return fontsReady;
}

function wrap(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function fillTracked(ctx, text, x, y, tracking) {
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${tracking}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = "0px";
  } else {
    ctx.fillText(text, x, y);
  }
}

// Draws a 1080x1920 story in the visual language of the Instagram kit
// (Story 1). Only the hour and the place are printed: never zona or seção.
export async function drawHourStory({ hour, localTime, place }) {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  const left = 84;
  const width = 1080 - left * 2;

  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 1080, 1920);
  [BLUE, YELLOW, GREEN].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index * 360, 0, 360, 28);
  });
  ctx.fillStyle = INK;
  ctx.fillRect(0, 28, 1080, 6);

  ctx.textBaseline = "alphabetic";
  let y = 300;
  ctx.fillStyle = YELLOW;
  ctx.font = `700 34px ${DISPLAY}`;
  fillTracked(ctx, "2º TURNO · DOMINGO, 25/10", left, y, 2.7);

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 120px ${DISPLAY}`;
  y += 56;
  for (const line of ["MINHA HORA", "MAIS TRANQUILA", "PRA VOTAR:"]) {
    y += 110;
    ctx.fillText(line, left, y);
  }

  ctx.fillStyle = YELLOW;
  ctx.font = `900 400px ${DISPLAY}`;
  y += 360;
  ctx.fillText(`${hour}H`, left - 10, y);

  ctx.fillStyle = "#ffffff";
  if (localTime) {
    ctx.font = `700 40px ${DISPLAY}`;
    y += 60;
    ctx.fillText("horário local", left, y);
  }

  ctx.font = `700 50px ${DISPLAY}`;
  y += 60;
  for (const line of wrap(ctx, place, width, 3)) {
    y += 62;
    ctx.fillText(line, left, y);
  }

  ctx.font = `400 34px ${DISPLAY}`;
  y += 70;
  ctx.fillStyle = "#ffe4e1";
  for (const line of wrap(ctx, "Estimativa pelos registros das urnas do 1º turno. Votação das 8h às 17h (horário de Brasília).", width, 2)) {
    ctx.fillText(line, left, y);
    y += 44;
  }

  const boxY = Math.max(y + 40, 1500);
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = 5;
  ctx.setLineDash([16, 10]);
  ctx.beginPath();
  ctx.roundRect(left, boxY, 640, 150, 22);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = YELLOW;
  ctx.font = `500 34px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("rotadademocracia.online", left + 320, boxY + 75);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas"))), "image/png");
  });
}
