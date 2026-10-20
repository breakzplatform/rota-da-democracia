import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('build_abroad', Path(__file__).with_name('build-abroad.py'))
abroad = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(abroad)


def row(section):
    return dict(SG_UF='ZZ', NR_TURNO='2', DT_GERACAO='20/10/2026',
                CD_MUNICIPIO='30422', NM_MUNICIPIO='TÓQUIO', NR_ZONA='1', NR_SECAO=str(section),
                CD_SITU_SECAO='1', DS_SITU_SECAO='', CD_SITU_LOCAL_VOTACAO='5',
                DS_SITU_LOCAL_VOTACAO='BLOQUEADO', CD_TIPO_SECAO_AGREGADA='-1',
                NR_SECAO_PRINCIPAL='-1', NR_LOCAL_VOTACAO='1234', NM_LOCAL_VOTACAO='Árvore',
                DS_ENDERECO='Rua Um', QT_ELEITOR_SECAO='10')


class AbroadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.csv = self.work / 'places.csv'
        self.hours = self.work / 'ZZ.json'
        self.places = self.work / 'places.json'
        self.out = self.work / 'exterior.json'
        self.rows = [row(number) for number in (651, 652, 653, 654)]
        self.rows += [{**row(655), 'CD_TIPO_SECAO_AGREGADA': '2', 'NR_SECAO_PRINCIPAL': '656'},
                      {**row(656), 'CD_TIPO_SECAO_AGREGADA': '2', 'NR_SECAO_PRINCIPAL': '651'},
                      {**row(657), 'NR_TURNO': '1'},
                      {**row(658), 'CD_SITU_SECAO': '2'},
                      {**row(659), 'SG_UF': 'SP'}]
        self.table = {'30422/1-1234': dict(pais='JP', paisNome='Japão', cidadeLocal='Tóquio',
                                        tz='Asia/Tokyo', lat=35.63, lon=139.79)}
        self.records = dict(state='ZZ', sections={'30422/1-651': {'hours': [1] * 9},
                                                '30422/1-652': {'hours': [2] * 9}},
                            paper=['30422/1-653'])

    def build(self, zipped=False):
        with self.csv.open('w', encoding='latin-1', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=self.rows[0], delimiter=';')
            writer.writeheader()
            writer.writerows(self.rows)
        source = self.csv
        if zipped:
            source = self.work / 'places.zip'
            with zipfile.ZipFile(source, 'w') as archive:
                archive.writestr('eleitorado_local_votacao_2026_SP.csv', b'irrelevant')
                archive.write(self.csv, 'eleitorado_local_votacao_2026_ZZ.csv')
        self.hours.write_text(json.dumps(self.records))
        self.places.write_text(json.dumps(self.table))
        with patch('sys.argv', ['build-abroad.py', '--csv', str(source), '--hours', str(self.hours),
                                '--places', str(self.places), '--out', str(self.out)]):
            abroad.main()
        return json.loads(self.out.read_text())

    def test_csv_and_zip_build_main_sections_and_aggregated_voters(self):
        result = self.build()
        self.assertEqual(self.build(zipped=True), result)
        self.assertEqual(result['geradoEm'], '2026-10-20')
        self.assertEqual(result['totais'], dict(locais=1, secoes=4, secoesComDado=2, cedula=1, semLog=1))
        city = result['paises'][0]['cidades'][0]
        self.assertEqual(city['nomeBusca'], 'toquio')
        place = city['locais'][0]
        self.assertEqual(place['secoes'], [651, 652, 653, 654])
        self.assertEqual(place['cedula'], [653])
        self.assertEqual(place['semDado'], [654])
        self.assertEqual(place['eleitores'], 60)
        self.assertEqual(place['horas'], [3] * 9)
        self.assertEqual(place['nomeBusca'], 'arvore')
        self.assertIn('Japão', self.out.read_text())
        self.assertNotIn('\n', self.out.read_text())

    def test_no_log_is_null(self):
        self.records['sections'] = {}
        self.assertIsNone(self.build()['paises'][0]['cidades'][0]['locais'][0]['horas'])

    def test_missing_unknown_invalid_timezone_and_country_fail(self):
        cases = [({}, 'Missing place'),
                 ({**self.table, '99999/1-1': self.table['30422/1-1234']}, 'Unknown place'),
                 ({'30422/1-1234': {**self.table['30422/1-1234'], 'tz': 'Invalid/Zone'}}, 'Invalid time zone'),
                 ({'30422/1-1234': {**self.table['30422/1-1234'], 'pais': 'BR'}}, 'country')]
        for table, message in cases:
            with self.subTest(message=message):
                self.table = table
                with patch('sys.stderr', new_callable=io.StringIO) as error, self.assertRaises(SystemExit) as exit:
                    self.build()
                self.assertEqual(exit.exception.code, 2)
                self.assertIn(message, error.getvalue())
                self.assertFalse(self.out.exists())

    def test_timezone_tables_merge_countries_and_warn_when_absent(self):
        (self.work / 'zone1970.tab').write_text('JP,XX\t+0000+00000\tAsia/Tokyo\n')
        (self.work / 'zone.tab').write_text('JP\t+0000+00000\tAsia/Tokyo\n')
        self.assertEqual(abroad.timezone_countries(self.work)['Asia/Tokyo'], {'JP', 'XX'})
        with patch('sys.stderr', new_callable=io.StringIO) as warning:
            self.assertIsNone(abroad.timezone_countries(self.work / 'missing'))
        self.assertIn('warning', warning.getvalue().lower())

    def test_aggregated_fallback_cycles_and_inactive_places(self):
        self.rows += [{**row(660), 'CD_TIPO_SECAO_AGREGADA': '2', 'NR_SECAO_PRINCIPAL': '661'},
                      {**row(661), 'CD_TIPO_SECAO_AGREGADA': '2', 'NR_SECAO_PRINCIPAL': '660'},
                      {**row(662), 'CD_TIPO_SECAO_AGREGADA': '2', 'NR_SECAO_PRINCIPAL': '999',
                       'NR_LOCAL_VOTACAO': '9999'},
                      {**row(663), 'CD_SITU_LOCAL_VOTACAO': '2', 'DS_SITU_LOCAL_VOTACAO': 'INATIVO',
                       'NR_LOCAL_VOTACAO': '9999'},
                      {**row(664), 'NR_TURNO': ''}]
        result = self.build()
        place = result['paises'][0]['cidades'][0]['locais'][0]
        self.assertEqual(place['eleitores'], 80)
        self.assertEqual(place['secoes'], [651, 652, 653, 654])

    def test_invalid_hours_and_conflicting_paper_fail(self):
        for buckets in ([1] * 8, [-1] * 9, [True] * 9):
            with self.subTest(buckets=buckets):
                self.records['sections']['30422/1-651']['hours'] = buckets
                with patch('sys.stderr', new_callable=io.StringIO) as error, self.assertRaises(SystemExit):
                    self.build()
                self.assertIn('Invalid hourly buckets', error.getvalue())
        self.records['sections']['30422/1-651']['hours'] = [1] * 9
        self.records['paper'].append('30422/1-651')
        with patch('sys.stderr', new_callable=io.StringIO) as error, self.assertRaises(SystemExit):
            self.build()
        self.assertIn('both log and paper', error.getvalue())

    def test_order_does_not_depend_on_csv_or_table_order(self):
        self.rows += [{**row(700), 'CD_MUNICIPIO': '99999', 'NM_MUNICIPIO': 'ÁBACO'}]
        self.table['99999/1-1234'] = self.table['30422/1-1234']
        expected = self.build()
        self.rows.reverse()
        self.table = dict(reversed(list(self.table.items())))
        self.assertEqual(self.build(), expected)
        self.assertEqual([city['nome'] for city in expected['paises'][0]['cidades']], ['ÁBACO', 'TÓQUIO'])

    def test_country_uses_place_and_order_is_folded(self):
        self.rows += [{**row(700), 'NR_LOCAL_VOTACAO': '9999', 'NM_LOCAL_VOTACAO': 'Zebra'},
                      {**row(701), 'NR_LOCAL_VOTACAO': '9998', 'NM_LOCAL_VOTACAO': 'Ábaco'}]
        self.table['30422/1-9999'] = dict(pais='AR', paisNome='Argentina', cidadeLocal='Buenos Aires',
                                         tz='America/Argentina/Buenos_Aires', lat=-34.6, lon=-58.4)
        self.table['30422/1-9998'] = self.table['30422/1-1234']
        result = self.build()
        self.assertEqual([country['iso'] for country in result['paises']], ['AR', 'JP'])
        self.assertEqual([place['nome'] for place in result['paises'][1]['cidades'][0]['locais']],
                         ['Ábaco', 'Árvore'])


if __name__ == '__main__':
    unittest.main()
