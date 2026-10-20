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

// ---- Place picker (município + local) shared by the three pages -------

/**
 * Wires the shared "município + local de votação" block.
 * Options: onMunicipio(municipio|null, shard|null), onPlace(local, shard).
 * Returns { municipio(), shard(), local(), lookupBySection() }.
 */
export function initPlacePicker({ onMunicipio = () => {}, onPlace = () => {} } = {}) {
  const ufSelect = $("uf");
  const searchInput = $("municipio-busca");
  const hiddenMunicipio = $("municipio");
  const hiddenLocal = $("local-id");
  const chosen = $("local-escolhido");
  const nearbyList = $("locais-proximos") || document.createElement("ul");
  chosen.setAttribute("aria-live", "polite");

  const state = { municipio: null, shard: null, local: null };
  let municipiosCache = [];
  let nameTimer;

  const say = (text) => {
    chosen.textContent = text;
  };

  let geoToken = 0;
  const clearPlaceInputs = () => {
    for (const id of ["zona", "secao", "local-busca", "busca-local-nome"]) if ($(id)) $(id).value = "";
  };
  const resetHelpers = () => {
    geoToken += 1;
    clearTimeout(nameTimer);
    if (nearbyList) {
      nearbyList.replaceChildren();
      nearbyList.hidden = true;
    }
    clearPlaceInputs();
  };

  const selectPlace = (local, { fromSection = false, focusSummary = false } = {}) => {
    state.local = local;
    if (!fromSection) {
      $("zona").value = "";
      $("secao").value = "";
    }
    hiddenLocal.value = local.id;
    const sections = `zona ${local.zona}`;
    say(`Local escolhido: ${titleCase(local.nome)}, ${titleCase(local.endereco)} (${sections}).`);
    if (nearbyList) nearbyList.hidden = true;
    if (focusSummary) {
      chosen.tabIndex = -1;
      chosen.focus();
    }
    onPlace(local, state.shard);
  };

  const clearPlace = () => {
    state.local = null;
    hiddenLocal.value = "";
  };

  async function selectMunicipio(entry) {
    state.municipio = entry;
    state.shard = null;
    clearPlace();
    resetHelpers();
    hiddenMunicipio.value = entry.cd;
    searchInput.value = `${titleCase(entry.nome)} (${entry.uf})`;
    if (ufSelect.value !== entry.uf) ufSelect.value = entry.uf;
    say("Carregando os locais de votação do município...");
    onMunicipio(entry, null);
    try {
      const shard = await loadShard(entry.cd);
      if (state.municipio !== entry) return;
      state.shard = shard;
      say("Informe zona e seção, ou busque pelo nome do local.");
      onMunicipio(entry, shard);
    } catch {
      if (state.municipio === entry) say("Não foi possível carregar os locais deste município. Tente de novo.");
    }
  }

  loadMunicipios()
    .then((all) => {
      municipiosCache = all;
    })
    .catch(() => say("Não foi possível carregar a lista de municípios. Recarregue a página."));

  attachTypeahead({
    input: searchInput,
    list: $("municipio-lista"),
    getItems(query) {
      const folded = foldText(query);
      const uf = ufSelect.value;
      const pool = uf ? municipiosCache.filter((m) => m.uf === uf) : municipiosCache;
      const starts = [];
      const contains = [];
      for (const m of pool) {
        if (m.nomeBusca.startsWith(folded)) starts.push(m);
        else if (m.nomeBusca.includes(folded)) contains.push(m);
        if (starts.length >= 12) break;
      }
      return [...starts, ...contains].slice(0, 12).map((m) => ({
        label: titleCase(m.nome),
        detail: m.uf,
        value: m,
      }));
    },
    onPick: selectMunicipio,
  });

  searchInput.addEventListener("input", () => {
    if (state.municipio) {
      state.municipio = null;
      state.shard = null;
      hiddenMunicipio.value = "";
      clearPlace();
      resetHelpers();
      onMunicipio(null, null);
      say("O local escolhido aparece aqui.");
    }
  });
  ufSelect.addEventListener("change", () => {
    if (state.municipio && state.municipio.uf !== ufSelect.value) {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
    }
  });

  const invalidateLocal = () => {
    if (!state.local) return;
    clearPlace();
    say(state.shard ? "Informe zona e seção, ou busque pelo nome do local." : "O local escolhido aparece aqui.");
    onPlace(null, state.shard);
  };
  for (const id of ["zona", "secao", "local-busca"]) $(id).addEventListener("input", invalidateLocal);

  const requireShard = () => {
    if (!state.municipio) {
      say("Escolha o município primeiro.");
      searchInput.focus();
      return null;
    }
    if (!state.shard) {
      say("Os locais ainda estão carregando. Tente de novo em instantes.");
      return null;
    }
    return state.shard;
  };

  function lookupBySection() {
    const shard = requireShard();
    if (!shard) return null;
    const local = findBySection(shard, $("zona").value, $("secao").value);
    if (!local) {
      clearPlace();
      say("Não achamos essa zona e seção neste município. Confira os números no comprovante ou no e-Título.");
      return null;
    }
    selectPlace(local, { fromSection: true });
    return local;
  }

  /**
   * Re-resolves the place from whatever is typed. Returns { local, ok }:
   * ok=false means the user typed something that did not resolve (stop and show the message).
   */
  function resolve() {
    const zona = $("zona").value.trim();
    const secao = $("secao").value.trim();
    if (zona || secao) {
      if (!zona || !secao) {
        say("Informe zona e seção juntas.");
        return { local: null, ok: false };
      }
      const local = lookupBySection();
      return { local, ok: Boolean(local) };
    }
    if (state.local) return { local: state.local, ok: true };
    if ($("local-busca").value.trim()) {
      say("Escolha o local na lista que aparece ao digitar o nome.");
      return { local: null, ok: false };
    }
    return { local: null, ok: true };
  }
  $("achar-secao").addEventListener("click", lookupBySection);
  for (const id of ["zona", "secao"]) {
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        lookupBySection();
      }
    });
  }

  attachTypeahead({
    input: $("local-busca"),
    list: $("lista-locais"),
    minChars: 2,
    getItems(query) {
      if (!state.shard) return [];
      return searchPlaces(state.shard, query).map((local) => ({
        label: titleCase(local.nome),
        detail: titleCase(local.bairro),
        value: local,
      }));
    },
    onPick(local) {
      selectPlace(local);
      $("local-busca").value = titleCase(local.nome);
    },
  });

  // "Não sei minha seção" helpers: both render into #locais-proximos.
  const renderNearby = (rows, heading) => {
    nearbyList.replaceChildren();
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "Nenhum local encontrado.";
      nearbyList.append(li);
    }
    for (const { local, km } of rows) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${placeLabel(local)}${km === undefined ? "" : ` - ${formatKm(km)}`}`;
      button.addEventListener("click", () => selectPlace(local, { focusSummary: true }));
      li.append(button);
      nearbyList.append(li);
    }
    nearbyList.hidden = false;
    nearbyList.setAttribute("aria-label", heading);
  };

  $("busca-local-nome")?.addEventListener("input", (event) => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const query = event.target.value;
      if (foldText(query).length < 2) {
        nearbyList.hidden = true;
        return;
      }
      const shard = requireShard();
      if (!shard) return;
      renderNearby(
        searchPlaces(shard, query, 10).map((local) => ({ local })),
        "Locais encontrados",
      );
    }, 200);
  });

  $("perto-de-mim")?.addEventListener("click", () => {
    const shard = requireShard();
    if (!shard) return;
    if (!("geolocation" in navigator)) {
      say("Seu navegador não oferece localização. Busque pelo nome do local.");
      return;
    }
    say("Procurando sua localização... (ela fica só no seu celular)");
    const myToken = ++geoToken;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (myToken !== geoToken || shard !== state.shard) return;
        const rows = nearestPlaces(shard, position.coords.latitude, position.coords.longitude, 10);
        say("Locais mais próximos de você. Toque no seu.");
        renderNearby(rows, "Locais perto de você");
      },
      () => myToken === geoToken && say("Não conseguimos pegar a localização. Permita o acesso ou busque pelo nome do local."),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });

  return {
    municipio: () => state.municipio,
    shard: () => state.shard,
    local: () => state.local,
    lookupBySection,
    resolve,
  };
}
