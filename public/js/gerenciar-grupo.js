import { $, api, closeDialog, describeError, guardClosed, openDialog, setBusy, showMessage, titleCase } from "./common.js";
import { loadMunicipios } from "./places.js";

const params = new URLSearchParams(location.search);
const id = params.get("id");
const token = params.get("token");
// Keep the token only in memory: drop it from the address bar and history.
if (token) history.replaceState(null, "", location.pathname + (id ? `?id=${encodeURIComponent(id)}` : ""));
const status = $("estado-gerenciar");
const errorBox = $("erro-gerenciar");

function disable() {
  $("apagar-grupo").disabled = true;
}

async function load() {
  if (!id || !token) {
    status.textContent = "Link incompleto. Abra o endereço completo que você guardou ao cadastrar.";
    return disable();
  }
  status.textContent = "Carregando seu grupo...";
  try {
    const [group, municipios] = await Promise.all([
      api(`/api/grupos/${encodeURIComponent(id)}`, { token }),
      loadMunicipios().catch(() => []),
    ]);
    const entry = municipios.find((m) => m.cd === group.municipio);
    $("ver-nome").textContent = group.nome;
    $("ver-bairros").textContent = group.bairros;
    $("ver-municipio").textContent = entry ? `${titleCase(entry.nome)} (${entry.uf})` : group.municipio;
    $("ver-admin").textContent = group.admin ?? group.adminNome ?? "-";
    $("ver-link").textContent = group.link ?? "-";
    status.textContent = group.oculto || group.oculta ? "Seu grupo está oculto da busca por denúncias." : "Seu grupo está visível na busca.";
  } catch (failure) {
    status.textContent = describeError(failure);
    disable();
  }
}

const dialog = $("dialogo-apagar");
$("apagar-grupo").addEventListener("click", (event) => openDialog(dialog, event.currentTarget));
$("fechar-apagar").addEventListener("click", () => closeDialog(dialog));
$("confirmar-apagar").addEventListener("click", async () => {
  const confirm = $("confirmar-apagar");
  setBusy(confirm, true, "Apagando...");
  try {
    await api(`/api/grupos/${encodeURIComponent(id)}`, { method: "DELETE", body: { token } });
    closeDialog(dialog);
    document.querySelector('[aria-labelledby="titulo-ver"]').hidden = true;
    const done = $("grupo-apagado");
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
guardClosed(document.querySelector("main .stack"));
