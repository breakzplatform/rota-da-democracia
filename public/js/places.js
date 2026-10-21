// Município typeahead, shard loading, section lookup, name search and "near me".
import { $, foldText, titleCase } from "./common.js";

let municipiosPromise;
export function loadMunicipios() {
  municipiosPromise ??= fetch("/data/municipios.json").then((response) => {
    if (!response.ok) throw new Error("municipios");
    return response.json();
  });
  return municipiosPromise;
}

const shards = new Map();
export function loadShard(cd) {
  if (!shards.has(cd)) {
    const promise = fetch(`/data/m/${encodeURIComponent(cd)}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("shard");
        return response.json();
      })
      .catch((error) => {
        shards.delete(cd);
        throw error;
      });
    shards.set(cd, promise);
  }
  return shards.get(cd);
}

export function findBySection(shard, zona, secao) {
  const z = Number(zona);
  const s = Number(secao);
  if (!Number.isInteger(z) || !Number.isInteger(s) || z <= 0 || s <= 0) return null;
  return shard.locais.find((local) => local.zona === z && local.secoes.includes(s)) || null;
}

export function searchPlaces(shard, query, limit = 20) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const local of shard.locais) {
    const name = local.nomeBusca;
    const rest = `${foldText(local.bairro)} ${foldText(local.endereco)}`;
    let score = 0;
    let all = true;
    for (const word of words) {
      if (name.includes(word)) score += 2;
      else if (rest.includes(word)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push([score, local]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, local]) => local);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function nearestPlaces(shard, lat, lon, limit = 10) {
  return shard.locais
    .filter((local) => local.lat !== null && local.lon !== null)
    .map((local) => ({ local, km: haversineKm(lat, lon, local.lat, local.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

export function formatKm(km) {
  return km < 1 ? `${Math.round(km * 10) * 100} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

export function placeLabel(local) {
  return `${titleCase(local.nome)} - ${titleCase(local.bairro)}`;
}

// ---- Typeahead (combobox over a listbox of buttons) ------------------

/**
 * `input` is a combobox; `list` a <ul role="listbox">. `getItems(query)` returns
 * [{ key, label, detail?, value }]; `onPick(value)` fires on selection.
 */
export function attachTypeahead({ input, list, getItems, onPick, minChars = 1 }) {
  let items = [];
  let active = -1;
  const idPrefix = `${list.id}-opt`;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const highlight = (index) => {
    const buttons = [...list.querySelectorAll("button")];
    buttons.forEach((button, position) => button.setAttribute("aria-selected", String(position === index)));
    active = index;
    if (buttons[index]) {
      input.setAttribute("aria-activedescendant", buttons[index].id);
      buttons[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const pick = (index) => {
    const item = items[index];
    if (!item) return;
    close();
    onPick(item.value);
  };

  const render = () => {
    const query = input.value;
    if (foldText(query).length < minChars) return close();
    items = getItems(query);
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("li");
      empty.setAttribute("role", "presentation");
      empty.className = "hint";
      empty.style.padding = "0.5rem 0.75rem";
      empty.textContent = "Nada encontrado. Confira a grafia.";
      list.append(empty);
    }
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "presentation");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `${idPrefix}-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
      button.textContent = item.label;
      if (item.detail) {
        const detail = document.createElement("small");
        detail.textContent = ` ${item.detail}`;
        detail.style.marginLeft = "0.4rem";
        detail.style.opacity = "0.75";
        button.append(detail);
      }
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => pick(index));
      li.append(button);
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", () => {
    if (input.value) render();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (list.hidden) render();
      if (items.length) highlight((active + 1) % items.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      if (items.length) highlight((active - 1 + items.length) % items.length);
      event.preventDefault();
    } else if (event.key === "Enter") {
      if (!list.hidden && active >= 0) {
        pick(active);
        event.preventDefault();
      } else if (!list.hidden && items.length === 1) {
        pick(0);
        event.preventDefault();
      }
    } else if (event.key === "Escape") {
      if (!list.hidden) {
        close();
        event.preventDefault();
      }
    }
  });

  return { close };
}

// ---- Step-by-step place picker (shared by buscar, oferecer, como-chegar) ----

const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
const ETITULO_LINKS = [
  ["e-Título no Android", "https://play.google.com/store/apps/details?id=br.jus.tse.eleitoral.etitulo"],
  ["e-Título no iPhone", "https://apps.apple.com/br/app/e-t%C3%ADtulo/id1320338088"],
  ["Onde votar no site do TSE", "https://www.tse.jus.br/servicos-eleitorais/autoatendimento-eleitoral#/atendimento-eleitor/onde-votar"],
];

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/**
 * Renders the picker into #seletor-local. Options: onMunicipio(entry|null, shard|null), onPlace(local|null, shard).
 * Returns { municipio(), shard(), local(), resolve() }.
 */
export function initPlacePicker({ onMunicipio = () => {}, onPlace = () => {}, cityOnly = false } = {}) {
  const mount = $("seletor-local");
  const status = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const body = h("div", { class: "picker-body" });
  mount.replaceChildren(status, body);

  // On phones the abroad link leaves step 1 for a box under the form, shown only until the form is touched.
  let abroad = null;
  if (!cityOnly) {
    abroad = h("a", { class: "panel exterior-cta", href: "/exterior" },
      h("strong", { text: "Vota no exterior?" }),
      h("span", { text: "Toque aqui" }));
    (mount.closest("form") || mount).after(abroad);
  }
  const dismissAbroad = () => {
    abroad?.remove();
    abroad = null;
  };
  mount.addEventListener("input", dismissAbroad);
  mount.addEventListener("change", dismissAbroad);

  const state = { municipio: null, shard: null, local: null, section: null, uf: "", cityText: "", view: "cidade" };
  let municipiosCache = [];
  let geoToken = 0;
  let nameTimer;
  const announce = (text) => {
    status.textContent = "";
    setTimeout(() => {
      status.textContent = text;
    }, 30);
  };

  loadMunicipios()
    .then((all) => {
      municipiosCache = all;
    })
    .catch(() => announce("Não foi possível carregar a lista de municípios. Recarregue a página."));

  const cityLabel = () => (state.municipio ? `${titleCase(state.municipio.nome)} (${state.municipio.uf})` : "");

  // -- navigation -----------------------------------------------------
  function go(view, { focus = true } = {}) {
    geoToken += 1;
    clearTimeout(nameTimer);
    state.view = view;
    if (view !== "cidade") dismissAbroad();
    const render = VIEWS[view];
    const heading = render();
    if (focus && heading) {
      heading.tabIndex = -1;
      heading.focus();
      announce(`${heading.dataset.step || ""} ${heading.textContent}`.trim());
    }
  }

  const backButton = (label, target) =>
    h("button", { type: "button", class: "link-back", text: label, onclick: () => go(target) });

  const stepHead = (stepNumber, title) => {
    const heading = h("h2", { class: "step-title", text: title });
    heading.dataset.step = `Passo ${stepNumber} de 3.`;
    return [h("p", { class: "eyebrow step-progress", text: `Passo ${stepNumber} de 3` }), heading];
  };

  const bigButton = (title, detail, onclick) =>
    h("button", { type: "button", class: "btn step-choice", onclick }, h("span", { class: "step-choice-title", text: title }), detail ? h("span", { class: "step-choice-detail", text: detail }) : null);

  const errorLine = () => h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (node, text) => {
    node.textContent = text;
    node.hidden = !text;
  };

  function shardOrMessage(errorNode) {
    if (!state.municipio) {
      showError(errorNode, "Escolha o município primeiro.");
      return null;
    }
    if (!state.shard) {
      showError(errorNode, "Os locais do município ainda estão carregando. Tente de novo em instantes.");
      return null;
    }
    return state.shard;
  }

  // -- place selection ------------------------------------------------
  function choosePlace(local, section = null) {
    state.local = local;
    state.section = section;
    onPlace(local, state.shard, section);
    go("resultado");
  }

  function clearPlace() {
    if (!state.local) return;
    state.local = null;
    state.section = null;
    onPlace(null, state.shard, null);
  }

  function placeButtons(rows) {
    const list = h("ul", { class: "nearby-list" });
    if (!rows.length) list.append(h("li", { class: "hint", text: "Nenhum local encontrado." }));
    for (const { local, km } of rows) {
      const label = `${placeLabel(local)}${km === undefined ? "" : ` - ${formatKm(km)}`}`;
      list.append(h("li", {}, h("button", { type: "button", text: label, onclick: () => choosePlace(local) })));
    }
    return list;
  }

  // -- views ----------------------------------------------------------
  const VIEWS = {
    cidade() {
      const [progress, heading] = stepHead(1, cityOnly ? "Em qual cidade?" : "Onde você vota?");
      if (cityOnly) progress.hidden = true;
      const ufSelect = h("select", { id: "uf", name: "uf" }, h("option", { value: "", text: "Escolha o estado" }), UFS.map((uf) => h("option", { value: uf, text: uf })));
      ufSelect.value = state.uf;
      const input = h("input", { id: "municipio-busca", type: "search", autocomplete: "off", placeholder: "Digite o nome da cidade", role: "combobox", "aria-expanded": "false", "aria-controls": "municipio-lista", "aria-autocomplete": "list" });
      input.value = state.cityText;
      const list = h("ul", { id: "municipio-lista", class: "listbox", role: "listbox", hidden: true });
      const note = h("p", { class: "hint", role: "status", text: cityOnly && state.municipio ? `Cidade escolhida: ${cityLabel()}` : "" });
      const head = cityOnly
        ? [progress, heading]
        : [h("div", { class: "step-head" },
            h("div", { class: "step-head-text" }, progress, heading),
            h("a", { class: "btn step-exterior", href: "/exterior", text: "Voto no exterior" }))];
      body.replaceChildren(
        ...head,
        h("div", { class: "field" }, h("label", { for: "uf", text: "Estado" }), ufSelect),
        h("div", { class: "field" }, h("label", { for: "municipio-busca", text: "Cidade" }), input, list),
        note,
      );
      ufSelect.addEventListener("change", () => {
        state.uf = ufSelect.value;
      });
      input.addEventListener("input", () => {
        state.cityText = input.value;
        if (state.municipio) {
          state.municipio = null;
          state.shard = null;
          clearPlace();
          onMunicipio(null, null);
        }
      });
      attachTypeahead({
        input,
        list,
        getItems(query) {
          const folded = foldText(query);
          const pool = state.uf ? municipiosCache.filter((m) => m.uf === state.uf) : municipiosCache;
          const starts = [];
          const contains = [];
          for (const m of pool) {
            if (m.nomeBusca.startsWith(folded)) starts.push(m);
            else if (m.nomeBusca.includes(folded)) contains.push(m);
            if (starts.length >= 12) break;
          }
          return [...starts, ...contains].slice(0, 12).map((m) => ({ label: titleCase(m.nome), detail: m.uf, value: m }));
        },
        onPick: selectMunicipio,
      });
      return heading;
    },

    conhece() {
      const [progress, heading] = stepHead(2, "Você sabe sua zona e seção?");
      body.replaceChildren(
        progress,
        heading,
        h("p", { class: "hint", text: `Município: ${cityLabel()}` }),
        h("div", { class: "step-choices" },
          bigButton("Sei minha zona e seção", "Digito os dois números", () => go("sei")),
          bigButton("Não sei", "Eu ajudo a descobrir", () => go("naosei")),
        ),
        backButton("Voltar: trocar cidade", "cidade"),
      );
      return heading;
    },

    sei() {
      const [progress, heading] = stepHead(2, "Informe sua zona e seção");
      const zona = h("input", { id: "zona", name: "zona", inputmode: "numeric", autocomplete: "off" });
      const secao = h("input", { id: "secao", name: "secao", inputmode: "numeric", autocomplete: "off" });
      const error = errorLine();
      const find = () => {
        const shard = shardOrMessage(error);
        if (!shard) return;
        const local = findBySection(shard, zona.value, secao.value);
        if (!local) {
          showError(error, "Não achamos essa zona e seção neste município. Confira os números no comprovante ou no e-Título.");
          announce(error.textContent);
          return;
        }
        choosePlace(local, Number(secao.value));
      };
      for (const field of [zona, secao]) {
        field.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            find();
          }
        });
      }
      body.replaceChildren(
        progress,
        heading,
        h("div", { class: "row-2" },
          h("div", { class: "field" }, h("label", { for: "zona", text: "Zona" }), zona),
          h("div", { class: "field" }, h("label", { for: "secao", text: "Seção" }), secao),
        ),
        error,
        h("div", { class: "form-actions" }, h("button", { type: "button", class: "btn btn-primary", text: "Encontrar", onclick: find })),
        backButton("Voltar", "conhece"),
      );
      return heading;
    },

    naosei() {
      const [progress, heading] = stepHead(2, "Como descobrir seu local?");
      body.replaceChildren(
        progress,
        heading,
        h("div", { class: "step-choices" },
          bigButton("Sei o nome da escola ou local", "Busco pelo nome ou pelo bairro", () => go("nome")),
          bigButton("Mostrar locais perto de mim", "Usa a localização do seu celular", () => go("perto")),
          bigButton("Descobrir no app e-Título ou no site do TSE", "A zona e a seção são as do 1º turno", () => go("etitulo")),
        ),
        backButton("Voltar", "conhece"),
      );
      return heading;
    },

    nome() {
      const [progress, heading] = stepHead(2, "Qual o nome do local ou do bairro?");
      const input = h("input", { id: "busca-local-nome", type: "search", autocomplete: "off", placeholder: "Nome da escola, igreja, clube ou bairro" });
      const error = errorLine();
      const results = h("div", { "aria-live": "polite" });
      input.addEventListener("input", () => {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(() => {
          showError(error, "");
          if (foldText(input.value).length < 2) return results.replaceChildren();
          const shard = shardOrMessage(error);
          if (!shard) return;
          results.replaceChildren(placeButtons(searchPlaces(shard, input.value, 10).map((local) => ({ local }))));
        }, 200);
      });
      body.replaceChildren(
        progress,
        heading,
        h("div", { class: "field" }, h("label", { for: "busca-local-nome", text: "Nome ou bairro" }), input),
        error,
        results,
        backButton("Voltar", "naosei"),
      );
      return heading;
    },

    perto() {
      const [progress, heading] = stepHead(2, "Locais perto de você");
      const message = h("p", { class: "hint", role: "status", text: "Procurando sua localização. Ela fica só no seu celular e não é enviada ao site." });
      const results = h("div");
      const retry = h("button", { type: "button", class: "btn", text: "Tentar de novo", hidden: true, onclick: () => go("perto", { focus: false }) });
      body.replaceChildren(progress, heading, message, results, retry, backButton("Voltar", "naosei"));
      const shard = state.shard;
      if (!shard) {
        message.textContent = "Os locais do município ainda estão carregando. Toque em Tentar de novo em instantes.";
        retry.hidden = false;
      } else if (!("geolocation" in navigator)) {
        message.textContent = "Seu navegador não oferece localização. Volte e busque pelo nome do local.";
      } else {
        const token = geoToken;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (token !== geoToken || shard !== state.shard) return;
            message.textContent = "Estes são os locais mais próximos. Toque no seu.";
            announce(message.textContent);
            results.replaceChildren(placeButtons(nearestPlaces(shard, position.coords.latitude, position.coords.longitude, 10)));
          },
          () => {
            if (token !== geoToken) return;
            message.textContent = "Não conseguimos pegar a localização. Permita o acesso e tente de novo, ou busque pelo nome do local.";
            retry.hidden = false;
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
        );
      }
      return heading;
    },

    etitulo() {
      const [progress, heading] = stepHead(2, "Descubra no e-Título ou no TSE");
      body.replaceChildren(
        progress,
        heading,
        h("p", { text: "A zona e a seção do 2º turno são as mesmas do 1º turno, a menos que o cartório tenha avisado outra coisa. Veja no comprovante de votação, no app e-Título ou na consulta do TSE." }),
        h("div", { class: "form-actions" }, ETITULO_LINKS.map(([label, href]) =>
          h("a", { class: "btn", href, target: "_blank", rel: "noopener noreferrer" }, label, h("span", { class: "sr-only", text: " (abre em nova aba)" })))),
        h("div", { class: "form-actions" }, h("button", { type: "button", class: "btn btn-primary", text: "Já descobri: informar zona e seção", onclick: () => go("sei") })),
        backButton("Voltar", "naosei"),
      );
      return heading;
    },

    resultado() {
      const local = state.local;
      const [progress, heading] = stepHead(3, "Seu local de votação");
      body.replaceChildren(
        progress,
        heading,
        h("div", { class: "place-card" },
          h("p", { class: "chosen", id: "local-escolhido", text: titleCase(local.nome) }),
          h("p", { text: titleCase(local.endereco) }),
          h("p", { class: "hint", text: `${titleCase(local.bairro)}${local.cep ? ` - CEP ${local.cep.slice(0, 5)}-${local.cep.slice(5)}` : ""} - zona ${local.zona}` }),
          h("p", { class: "offer-access", text: local.acessivel ? "Este local tem seções com acessibilidade." : "O TSE não informa acessibilidade neste local." }),
        ),
        h("button", { type: "button", class: "btn", text: "Trocar local", onclick: () => { clearPlace(); go("conhece"); } }),
      );
      return heading;
    },
  };

  async function selectMunicipio(entry) {
    state.municipio = entry;
    state.shard = null;
    state.uf = entry.uf;
    state.cityText = titleCase(entry.nome);
    clearPlace();
    onMunicipio(entry, null);
    if (cityOnly) {
      announce(`Cidade escolhida: ${cityLabel()}`);
      const note = body.querySelector(".hint[role=status]");
      if (note) note.textContent = `Cidade escolhida: ${cityLabel()}`;
      return;
    }
    go("conhece");
    try {
      const shard = await loadShard(entry.cd);
      if (state.municipio !== entry) return;
      state.shard = shard;
      onMunicipio(entry, shard);
    } catch {
      if (state.municipio === entry) announce("Não foi possível carregar os locais deste município. Volte e tente de novo.");
    }
  }

  go("cidade", { focus: false });

  return {
    municipio: () => state.municipio,
    shard: () => state.shard,
    local: () => state.local,
    /** { local, ok }: ok=false when no place is chosen yet; the picker moves to the step to fix it. */
    resolve() {
      if (state.local) return { local: state.local, ok: true };
      go(state.municipio ? "conhece" : "cidade");
      return { local: null, ok: false };
    },
  };
}
