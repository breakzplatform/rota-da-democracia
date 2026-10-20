# First-round hourly turnout

The chart counts completed voter sessions, not votes for individual offices or
queue length. Its input is the TSE's [2026 transmitted files dataset](https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao),
first round, 4 October 2026. Abroad (`ZZ`) is excluded from the domestic shards;
see the separate abroad pipeline below.

## Reproduce

```sh
npm run test:data
python3 -I scripts/build-hours.py --workers 3
npm test
npm run typecheck
```

Work files default to `~/scratch-urna-logs`, outside Git. Downloads use at most
three UFs concurrently and four 16 MiB HTTP ranges per UF by default
(`--connections 8` allows eight ranges per UF). Ranges are appended
in order, with Content-Range and ETag checks. `.zip.part` files resume from their
existing prefix. A process lock prevents independent coordinators from consuming
the same disk reservation. The disk guard reserves the full remaining download
and checks available space before writing, stopping at 21 GiB to retain more
than 20 GiB. A completed ZIP is removed only after its small per-UF JSON result
has been atomically saved. No ZIP contents are extracted to disk wholesale.

Run `--states AC AP` to process a subset. Existing complete per-UF result files
are reused without downloading. Rejected logs are kept separately and retried
on resume; inspect the reported errors before accepting a national run. The
`--publish-only` option rebuilds site shards from completed per-UF files.
`public/data/hours-audit.json` records completeness, coverage, source URLs,
ETags, archive SHA-256 hashes, local-clock evidence, and sample counts.
Do not describe a subset run as national coverage: `complete` must be true.

To refresh a source, move its per-UF result JSON out of the work directory before
rerunning. To change parsing rules, invalidate affected cached results rather
than mixing versions. Retained raw samples are for local auditing; they are not
published. Tests use a tiny synthetic Latin-1 fixture with the observed format
and exact event text, without network access.

## Observed format and counting

The actual filenames follow `o03220ac0101500020088-log.jez`: the state is `AC`,
TSE municipality is `01015`, zone is `2`, and section is `88`. Leading zeros in
the municipality are preserved to match `public/data/m/01015.json`. The parser
cross-checks municipality, zone, and section in the log at each counted event.

The inspected `.jez` files are ZIP containers, not 7z archives. Python's `lzma`
rejected the sample; its `PK` signature and `zipfile` confirmed the ZIP format.
The payload is Latin-1 `logd.dat`, with tab-separated timestamp, level, urn ID,
application, message, and event checksum. The counted event is an exact match
of message `O voto do eleitor foi computado`, application `VOTA`, election date
`04/10/2026`. Preparation-day records and similar messages do not count.
Standalone LZMA streams are also supported; unverified 7z containers are rejected
explicitly rather than silently guessed.

Contingency containers can include nested `.jez` archives from the original
machine as well as the replacement's `logd.dat`. Both are read. Repeated complete
event records are counted once; different events sharing a timestamp remain
separate. Missing logs do not become nine invented zeroes. Invalid identity or
votes before the converted opening time cause the section to be quarantined,
not silently clamped into the first bucket.

## Clock conversion

The timestamps are the machines' local clocks. Conversion follows the
[TSE's national opening-time explanation](https://www.tse.jus.br/comunicacao/noticias/2026/Setembro/faltam-26-dias-votacao-comeca-e-termina-no-mesmo-horario-em-todo-o-pais)
and the [TRE-AM's specific 2026 list](https://www.tre-am.jus.br/comunicacao/noticias/2026/Setembro/eleitorado-do-amazonas-deve-ficar-atento-aos-horarios-de-votacao-nas-eleicoes-2026).

| Location | Add to logged hour for Brasília |
| --- | ---: |
| Acre | +2 |
| Amaturá, Atalaia do Norte, Benjamin Constant, Eirunepé, Envira, Guajará, Ipixuna, Itamarati, Jutaí, São Paulo de Olivença, Tabatinga (AM) | +2 |
| Remaining Amazonas municipalities; MT, MS, RO, RR | +1 |
| Fernando de Noronha, TSE code `30015` (PE) | −1 |
| All other domestic municipalities | 0 |

Use the TRE-AM's **11 voting-clock municipalities**, not a generic list of 13
geographical time-zone municipalities. The audit's `firstHours` keys are
`shift:local-hour`; counts show the number of sections whose first completed
vote was in that hour. Delayed starts are preserved and never used to infer a
different time zone. Raw sample first/last timestamps and local-hour histograms
provide additional evidence.

Output arrays have nine integer buckets for Brasília hours 08 through 16.
All votes at or after 17:00 Brasília join the 16h bucket. The UI explains this
and does not claim to measure waiting time or predict runoff queues.

## Place changes and coverage

`public/data/h/<municipality>.json` maps `zone-section` to the nine counts.
`public/data/h-changes/<municipality>.json` lists sections whose first-round
`Local de Votação` number differs from the current shard's `nr`; its value is
the old place number. `null` means the place comparison is unknown. Both cases
show a warning, with distinct text. An empty changes object means no detected
change for the matched sections.

This detects changes of **place number**. A changed physical address under the
same TSE place number cannot be established from these log headers. Current
shards are the supplied second-round snapshot dated 19 October 2026; refresh the
comparison with `--publish-only` after updating place data.

The match rate is matched log sections / extracted log sections. Coverage is
matched log sections / all sections in the site's place shards. These are
different denominators: aggregated sections and sections without a usable log
may have no independent first-round machine record. Such sections show no chart;
we do not copy another section's counts or manufacture observations.

## Verification record

See `public/data/hours-audit.json` for the generated national figures and per-UF
clock evidence. Final raw-log spot checks and the turnout comparison are recorded
with the completed extraction below.

Three raw ZIP logs were counted separately from `build-hours.py`, by filtering
exact `VOTA` messages, grouping the timestamp hour, and applying the documented
local-clock offset. Each independently counted array equaled the extractor's
result (columns below are 08h through 16h Brasília):

| Municipality / zone-section | Local first–last vote | Counts | Total |
| --- | --- | --- | ---: |
| `01015/2-88` (Capixaba, AC; +2h) | 06:03:22–14:40:05 | `[26,23,21,17,18,12,8,9,7]` | 141 |
| `02496/41-9` (Jutaí, AM; +2h) | 06:02:52–15:50:21 | `[24,19,25,20,29,27,27,26,59]` | 256 |
| `02372/30-9` (Santa Isabel do Rio Negro, AM; +1h) | 07:18:39–17:07:08 | `[16,21,22,26,22,25,22,25,57]` | 236 |

Source member names are `o03220ac0101500020088-log.jez`,
`o03220am0249600410009-log.jez`, and `o03220am0237200300009-log.jez` respectively.
The latter two include after-closing votes, exercising the final-bucket rule.

Chrome runtime checks at 320, 360, 768, and 1280 px verify nine accessible bars
and no horizontal overflow. Additional checks cover missing data, stale requests
after selection changes, equal counts, unknown place comparisons, and the actual
changed-place case `01015/2-88`. The existing site explicitly uses a light theme.


## Abroad

Abroad logs use each polling place's local clock, with shift zero and the same
nine buckets (08h through 16h, with later votes in the last bucket). Run `ZZ`
separately: mixing it with domestic states is rejected. It produces the work
result `ZZ.json`, including a `paper` list of section keys from `-logsa.jez`
filenames; these paper-ballot containers are not parsed. The usual work lock,
source metadata, samples and rejected logs stay in the work directory. Neither
normal extraction nor `--publish-only --states ZZ` calls the domestic publisher;
`public/data/h*` and `hours-audit.json` are untouched. `STATES` and national
`complete` still refer to the 27 domestic UFs.

Use a copy of the source ZIP: successful extraction deletes its working copy.
The extractor still makes a HEAD request to verify the source size and retains
its usual disk-space guard. From the repository root:

```sh
abroad_work=$(mktemp -d /private/tmp/rota-zz-hours.XXXXXX)
cp "$HOME/.local/state/rota-zz/dl-zz/ZZ.zip" "$abroad_work/ZZ.zip"
python3 -I scripts/build-hours.py --states ZZ --work-dir "$abroad_work"
python3 -I scripts/build-abroad.py \
  --csv "$HOME/.local/state/rota-zz/dl-locais/locais.zip" \
  --hours "$abroad_work/ZZ.json" \
  --places scripts/abroad-places.json \
  --out public/data/exterior.json
```

`npm run data:abroad -- ...` accepts the same arguments. `--csv` also accepts
the extracted Latin-1 ZZ CSV. ZIP input selects the `_ZZ.csv` member explicitly.
Keep the work directory to resume extraction or inspect its audit records.

Only active ZZ sections from round two participate. Blocked polling places
remain eligible, matching `build-data.py`. Aggregated sections follow principal
chains, with the same existing-place fallback; they contribute voters, but only
main sections appear in `secoes` and contribute hourly logs. Unresolved
aggregations are omitted, as in the domestic builder. Main sections without a
usable log or paper marker appear in `semDado`; empty or rejected logs count as
missing. Paper and missing lists are subsets of `secoes`. A place with no logged
main sections gets `horas: null`, not fabricated zeroes.

The place table must exactly match eligible place keys. Every time zone must
load through `zoneinfo.ZoneInfo`, and its country must include the table's `pais`
according to the union of `/usr/share/zoneinfo/zone1970.tab` and `zone.tab`.
If neither file exists, country validation is skipped with a warning; time zone
validation still runs. Countries come from individual places, not jurisdiction
names. Output is minified UTF-8, sorted by folded country, city and place names,
with stable identifier tie-breaks. `geradoEm` is the CSV generation date in ISO
format. The audit counts current main sections with data, paper ballots and no
log; it does not assume every first-round section still exists in round two.

Unit tests use synthetic rows and tiny in-memory ZIPs, with temporary outputs
outside the repository: `npm run test:data`.
