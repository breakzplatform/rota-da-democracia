#!/usr/bin/env python3
"""Tests for build-data.py.

Runs with: python3 -I -m unittest discover -s scripts -p 'test_*.py'
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_DATA_SCRIPT = os.path.join(SCRIPTS_DIR, "build-data.py")
FIXTURE_CSV = os.path.join(SCRIPTS_DIR, "fixtures", "tse_fixture.csv")

# Dynamically import build-data.py because of hyphen in filename
spec = importlib.util.spec_from_file_location("build_data", BUILD_DATA_SCRIPT)
if spec is None or spec.loader is None:
    raise ImportError(f"Cannot load spec from {BUILD_DATA_SCRIPT}")
build_data_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_data_module)


class TestBuildData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.out_dir = cls.temp_dir.name
        cls.stats = build_data_module.build_data(FIXTURE_CSV, cls.out_dir)

        with open(os.path.join(cls.out_dir, "municipios.json"), "r", encoding="utf-8") as f:
            cls.municipios = json.load(f)

        with open(os.path.join(cls.out_dir, "meta.json"), "r", encoding="utf-8") as f:
            cls.meta = json.load(f)

        with open(os.path.join(cls.out_dir, "m", "25313.json"), "r", encoding="utf-8") as f:
            cls.recife = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_zz_excluded(self):
        """Exterior (SG_UF == ZZ) must be excluded completely."""
        ufs = [m["uf"] for m in self.municipios]
        self.assertNotIn("ZZ", ufs)
        self.assertFalse(os.path.exists(os.path.join(self.out_dir, "m", "99999.json")))

    def test_inactive_rows_excluded(self):
        """Inactive sections are excluded; blocked locals keep their sections."""
        # Section 99 was inactive in local 1010
        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        self.assertNotIn(99, loc_1010["secoes"])

        # Local 1099 is BLOQUEADO: closed to new transfers, but section 88 still votes there
        loc_1099 = next(l for l in self.recife["locais"] if l["id"] == "1-1099")
        self.assertEqual(loc_1099["secoes"], [88])

    def test_aggregated_sections(self):
        """Aggregated sections map to principal's local and stay searchable in secoes."""
        # Section 15 aggregated to section 10 in Local 1020
        loc_1020 = next(l for l in self.recife["locais"] if l["id"] == "1-1020")
        self.assertIn(10, loc_1020["secoes"])
        self.assertIn(15, loc_1020["secoes"])

        # Section 20 aggregated to section 5 in Local 1010 (with local -1 in CSV)
        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        self.assertIn(5, loc_1010["secoes"])
        self.assertIn(20, loc_1010["secoes"])

    def test_missing_coords(self):
        """Decimal-comma parsed, -1/empty/0 treated as null."""
        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        self.assertIsNone(loc_1010["lat"])
        self.assertIsNone(loc_1010["lon"])

        loc_1005 = next(l for l in self.recife["locais"] if l["id"] == "2-1005")
        self.assertIsNone(loc_1005["lat"])
        self.assertIsNone(loc_1005["lon"])

        loc_1020 = next(l for l in self.recife["locais"] if l["id"] == "1-1020")
        self.assertEqual(loc_1020["lat"], -8.06)
        self.assertEqual(loc_1020["lon"], -34.88)

    def test_accessibility_flag(self):
        """acessivel is True if any section of the local is accessible."""
        # Local 1020: principal section 10 was not accessible, but aggregated 15 was accessible
        loc_1020 = next(l for l in self.recife["locais"] if l["id"] == "1-1020")
        self.assertTrue(loc_1020["acessivel"])

        # Local 1010: neither section was accessible
        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        self.assertFalse(loc_1010["acessivel"])

    def test_sorting(self):
        """Deterministic sorting for municipios, locais, and secoes."""
        # Municipios sorted by (uf, nome)
        expected_order = [("BA", "SALVADOR"), ("PA", "BELÉM"), ("PE", "RECIFE"), ("SP", "SÃO PAULO")]
        actual_order = [(m["uf"], m["nome"]) for m in self.municipios]
        self.assertEqual(actual_order, expected_order)

        # Locais sorted by (zona, nr)
        recife_ids = [l["id"] for l in self.recife["locais"]]
        self.assertEqual(recife_ids, ["1-1010", "1-1020", "1-1099", "2-1005"])

        # Secoes sorted ascending
        for loc in self.recife["locais"]:
            self.assertEqual(loc["secoes"], sorted(loc["secoes"]))

    def test_nome_busca(self):
        """nomeBusca is lowercased with accents stripped."""
        pa = next(m for m in self.municipios if m["cd"] == "04278")
        self.assertEqual(pa["nomeBusca"], "belem")

        sp = next(m for m in self.municipios if m["cd"] == "71072")
        self.assertEqual(sp["nomeBusca"], "sao paulo")

        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        self.assertEqual(loc_1010["nomeBusca"], "colegio anchieta")

    def test_meta_json(self):
        """meta.json has geradoEm, fonte, totalLocais, totalSecoes."""
        self.assertEqual(self.meta["geradoEm"], "01/10/2026")
        self.assertIn("eleitorado_local_votacao_2026.zip", self.meta["fonte"])
        self.assertEqual(self.meta["totalLocais"], 7)
        self.assertEqual(self.meta["totalSecoes"], 10)

    def test_runoff_place(self):
        """A section moved for the runoff is listed only at its 2nd-round place."""
        loc_1010 = next(l for l in self.recife["locais"] if l["id"] == "1-1010")
        loc_1020 = next(l for l in self.recife["locais"] if l["id"] == "1-1020")
        self.assertNotIn(30, loc_1010["secoes"])
        self.assertIn(30, loc_1020["secoes"])

    def test_minified_and_utf8(self):
        """Files must be minified UTF-8 JSON without unnecessary whitespace."""
        meta_path = os.path.join(self.out_dir, "meta.json")
        with open(meta_path, "rb") as f:
            raw_bytes = f.read()
        raw_text = raw_bytes.decode("utf-8")
        self.assertNotIn("\n", raw_text)
        self.assertNotIn(" : ", raw_text)
        self.assertNotIn(", ", raw_text)

    def test_cli_execution(self):
        """Script runnable via python3 -I scripts/build-data.py --csv ... --out ..."""
        with tempfile.TemporaryDirectory() as cli_tmp:
            cmd = [
                sys.executable,
                "-I",
                BUILD_DATA_SCRIPT,
                "--csv",
                FIXTURE_CSV,
                "--out",
                cli_tmp,
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(result.returncode, 0, f"CLI stderr: {result.stderr}")
            self.assertTrue(os.path.exists(os.path.join(cli_tmp, "municipios.json")))
            self.assertTrue(os.path.exists(os.path.join(cli_tmp, "meta.json")))
            self.assertTrue(os.path.exists(os.path.join(cli_tmp, "m", "25313.json")))


if __name__ == "__main__":
    unittest.main()
