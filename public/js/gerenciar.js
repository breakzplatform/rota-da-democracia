import {
  $, api, ApiFailure, closeDialog, describeError, focusField, clearInvalid, isoToTime, openDialog,
  setBusy, showMessage, timeToIso, titleCase,
} from "./common.js";
import { loadMunicipios } from "./places.js";

const params = new URLSearchParams(location.search);
const id = params.get("id");
const token = params.get("token");
const form = $("form-gerenciar");
const status = $("estado-gerenciar");
const errorBox = $("erro-gerenciar");

function showView(offer, municipioName) {
  $("ver-nome").textContent = offer.nome;
  $("ver-whatsapp").textContent = offer.whatsapp;
  $("ver-municipio").textContent = municipioName;
  $("ver-local").textContent = titleCase(offer.localNome);
  $("ver-bairro").textContent = offer.bairroSaida;
  $("saida").value = isoToTime(offer.saida);
  $("vagasLivres").value = String(offer.vagasLivres);
  $("pontoEncontro").value = offer.pontoEncontro;
  $("nota").value = offer.nota || "";
}

function describeVisibility(offer) {
  if (!offer.oculta) return "Sua oferta está visível na busca.";
  if (offer.denuncias >= 3) return "Sua oferta está oculta da busca por denúncias.";
  return "Sua oferta está fora da busca porque não tem vagas livres. Informe vagas livres para ela voltar.";
}

async function load() {
  if (!id || !token) {
    status.textContent = "Link incompleto. Abra o endereço completo que você guardou ao publicar.";
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = true;
    });
    return;
  }
  $("oferta-id").value = id;
  $("token").value = token;
  status.textContent = "Carregando sua oferta...";
  try {
    const [offer, municipios] = await Promise.all([
      api(`/api/ofertas/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`),
      loadMunicipios().catch(() => []),
    ]);
    const entry = municipios.find((m) => m.cd === offer.municipio);
    showView(offer, entry ? `${titleCase(entry.nome)} (${entry.uf})` : offer.municipio);
    status.textContent = describeVisibility(offer);
  } catch (failure) {
    status.textContent = describeError(failure);
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = true;
    });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInvalid();
  showMessage(errorBox, "");
  const submit = $("salvar-oferta");
  setBusy(submit, true, "Salvando...");
  try {
    const offer = await api(`/api/ofertas/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        token,
        vagasLivres: Number($("vagasLivres").value),
        saida: timeToIso($("saida").value),
        pontoEncontro: $("pontoEncontro").value.trim(),
        nota: $("nota").value.trim(),
      },
    });
    $("nota").value = offer.nota || "";
    status.textContent = `Alterações salvas. ${describeVisibility(offer)}`;
  } catch (failure) {
    showMessage(errorBox, describeError(failure));
    if (failure instanceof ApiFailure && failure.field) focusField(failure.field);
  } finally {
    setBusy(submit, false);
  }
});

const dialog = $("dialogo-cancelar");
$("cancelar-oferta").addEventListener("click", (event) => openDialog(dialog, event.currentTarget));
$("fechar-cancelamento").addEventListener("click", () => closeDialog(dialog));
$("confirmar-cancelamento").addEventListener("click", async () => {
  const confirm = $("confirmar-cancelamento");
  setBusy(confirm, true, "Cancelando...");
  try {
    await api(`/api/ofertas/${encodeURIComponent(id)}`, { method: "DELETE", body: { token } });
    dialog.close();
    form.hidden = true;
    const done = $("oferta-cancelada");
    done.hidden = false;
    done.setAttribute("tabindex", "-1");
    done.focus();
  } catch (failure) {
    closeDialog(dialog);
    showMessage(errorBox, describeError(failure));
  } finally {
    setBusy(confirm, false);
  }
});

load();
