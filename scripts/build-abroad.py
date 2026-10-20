#!/usr/bin/env python3
"""Build abroad polling places and local hourly turnout from TSE round-two data."""

import argparse
import csv
from datetime import datetime
import io
import json
from pathlib import Path
import runpy
import sys
import zipfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DATA = runpy.run_path(str(Path(__file__).with_name('build-data.py')))
SOURCE = runpy.run_path(str(Path(__file__).with_name('build-hours.py')))['SOURCE']
fold = DATA['normalize_nome_busca']
is_active = DATA['is_active']


def read_rows(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.upper().endswith('_ZZ.CSV')]
            if len(names) != 1:
                raise ValueError('Expected one ZZ CSV in archive')
            with archive.open(names[0]) as stream:
                yield from csv.DictReader(io.TextIOWrapper(stream, encoding='latin-1'), delimiter=';')
    else:
        with path.open(encoding='latin-1', newline='') as stream:
            yield from csv.DictReader(stream, delimiter=';')


def read_places(path):
    places = {}
    sections = {}
    aggregated = {}
    generated = ''
    for row in read_rows(path):
        if row.get('SG_UF', '').strip().upper() != 'ZZ' or row.get('NR_TURNO', '').strip() != '2':
            continue
        if not generated:
            generated = row.get('DT_GERACAO', '').strip()
        if not is_active(row.get('CD_SITU_SECAO', ''), row.get('DS_SITU_SECAO', '')):
            continue
        city = row.get('CD_MUNICIPIO', '').strip()
        try:
            zone = int(row.get('NR_ZONA', '-1'))
            section = int(row.get('NR_SECAO', '-1'))
        except ValueError:
            continue
        if not city or zone < 0 or section < 0:
            continue
        try:
            principal = int(row.get('NR_SECAO_PRINCIPAL', '-1'))
        except ValueError:
            principal = -1
        voters = int(row.get('QT_ELEITOR_SECAO', '0'))
        key = (city, zone, section)
        number = row.get('NR_LOCAL_VOTACAO', '-1').strip()
        if row.get('CD_TIPO_SECAO_AGREGADA', '-1').strip() not in ('-1', '', '#NULO') and principal > 0 and principal != section:
            fallback = f'{city}/{zone}-{int(number)}' if number.isdigit() and int(number) > 0 else None
            aggregated[key] = (principal, fallback, voters)
            continue
        code = row.get('CD_SITU_LOCAL_VOTACAO', '').strip()
        status = row.get('DS_SITU_LOCAL_VOTACAO', '').strip().upper()
        if not is_active(code, status) and code != '5' and status != 'BLOQUEADO':
            continue
        try:
            number = int(number)
        except ValueError:
            continue
        if number < 0:
            continue
        place_key = f'{city}/{zone}-{number}'
        if place_key not in places:
            name = row.get('NM_LOCAL_VOTACAO', '').strip()
            places[place_key] = dict(id=f'{zone}-{number}', nome=name, nomeBusca=fold(name),
                                    endereco=row.get('DS_ENDERECO', '').strip(), eleitores=0, secoes=[],
                                    city=city, cityName=row.get('NM_MUNICIPIO', '').strip(), zone=zone)
        places[place_key]['secoes'].append(section)
        places[place_key]['eleitores'] += voters
        sections[key] = place_key
    for (city, zone, section), (principal, fallback, voters) in aggregated.items():
        current = principal
        visited = set()
        target = None
        while current not in visited:
            visited.add(current)
            key = (city, zone, current)
            if key in sections:
                target = sections[key]
                break
            if key not in aggregated:
                break
            current = aggregated[key][0]
        if target is None and fallback in places:
            target = fallback
        if target is not None:
            places[target]['eleitores'] += voters
            sections[(city, zone, section)] = target
    if not places:
        raise ValueError('No active round-two ZZ places')
    return places, datetime.strptime(generated, '%d/%m/%Y').date().isoformat() if generated else ''


def timezone_countries(directory=Path('/usr/share/zoneinfo')):
    countries = {}
    found = False
    for name in ('zone1970.tab', 'zone.tab'):
        path = directory / name
        if not path.exists():
            continue
        found = True
        for line in path.read_text(encoding='utf-8').splitlines():
            if not line or line.startswith('#'):
                continue
            codes, coordinates, zone, *rest = line.split('\t')
            countries.setdefault(zone, set()).update(codes.split(','))
    if not found:
        print('Warning: zone1970.tab and zone.tab absent; skipping time zone country validation', file=sys.stderr)
        return None
    return countries


def build(csv_path, hours_path, places_path):
    places, generated = read_places(csv_path)
    table = json.loads(places_path.read_text(encoding='utf-8'))
    missing = places.keys() - table.keys()
    unknown = table.keys() - places.keys()
    if missing:
        raise ValueError(f'Missing place entries: {", ".join(sorted(missing))}')
    if unknown:
        raise ValueError(f'Unknown place entries: {", ".join(sorted(unknown))}')
    zone_countries = timezone_countries()
    for key, entry in table.items():
        try:
            ZoneInfo(entry['tz'])
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f'Invalid time zone for {key}: {entry["tz"]}') from error
        if zone_countries is not None and entry['pais'] not in zone_countries.get(entry['tz'], set()):
            raise ValueError(f'Time zone country mismatch for {key}: {entry["tz"]} / {entry["pais"]}')
    records = json.loads(hours_path.read_text(encoding='utf-8'))
    if records.get('state') != 'ZZ':
        raise ValueError('Expected ZZ hourly result')
    paper = set(records['paper'])
    countries = {}
    totals = dict(locais=len(places), secoes=0, secoesComDado=0, cedula=0, semLog=0)
    for key, place in sorted(places.items()):
        entry = table[key]
        city_code, city_name, zone = (place.pop(field) for field in ('city', 'cityName', 'zone'))
        country = countries.setdefault(entry['pais'], dict(iso=entry['pais'], nome=entry['paisNome'], cidades={}))
        city = country['cidades'].setdefault(city_code, dict(cd=city_code, nome=city_name,
                                                          nomeBusca=fold(city_name), locais=[]))
        place.update({field: entry[field] for field in ('cidadeLocal', 'tz', 'lat', 'lon')})
        place.update(cedula=[], semDado=[], horas=None)
        place['secoes'].sort()
        for section in place['secoes']:
            section_key = f'{city_code}/{zone}-{section}'
            record = records['sections'].get(section_key)
            totals['secoes'] += 1
            if record is not None:
                buckets = record['hours']
                if len(buckets) != 9 or any(type(count) is not int or count < 0 for count in buckets):
                    raise ValueError(f'Invalid hourly buckets: {section_key}')
                if section_key in paper:
                    raise ValueError(f'Section has both log and paper ballot: {section_key}')
                place['horas'] = [a + b for a, b in zip(place['horas'] or [0] * 9, buckets)]
                totals['secoesComDado'] += 1
            elif section_key in paper:
                place['cedula'].append(section)
                totals['cedula'] += 1
            else:
                place['semDado'].append(section)
                totals['semLog'] += 1
        city['locais'].append(place)
    for country in countries.values():
        country['cidades'] = sorted(country['cidades'].values(), key=lambda city: (fold(city['nome']), city['cd']))
        for city in country['cidades']:
            city['locais'].sort(key=lambda place: (fold(place['nome']), place['id']))
    return dict(geradoEm=generated, fonte=dict(locais=DATA['TSE_DEFAULT_URL'], horas=SOURCE, licenca='CC-BY 4.0'),
                totais=totals, paises=sorted(countries.values(), key=lambda country: (fold(country['nome']), country['iso'])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, required=True)
    parser.add_argument('--hours', type=Path, required=True)
    parser.add_argument('--places', type=Path, default=Path('scripts/abroad-places.json'))
    parser.add_argument('--out', type=Path, default=Path('public/data/exterior.json'))
    args = parser.parse_args()
    try:
        result = build(args.csv, args.hours, args.places)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    totals = result['totais']
    print(f'{totals["locais"]} places, {totals["secoesComDado"]} sections with data, '
          f'{totals["cedula"]} paper, {totals["semLog"]} no log')


if __name__ == '__main__':
    main()
