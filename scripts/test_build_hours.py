import importlib.util
import io
import lzma
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('build_hours', Path(__file__).with_name('build-hours.py'))
hours = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(hours)
FIXTURE = Path(__file__).parent / 'fixtures' / 'urn-hours.txt'


class HoursTests(unittest.TestCase):
    def test_real_message_and_local_clock(self):
        result = hours.parse_log(FIXTURE.read_bytes(), ('AC', '01015', 2, 88))
        self.assertEqual(result['hours'], [2, 1, 0, 0, 0, 0, 0, 0, 2])
        self.assertEqual(result['place'], 1112)
        self.assertEqual(result['late'], 1)
        self.assertEqual(result['duplicates'], 1)

    def test_filename_preserves_municipality_zero(self):
        self.assertEqual(hours.log_key('folder/o03220ac0101500020088-log.jez'), ('AC', '01015', 2, 88))
        self.assertIsNone(hours.log_key('o03220ac0101500020088-bu.dat'))

    def test_clock_exceptions(self):
        self.assertEqual(hours.clock_shift('AM', '02917'), 2)
        self.assertEqual(hours.clock_shift('AM', '02550'), 1)
        self.assertEqual(hours.clock_shift('AM', '02151'), 1)
        self.assertEqual(hours.clock_shift('PE', '30015'), -1)
        self.assertEqual(hours.clock_shift('PE', '25313'), 0)
        self.assertEqual(hours.clock_shift('MT', '90670'), 1)

    def test_rejects_wrong_section(self):
        with self.assertRaisesRegex(ValueError, 'identity'):
            hours.parse_log(FIXTURE.read_bytes(), ('AC', '01015', 2, 89))

    def test_rejects_preopening_votes(self):
        raw = FIXTURE.read_bytes().replace(b'06:00:00', b'05:59:59')
        with self.assertRaisesRegex(ValueError, 'opening'):
            hours.parse_log(raw, ('AC', '01015', 2, 88))

    def test_zip_and_lzma_containers(self):
        raw = FIXTURE.read_bytes()
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('logd.dat', raw)
        self.assertEqual(hours.unpack_log(output.getvalue()), raw)
        self.assertEqual(hours.unpack_log(lzma.compress(raw)), raw)

    def test_empty_log_does_not_invent_zero_hours(self):
        raw = FIXTURE.read_bytes().split(b'04/10/2026')[0]
        self.assertIsNone(hours.parse_log(raw, ('AC', '01015', 2, 88)))

    def test_contingency_logs_include_original_urn_without_double_counting(self):
        raw = FIXTURE.read_bytes()
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w') as archive:
            archive.writestr('logd.dat', raw)
        outer = io.BytesIO()
        with zipfile.ZipFile(outer, 'w') as archive:
            archive.writestr('previous.jez', inner.getvalue())
            archive.writestr('logd.dat', raw)
        result = hours.parse_log(hours.unpack_log(outer.getvalue()), ('AC', '01015', 2, 88))
        self.assertEqual(sum(result['hours']), 5)
        self.assertEqual(result['place'], 1112)

    def test_publish_matches_keys_and_marks_changed_and_unknown_places(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            hours.write_json(data / 'm/01015.json', {
                'cd': '01015', 'uf': 'AC',
                'locais': [{'zona': 2, 'nr': 9999, 'secoes': [88, 89, 90, 91]}],
            })
            record = hours.parse_log(FIXTURE.read_bytes(), ('AC', '01015', 2, 88))
            result = dict(state='AC', source={}, errors=[], empty=[], formats={}, firstHours={}, samples=[],
                          sections={'01015/2-88': record, '01015/2-89': {**record, 'place': None},
                                    '01015/2-90': {**record, 'place': 9999}, '01015/2-100': record})
            hours.publish([result], data)
            self.assertEqual(json.loads((data / 'h/01015.json').read_text())['2-88'], [2, 1, 0, 0, 0, 0, 0, 0, 2])
            self.assertEqual(json.loads((data / 'h-changes/01015.json').read_text()), {'2-88': 1112, '2-89': None})
            audit = json.loads((data / 'hours-audit.json').read_text())
            self.assertEqual(audit['matchRate'], 0.75)
            self.assertEqual(audit['coverage'], 0.75)
            self.assertFalse(audit['complete'])

    def test_disk_guard_preserves_twenty_gibibytes(self):
        budget = hours.DiskBudget(Path('.'))
        with patch.object(hours.shutil, 'disk_usage') as usage:
            usage.return_value.free = 22 * hours.GIB
            with self.assertRaisesRegex(RuntimeError, 'Insufficient disk'):
                budget.reserve(2 * hours.GIB)

    def test_completed_state_resumes_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            hours.write_json(work / 'AC.json', {
                'version': hours.VERSION, 'state': 'AC', 'sections': {}, 'errors': [],
            })
            with patch.object(hours.urllib.request, 'urlopen', side_effect=AssertionError('Network in test')):
                self.assertEqual(hours.process_state('AC', work, hours.DiskBudget(work))['state'], 'AC')

    def test_range_download_rejects_full_response_and_changed_source(self):
        with patch.object(hours.urllib.request, 'urlopen') as request:
            response = request.return_value.__enter__.return_value
            response.status = 200
            with self.assertRaisesRegex(ValueError, 'range'):
                hours.read_range('https://example.test/data', 0, 3, 8, '"original"')
            response.status = 206
            response.headers = {'Content-Range': 'bytes 0-3/8', 'ETag': '"changed"'}
            with self.assertRaisesRegex(ValueError, 'changed'):
                hours.read_range('https://example.test/data', 0, 3, 8, '"original"')
            response.headers['ETag'] = '"original"'
            response.read.return_value = b'abcd'
            self.assertEqual(hours.read_range('https://example.test/data', 0, 3, 8, '"original"'), b'abcd')


if __name__ == '__main__':
    unittest.main()
