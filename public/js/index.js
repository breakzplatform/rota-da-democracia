import { $, copyText, guardClosed, updateSignupDeadline } from "./common.js";
import { canShareFiles, shareImage } from "./instagram.js";

updateSignupDeadline();

guardClosed(document.querySelector(".hero .actions"));

// Shared people post these from their own profiles, so no "link na bio".
const CAPTIONS = {
  "post-1-hora":
    "Qual a hora mais tranquila pra votar na sua seção? O Rota da Democracia calcula com os registros das urnas do 1º turno e já monta a rota de ônibus ou de carro chegando nesse horário.\n\nInforme seu município, zona e seção em rotadademocracia.online\n\n2º turno: domingo, 25 de outubro, das 8h às 17h (horário de Brasília).\n\n#eleicoes2026 #segundoturno #vote #rotadademocracia",
  "post-2-como":
    "Em 3 passos:\n1. Diga seu município, zona e seção (estão no título de eleitor e no e-Título).\n2. Veja a hora com menos movimento na sua seção, pelos dados do 1º turno.\n3. Abra a rota no Google Maps já chegando nesse horário.\n\nÉ grátis, não pede cadastro e não guarda seus dados.\nrotadademocracia.online",
  "post-3-carona":
    "Tem lugar sobrando no carro no domingo? Ofereça uma carona solidária para quem não tem como chegar ao local de votação. De graça, combinando direto com a pessoa.\n\nPrecisa de carona? Veja as ofertas para o seu local.\n\nCadastros até domingo, 25/10, às 7h59.\nrotadademocracia.online",
  "post-4-duvidas":
    "Não votou no 1º turno? Você vota normalmente no 2º. Confira antes sua seção e seu local: o TSE mudou o local de algumas seções.\n\nVota no exterior? Tem a hora mais tranquila de cada local, no horário local e no de Brasília.\n\nrotadademocracia.online",
  "story-1-hora":
    "Qual a hora mais tranquila pra votar na sua seção? Veja a hora e a rota chegando nesse horário: rotadademocracia.online",
  "story-2-domingo":
    "2º turno: domingo, 25 de outubro, das 8h às 17h (horário de Brasília). Leve documento oficial com foto ou o e-Título. rotadademocracia.online",
  "story-3-carona":
    "Carona solidária, de graça, para ir votar no domingo, 25/10. Cadastros até as 7h59. rotadademocracia.online",
};

const cards = document.querySelectorAll(".share-card[data-image]");
const status = $("estado-instagram");
const images = new Map();

function imageBlob(name) {
  if (!images.has(name)) {
    const request = fetch(`/share/${name}.png`).then((response) =>
      response.ok ? response.blob() : Promise.reject(new Error(name)),
    );
    request.catch(() => images.delete(name));
    images.set(name, request);
  }
  return images.get(name);
}

// Safari only allows share() shortly after the tap, so the files are fetched
// before it, as soon as the section comes into view.
if (cards.length && canShareFiles()) {
  for (const card of cards) {
    const link = card.querySelector("a.btn");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = "Compartilhar";
    link.replaceWith(button);
    button.addEventListener("click", async () => {
      const name = card.dataset.image;
      status.textContent = "";
      try {
        status.textContent = await shareImage(await imageBlob(name), `rota-da-democracia-${name}.png`, CAPTIONS[name]);
      } catch {
        status.textContent = "Não foi possível carregar a imagem. Tente de novo.";
      }
    });
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    for (const card of cards) imageBlob(card.dataset.image).catch(() => {});
  }, { rootMargin: "400px" });
  observer.observe($("instagram"));
} else {
  // Desktop: the plain download link stays; it also copies the caption.
  for (const card of cards) {
    card.querySelector("a.btn").addEventListener("click", async () => {
      status.textContent = (await copyText(CAPTIONS[card.dataset.image]))
        ? "Imagem baixada e legenda copiada. Poste pelo Instagram no celular."
        : "Imagem baixada. Poste pelo Instagram no celular.";
    });
  }
}
