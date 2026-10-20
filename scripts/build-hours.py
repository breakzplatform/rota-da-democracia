#!/usr/bin/env python3
"""Extract first-round hourly turnout, retaining resumable per-state audit files."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
import io
import json
import lzma
from pathlib import Path
import re
import shutil
import threading
import time
import urllib.request
import zipfile

STATES = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split()
URL = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/arqurnatot/bu_imgbu_logjez_rdv_vscmr_2026_1t_{}.zip'
SOURCE = 'https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao'
VOTE = 'O voto do eleitor foi computado'
DATE = '04/10/2026'
VERSION = 1
GIB = 1024 ** 3
# TRE-AM's 2026 voting-clock list, including Amatura; see docs/hourly-turnout.md.
AM_TWO_HOURS = {'02917', '02054', '02135', '02291', '02313', '02020', '02399', '98370', '02496', '02755', '98477'}
NAME = re.compile(r'o\d{5}([a-z]{2})(\d{5})(\d{4})(\d{4})(?:-log\.jez|\.logjez)$', re.I)
MAX_LOG = 64 * 1024 * 1024


def log_key(name):
    match = NAME.fullmatch(Path(name).name)
    if not match:
        return None
    state, municipality, zone, section = match.groups()
    return state.upper(), municipality, int(zone), int(section)


def clock_shift(state, municipality):
    if state == 'AC' or (state == 'AM' and municipality in AM_TWO_HOURS):
        return 2
    if state in {'AM', 'MT', 'MS', 'RO', 'RR'}:
        return 1
    if state == 'PE' and municipality == '30015':
        return -1
    return 0


def unpack_log(raw, depth=0):
    if depth > 8:
        raise ValueError('Excessive nested log depth')
    if raw.startswith(b'PK\x03\x04'):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if sum(entry.file_size for entry in entries) > MAX_LOG:
                raise ValueError('Unexpected log container')
            parts = []
            for entry in entries:
                if entry.filename == 'logd.dat':
                    parts.append(archive.read(entry))
                elif entry.filename.endswith('.jez'):
                    parts.append(unpack_log(archive.read(entry), depth + 1))
                else:
                    raise ValueError(f'Unexpected log entry: {entry.filename}')
            text = b'\n\0\n'.join(parts)
            if len(text) > MAX_LOG:
                raise ValueError('Oversize expanded log')
            return text
    # lzma handles .xz and standalone LZMA, but not a 7z container.
    if raw.startswith(b'7z\xbc\xaf\x27\x1c'):
        raise ValueError('7z container requires verified py7zr support; no such container in inspected data')
    decoder = lzma.LZMADecompressor()
    text = decoder.decompress(raw, max_length=MAX_LOG + 1)
    if len(text) > MAX_LOG or not decoder.eof:
        raise ValueError('Oversize or incomplete LZMA log')
    return text


def parse_log(raw, key):
    state, municipality, zone, section = key
    shift = clock_shift(state, municipality)
    identity = {}
    place = None
    place_identity = None
    pending_place = None
    voting_places = set()
    hours = [0] * 9
    local_hours = Counter()
    events = set()
    late = duplicates = 0
    first = last = None
    labels = {'Município: ': 'municipality', 'Zona Eleitoral: ': 'zone', 'Seção Eleitoral: ': 'section'}
    expected = {'municipality': int(municipality), 'zone': zone, 'section': section}
    for line in raw.decode('latin-1').splitlines():
        if line == '\0':
            identity = {}
            place = place_identity = pending_place = None
            continue
        fields = line.split('\t')
        if len(fields) < 5:
            continue
        stamp, level, urn, app, message = fields[:5]
        for label, field in labels.items():
            if message.startswith(label):
                identity[field] = int(message[len(label):])
                if field == 'section' and pending_place is not None:
                    place = pending_place
                    place_identity = identity.copy()
                    pending_place = None
        if message.startswith('Local de Votação: '):
            pending_place = int(message.split(': ')[1])
        if message != VOTE or app != 'VOTA' or not stamp.startswith(DATE + ' '):
            continue
        if identity != expected:
            raise ValueError(f'Log/filename identity mismatch: {identity} != {expected}')
        event = tuple(fields)
        if event in events:
            duplicates += 1
            continue
        events.add(event)
        if place and place_identity == expected:
            voting_places.add(place)
        timestamp = datetime.strptime(stamp, '%d/%m/%Y %H:%M:%S')
        hour = timestamp.hour + shift
        if hour < 8:
            raise ValueError(f'Vote before opening after conversion: {stamp}, shift {shift}')
        hours[min(hour, 16) - 8] += 1
        local_hours[str(timestamp.hour)] += 1
        late += hour >= 17
        first = min(first, stamp) if first else stamp
        last = max(last, stamp) if last else stamp
    if not events:
        return None
    return dict(hours=hours, place=next(iter(voting_places)) if len(voting_places) == 1 else None,
                late=late, duplicates=duplicates,
                first=first, last=last, localHours=dict(local_hours), shift=shift)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True), encoding='utf-8')
    temporary.replace(path)


def read_range(url, start, end, size, etag):
    headers = {'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'}
    if etag:
        headers['If-Range'] = etag
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
            raise ValueError('Server did not honor download range')
        if etag and response.headers.get('ETag') != etag:
            raise ValueError('Source changed during download')
        raw = response.read(end - start + 2)
        if len(raw) != end - start + 1:
            raise OSError('Incomplete download range')
        return raw


class DiskBudget:
    """Reserve full remaining downloads; recheck free space before every write."""
    def __init__(self, directory):
        self.directory = directory
        self.condition = threading.Condition()
        self.reserved = 0

    def reserve(self, size):
        with self.condition:
            while shutil.disk_usage(self.directory).free - self.reserved - size < 21 * GIB:
                if not self.reserved:
                    raise RuntimeError('Insufficient disk: must retain more than 20 GiB free')
                self.condition.wait(timeout=5)
            self.reserved += size

    def release(self, size):
        with self.condition:
            self.reserved -= size
            self.condition.notify_all()

    def check(self):
        if shutil.disk_usage(self.directory).free < 21 * GIB:
            raise RuntimeError('Disk guard stopped download before reaching 20 GiB free')


def download(state, work, budget, connections=4):
    url = URL.format(state)
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60) as response:
        size = int(response.headers['Content-Length'])
        etag = response.headers.get('ETag')
    path = work / f'{state}.zip'
    partial = work / f'{state}.zip.part'
    marker = work / f'{state}.download.json'
    metadata = dict(url=url, bytes=size, etag=etag)
    if path.exists():
        if path.stat().st_size != size:
            raise ValueError(f'{path} has unexpected size; retain for inspection')
        return path, metadata
    if partial.exists() and (not marker.exists() or json.loads(marker.read_text()) != metadata):
        raise ValueError(f'{partial} belongs to a different source; retain for inspection')
    write_json(marker, metadata)
    remaining = size - (partial.stat().st_size if partial.exists() else 0)
    if remaining < 0:
        raise ValueError(f'{partial} exceeds the source size; retain for inspection')
    budget.reserve(remaining)
    try:
        for attempt in range(4):
            offset = partial.stat().st_size if partial.exists() else 0
            if offset == size:
                break
            try:
                # Bounded ranges avoid one slow CDN connection blocking a UF.
                # Append in order so an interrupted file is still a valid prefix.
                chunk = 16 * 1024 * 1024
                with ThreadPoolExecutor(max_workers=connections) as transfers, partial.open('ab') as output:
                    while offset < size:
                        starts = range(offset, min(offset + connections * chunk, size), chunk)
                        futures = [transfers.submit(read_range, url, start, min(start + chunk, size) - 1, size, etag)
                                   for start in starts]
                        for future in futures:
                            block = future.result()
                            budget.check()
                            output.write(block)
                            offset += len(block)
                        output.flush()
                if partial.stat().st_size != size:
                    raise OSError('Incomplete download')
                break
            except (OSError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2)
        partial.replace(path)
        print(f'{state}: downloaded {size / GIB:.2f} GiB', flush=True)
        return path, metadata
    finally:
        budget.release(remaining)


def process_state(state, work, budget, connections=4):
    result_path = work / f'{state}.json'
    if result_path.exists():
        cached = json.loads(result_path.read_text())
        if cached.get('version') != VERSION or cached.get('state') != state:
            raise ValueError(f'Invalid cache: {result_path}')
        remaining_errors = []
        for rejected in cached['errors']:
            sample_path = work / 'rejected' / state / Path(rejected['file']).name
            key = log_key(rejected['file'])
            try:
                repaired = parse_log(unpack_log(sample_path.read_bytes()), key)
                if repaired:
                    cached['sections'][f'{key[1]}/{key[2]}-{key[3]}'] = repaired
            except (ValueError, lzma.LZMAError, zipfile.BadZipFile) as error:
                remaining_errors.append(dict(file=rejected['file'], error=str(error)))
        cached['errors'] = remaining_errors
        cached['firstHours'] = dict(Counter(f'{r["shift"]}:{r["first"][11:13]}' for r in cached['sections'].values()))
        write_json(result_path, cached)
        print(f'{state}: resume from completed result ({len(remaining_errors)} rejected)', flush=True)
        return cached
    path, metadata = download(state, work, budget, connections)
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(4 * 1024 * 1024):
            digest.update(block)
    metadata['sha256'] = digest.hexdigest()
    sections = {}
    errors = []
    empty = []
    formats = Counter()
    first_hours = Counter()
    samples = []
    sampled_shifts = set()
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            key = log_key(entry.filename)
            if not key:
                if entry.filename.lower().endswith(('.logjez', '-log.jez')):
                    raise ValueError(f'Unrecognized log name: {entry.filename}')
                continue
            if key[0] != state or entry.file_size > MAX_LOG:
                raise ValueError(f'Unexpected log: {entry.filename}')
            raw = archive.read(entry)
            formats[raw[:6].hex()] += 1
            try:
                text = unpack_log(raw)
                result = parse_log(text, key)
            except (ValueError, lzma.LZMAError, zipfile.BadZipFile) as error:
                errors.append(dict(file=entry.filename, error=str(error)))
                sample_path = work / 'rejected' / state / Path(entry.filename).name
                sample_path.parent.mkdir(parents=True, exist_ok=True)
                sample_path.write_bytes(raw)
                continue
            section_key = f'{key[1]}/{key[2]}-{key[3]}'
            if result is None:
                empty.append(section_key)
                continue
            if section_key in sections:
                raise ValueError(f'Duplicate section requires review: {section_key}')
            sections[section_key] = result
            first_hours[f'{result["shift"]}:{result["first"][11:13]}'] += 1
            if len(samples) < 3 or result['shift'] not in sampled_shifts:
                sample_path = work / 'samples' / state / Path(entry.filename).name
                sample_path.parent.mkdir(parents=True, exist_ok=True)
                sample_path.write_bytes(raw)
                samples.append(dict(file=entry.filename, key=section_key, **result))
                sampled_shifts.add(result['shift'])
    if not sections:
        raise ValueError(f'No usable logs for {state}')
    result = dict(version=VERSION, state=state, source=metadata, sections=sections,
                  errors=errors, empty=empty, formats=dict(formats), firstHours=dict(first_hours), samples=samples)
    write_json(result_path, result)
    path.unlink()
    print(f'{state}: {len(sections)} sections, {len(errors)} rejected, {len(empty)} empty; ZIP deleted', flush=True)
    return result


def publish(results, data):
    totals = Counter()
    states = {}
    all_hours = {}
    changes = {}
    for result in results:
        votes = 0
        for compound, section in result['sections'].items():
            municipality, section_key = compound.split('/')
            all_hours.setdefault(municipality, {})[section_key] = section['hours']
            votes += sum(section['hours'])
            totals['lateVotes'] += section['late']
            totals['duplicateEvents'] += section['duplicates']
        states[result['state']] = dict(sections=len(result['sections']), votes=votes,
            rejected=len(result['errors']), empty=len(result['empty']), source=result['source'],
            firstHours=result['firstHours'], formats=result['formats'], samples=result['samples'])
        totals['logSections'] += len(result['sections'])
        totals['votes'] += votes
        totals['rejected'] += len(result['errors'])
        totals['empty'] += len(result['empty'])
    records = {key: value for result in results for key, value in result['sections'].items()}
    for shard_path in sorted((data / 'm').glob('*.json')):
        shard = json.loads(shard_path.read_text())
        municipality = shard['cd']
        totals['siteSections'] += sum(len(place['secoes']) for place in shard['locais'])
        if municipality not in all_hours:
            continue
        changed = changes.setdefault(municipality, {})
        for place in shard['locais']:
            for number in place['secoes']:
                key = f'{place["zona"]}-{number}'
                record = records.get(f'{municipality}/{key}')
                if not record:
                    continue
                totals['matchedSections'] += 1
                states[shard['uf']]['matched'] = states[shard['uf']].get('matched', 0) + 1
                if record['place'] is None:
                    changed[key] = None
                    totals['unknownPlace'] += 1
                elif record['place'] != place['nr']:
                    changed[key] = record['place']
                    totals['changedPlace'] += 1
    for municipality, hours in all_hours.items():
        write_json(data / 'h' / f'{municipality}.json', hours)
        write_json(data / 'h-changes' / f'{municipality}.json', changes.get(municipality, {}))
    report = dict(version=VERSION, source=SOURCE, date='2026-10-04', complete=set(states) == set(STATES),
                  totals=dict(totals), states=states,
                  matchRate=totals['matchedSections'] / totals['logSections'],
                  coverage=totals['matchedSections'] / totals['siteSections'],
                  bytes=sum(p.stat().st_size for p in (data / 'h').glob('*.json')))
    write_json(data / 'hours-audit.json', report)
    print(json.dumps({key: value for key, value in report.items() if key != 'states'}, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, default=Path.home() / 'scratch-urna-logs')
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'public/data')
    parser.add_argument('--states', nargs='+', choices=STATES, default=STATES)
    parser.add_argument('--workers', type=int, choices=range(1, 4), default=2)
    parser.add_argument('--connections', type=int, choices=range(1, 9), default=4)
    parser.add_argument('--publish-only', action='store_true')
    args = parser.parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    # One coordinator owns reservations and result files, including across invocations.
    import fcntl
    with (args.work_dir / 'hours.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        budget = DiskBudget(args.work_dir)
        budget.check()
        if args.publish_only:
            results = [json.loads((args.work_dir / f'{state}.json').read_text()) for state in args.states]
        else:
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                results = list(executor.map(lambda state: process_state(state, args.work_dir, budget, args.connections), args.states))
        publish(results, args.data_dir)


if __name__ == '__main__':
    main()
