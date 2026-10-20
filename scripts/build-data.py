#!/usr/bin/env python3
"""Build election polling place data from TSE CSV.

Python 3 standard library only.
Deterministic output: UTF-8, minified JSON with ensure_ascii=False.
"""

import argparse
import csv
import json
import os
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from typing import Any, Dict, List, Optional, Tuple

TSE_DEFAULT_URL = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitorado/"
    "eleitorado_local_votacao_ATUAL.zip"
)


def normalize_nome_busca(s: str) -> str:
    """Return lowercase string with diacritics/accents stripped."""
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s.strip())
    stripped = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return stripped.lower()


def parse_coord(val: Optional[Any]) -> Optional[float]:
    """Parse coordinate from decimal-comma string. Return None if -1, 0, or empty."""
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("-1", "0", "#NULO", "-1.0", "0.0", "-1,0", "0,0"):
        return None
    s = s.replace(",", ".")
    try:
        f = float(s)
        if f == -1.0 or f == 0.0:
            return None
        return round(f, 8)
    except (ValueError, TypeError):
        return None


def is_active(code: str, desc: str) -> bool:
    """Check if section or local status is active."""
    c = str(code).strip()
    d = str(desc).strip().upper()
    return c == "1" or d == "ATIVO"


def is_accessible(code: str, desc: str) -> bool:
    """Check if section has accessibility."""
    c = str(code).strip()
    d = str(desc).strip().lower()
    return c == "1" or d == "com acessibilidade"


def process_csv_stream(csv_path: str) -> Tuple[Dict[str, Any], str]:
    """Stream CSV file and build normalized data structures in memory.

    Returns:
        (municipios_dict, dt_geracao)
    """
    municipios: Dict[str, Dict[str, Any]] = {}
    section_to_local: Dict[Tuple[str, int, int], Tuple[int, int]] = {}
    aggregated_sections: List[Dict[str, Any]] = []
    agg_principals: Dict[Tuple[str, int, int], int] = {}
    dt_geracao = ""

    with open(csv_path, "r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            uf = row.get("SG_UF", "").strip().upper()
            if uf == "ZZ":
                continue

            if not dt_geracao:
                dt_geracao = row.get("DT_GERACAO", "").strip()

            situ_secao = row.get("DS_SITU_SECAO", "")
            cd_situ_secao = row.get("CD_SITU_SECAO", "")
            if not is_active(cd_situ_secao, situ_secao):
                continue

            cd_mun = row.get("CD_MUNICIPIO", "").strip()
            if not cd_mun:
                continue

            try:
                zona = int(row.get("NR_ZONA", "-1").strip())
                secao = int(row.get("NR_SECAO", "-1").strip())
            except ValueError:
                continue

            if zona < 0 or secao < 0:
                continue

            tipo_agregada = row.get("CD_TIPO_SECAO_AGREGADA", "-1").strip()
            principal_raw = row.get("NR_SECAO_PRINCIPAL", "-1").strip()
            try:
                principal_secao = int(principal_raw)
            except ValueError:
                principal_secao = -1

            sec_acessivel = is_accessible(
                row.get("CD_SITU_SECAO_ACESSIBILIDADE", ""),
                row.get("DS_SITU_SECAO_ACESSIBILIDADE", "")
            )

            is_aggregated = (
                tipo_agregada not in ("-1", "", "#NULO")
                and principal_secao > 0
                and principal_secao != secao
            )

            if is_aggregated:
                local_raw = row.get("NR_LOCAL_VOTACAO", "-1").strip()
                fallback_nr = int(local_raw) if local_raw.isdigit() and int(local_raw) > 0 else None
                aggregated_sections.append({
                    "cd_mun": cd_mun,
                    "zona": zona,
                    "secao": secao,
                    "principal_secao": principal_secao,
                    "fallback_local": fallback_nr,
                    "acessivel": sec_acessivel,
                })
                agg_principals[(cd_mun, zona, secao)] = principal_secao
                continue

            situ_local = row.get("DS_SITU_LOCAL_VOTACAO", "")
            cd_situ_local = row.get("CD_SITU_LOCAL_VOTACAO", "")
            if not is_active(cd_situ_local, situ_local):
                continue

            try:
                nr_local = int(row.get("NR_LOCAL_VOTACAO", "-1").strip())
            except ValueError:
                continue
            if nr_local < 0:
                continue

            if cd_mun not in municipios:
                nm_mun = row.get("NM_MUNICIPIO", "").strip()
                municipios[cd_mun] = {
                    "cd": cd_mun,
                    "uf": uf,
                    "nome": nm_mun,
                    "nomeBusca": normalize_nome_busca(nm_mun),
                    "locais": {},
                }

            m = municipios[cd_mun]
            local_key = (zona, nr_local)
            if local_key not in m["locais"]:
                nm_local = row.get("NM_LOCAL_VOTACAO", "").strip()
                m["locais"][local_key] = {
                    "id": f"{zona}-{nr_local}",
                    "zona": zona,
                    "nr": nr_local,
                    "nome": nm_local,
                    "nomeBusca": normalize_nome_busca(nm_local),
                    "endereco": row.get("DS_ENDERECO", "").strip(),
                    "bairro": row.get("NM_BAIRRO", "").strip(),
                    "cep": row.get("NR_CEP", "").strip(),
                    "lat": parse_coord(row.get("NR_LATITUDE")),
                    "lon": parse_coord(row.get("NR_LONGITUDE")),
                    "acessivel": False,
                    "secoes": set(),
                }
            else:
                loc = m["locais"][local_key]
                if loc["lat"] is None:
                    loc["lat"] = parse_coord(row.get("NR_LATITUDE"))
                if loc["lon"] is None:
                    loc["lon"] = parse_coord(row.get("NR_LONGITUDE"))

            loc = m["locais"][local_key]
            loc["secoes"].add(secao)
            if sec_acessivel:
                loc["acessivel"] = True

            section_to_local[(cd_mun, zona, secao)] = local_key

    # Resolve aggregated sections
    for agg in aggregated_sections:
        cd_mun = agg["cd_mun"]
        zona = agg["zona"]
        secao = agg["secao"]
        principal_secao = agg["principal_secao"]
        acessivel = agg["acessivel"]
        fallback = agg["fallback_local"]

        # Follow chain if principal is also an aggregated section
        curr = principal_secao
        visited = set()
        target_local_key = None
        while curr not in visited:
            visited.add(curr)
            if (cd_mun, zona, curr) in section_to_local:
                target_local_key = section_to_local[(cd_mun, zona, curr)]
                break
            if (cd_mun, zona, curr) in agg_principals:
                curr = agg_principals[(cd_mun, zona, curr)]
            else:
                break

        if not target_local_key and fallback is not None:
            if cd_mun in municipios and (zona, fallback) in municipios[cd_mun]["locais"]:
                target_local_key = (zona, fallback)

        if target_local_key and cd_mun in municipios and target_local_key in municipios[cd_mun]["locais"]:
            loc = municipios[cd_mun]["locais"][target_local_key]
            loc["secoes"].add(secao)
            if acessivel:
                loc["acessivel"] = True
            section_to_local[(cd_mun, zona, secao)] = target_local_key

    return municipios, dt_geracao


def write_outputs(
    municipios: Dict[str, Any], dt_geracao: str, out_dir: str
) -> Dict[str, Any]:
    """Write municipios.json, m/<cd>.json and meta.json in minified UTF-8 format."""
    os.makedirs(out_dir, exist_ok=True)
    m_dir = os.path.join(out_dir, "m")
    os.makedirs(m_dir, exist_ok=True)

    valid_municipios = {}
    total_locais = 0
    total_secoes = 0

    for cd_mun, m in municipios.items():
        valid_locais = [loc for loc in m["locais"].values() if loc["secoes"]]
        if not valid_locais:
            continue
        valid_locais.sort(key=lambda x: (x["zona"], x["nr"]))

        m_copy = {
            "cd": m["cd"],
            "uf": m["uf"],
            "nome": m["nome"],
            "locais": [
                {
                    "id": loc["id"],
                    "zona": loc["zona"],
                    "nr": loc["nr"],
                    "nome": loc["nome"],
                    "nomeBusca": loc["nomeBusca"],
                    "endereco": loc["endereco"],
                    "bairro": loc["bairro"],
                    "cep": loc["cep"],
                    "lat": loc["lat"],
                    "lon": loc["lon"],
                    "acessivel": loc["acessivel"],
                    "secoes": sorted(loc["secoes"]),
                }
                for loc in valid_locais
            ],
        }

        valid_municipios[cd_mun] = {
            "uf": m["uf"],
            "cd": m["cd"],
            "nome": m["nome"],
            "nomeBusca": m["nomeBusca"],
        }
        total_locais += len(valid_locais)
        total_secoes += sum(len(loc["secoes"]) for loc in m_copy["locais"])

        m_file_path = os.path.join(m_dir, f"{cd_mun}.json")
        with open(m_file_path, "w", encoding="utf-8") as f:
            json.dump(m_copy, f, separators=(",", ":"), ensure_ascii=False)

    sorted_municipios_list = sorted(
        valid_municipios.values(),
        key=lambda x: (x["uf"], x["nome"], x["cd"])
    )

    municipios_file_path = os.path.join(out_dir, "municipios.json")
    with open(municipios_file_path, "w", encoding="utf-8") as f:
        json.dump(sorted_municipios_list, f, separators=(",", ":"), ensure_ascii=False)

    meta = {
        "geradoEm": dt_geracao or "",
        "fonte": TSE_DEFAULT_URL,
        "totalLocais": total_locais,
        "totalSecoes": total_secoes,
    }
    meta_file_path = os.path.join(out_dir, "meta.json")
    with open(meta_file_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"), ensure_ascii=False)

    return {
        "municipios": len(sorted_municipios_list),
        "locais": total_locais,
        "secoes": total_secoes,
        "meta": meta,
    }


def build_data(csv_path: str, out_dir: str) -> Dict[str, Any]:
    """Parse CSV and write output JSON files."""
    municipios, dt_geracao = process_csv_stream(csv_path)
    return write_outputs(municipios, dt_geracao, out_dir)


def download_and_extract_tse(url: str, target_dir: str) -> str:
    """Download TSE zip and extract CSV file into target_dir."""
    zip_path = os.path.join(target_dir, "tse_data.zip")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; CaronaPelaDemocracia/1.0)"}
    )
    with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as out_file:
        chunk_size = 64 * 1024
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_file.write(chunk)

    with zipfile.ZipFile(zip_path, "r") as z:
        csv_files = [name for name in z.namelist() if name.lower().endswith(".csv")]
        if not csv_files:
            raise FileNotFoundError("No CSV file found in downloaded ZIP")
        csv_name = csv_files[0]
        z.extract(csv_name, target_dir)
        return os.path.join(target_dir, csv_name)


def main():
    parser = argparse.ArgumentParser(
        description="Build election polling place data from TSE CSV"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--csv", type=str, help="Path to TSE CSV file")
    group.add_argument(
        "--download", action="store_true", help="Download TSE zip file"
    )
    parser.add_argument(
        "--out",
        type=str,
        default="public/data",
        help="Output directory (default: public/data)",
    )

    args = parser.parse_args()

    if not args.csv and not args.download:
        parser.error("Either --csv PATH or --download must be specified.")

    if args.download:
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = download_and_extract_tse(TSE_DEFAULT_URL, tmpdir)
            stats = build_data(csv_path, args.out)
    else:
        stats = build_data(args.csv, args.out)

    print(
        f"Data build complete: {stats['municipios']} municipios, "
        f"{stats['locais']} locais, {stats['secoes']} secoes written to {args.out}"
    )


if __name__ == "__main__":
    main()
