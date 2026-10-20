#!/usr/bin/env python3
"""Writes public/data/h-changes/<municipio>.json from the TSE polling-place file.

A section is marked as moved ({"<zona>-<secao>": true}) when its polling place in the 2nd
round differs from the 1st round, both read from the same TSE file
(eleitorado_local_votacao_2026, NR_TURNO 1 and 2). The urn logs are not used for this: they
carry the place number from before a TSE renumbering, which flags thousands of sections that
never moved. Every municipality with hourly data gets a file, empty when nothing moved.

Usage: python3 -I scripts/build-changes.py --csv eleitorado_local_votacao_2026_BRASIL.csv [--data public/data]
Run after build-hours.py, which writes its own (log-based) h-changes that this replaces.
"""
import argparse
import csv
import json
from pathlib import Path


def moved_sections(csv_path: str) -> dict[str, dict[str, bool]]:
    places: dict[tuple[str, str], dict[str, str]] = {}
    with open(csv_path, encoding="latin-1", newline="") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            if row["SG_UF"] == "ZZ" or row["NR_TURNO"] not in ("1", "2"):
                continue
            key = (row["CD_MUNICIPIO"].strip().zfill(5), f"{int(row['NR_ZONA'])}-{int(row['NR_SECAO'])}")
            places.setdefault(key, {})[row["NR_TURNO"]] = row["NR_LOCAL_VOTACAO"].strip()
    moved: dict[str, dict[str, bool]] = {}
    for (municipality, section), rounds in places.items():
        if "1" in rounds and "2" in rounds and rounds["1"] != rounds["2"]:
            moved.setdefault(municipality, {})[section] = True
    return moved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", required=True)
    parser.add_argument("--data", default="public/data")
    args = parser.parse_args()
    data = Path(args.data)
    moved = moved_sections(args.csv)
    out = data / "h-changes"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    municipalities = sorted(path.stem for path in (data / "h").glob("*.json"))
    for municipality in municipalities:
        (out / f"{municipality}.json").write_text(
            json.dumps(moved.get(municipality, {}), separators=(",", ":"), sort_keys=True))
    print(f"{sum(len(v) for v in moved.values())} moved sections in {len(moved)} municipalities; "
          f"{len(municipalities)} files written")


if __name__ == "__main__":
    main()
