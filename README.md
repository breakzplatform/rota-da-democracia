# Rota da Democracia

Site voluntário e apartidário para o 2º turno da eleição presidencial (domingo, 25 de outubro de 2026). No ar em <https://rotadademocracia.online>.

## O que o site faz

- **Hora mais tranquila para votar.** Você informa município, zona e seção (ou o nome do local). O site mostra o endereço, a hora com menos movimento na sua seção, calculada a partir dos registros das urnas do 1º turno, e a rota de ônibus ou de carro no Google Maps já chegando nesse horário.
- **Transporte gratuito.** Lista de municípios que anunciaram tarifa zero no dia da votação, com a fonte de cada anúncio.
- **Caronas solidárias.** Voluntários oferecem vagas até o local de votação. Quem precisa busca e pede a vaga sem criar conta.
- **Grupos de WhatsApp.** Cadastro e busca de grupos de carona por município.
- **Denúncias.** Ofertas suspeitas são denunciadas no próprio site. Crime eleitoral e propaganda irregular vão para o [Pardal](https://www.tse.jus.br/eleicoes/pardal-eleicoes-2026), o canal oficial da Justiça Eleitoral.

O site não tem relação com nenhum candidato, partido ou campanha. A interface é em português.

## Fontes de dados

- **Locais de votação:** arquivo `eleitorado_local_votacao_2026` do TSE (licença CC-BY), com os locais do 1º e do 2º turno. Gerado por `scripts/build-data.py` em `public/data/m/<código>.json`.
- **Movimento por hora:** conjunto [arquivos transmitidos para totalização](https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao) do TSE, 1º turno (4 de outubro de 2026). Os logs das urnas são lidos por `scripts/build-hours.py`. O exterior (`ZZ`) usa a hora local de cada local de votação e vai para `public/data/exterior.json`, gerado por `scripts/build-abroad.py` com a tabela `scripts/abroad-places.json` (país, fuso e coordenadas de cada local).
- **Seções que mudaram de local:** comparação entre o 1º e o 2º turno no mesmo arquivo do TSE, feita por `scripts/build-changes.py`.
- **Tarifa zero:** `public/data/tarifa-zero.json`, uma lista mantida à mão com a fonte de cada anúncio. O campo `turno2: true` só aparece quando a fonte cita o dia 25 de outubro.

## Privacidade

- Quem oferece carona informa nome ou apelido, um contato, bairro, ponto de encontro público, horário, vagas e local de votação. A nota é opcional.
- Quem busca carona não cria conta. O site não grava nome, telefone nem mensagem de quem pede a vaga.
- O contato só aparece para quem pede a vaga e passa pelo Turnstile.
- Para limitar abuso, o site guarda um código irreversível do IP (com sal) por até 24 horas, ou até a oferta sair do ar quando há denúncia.
- Os logs de invocação do Worker estão desligados, porque guardariam o IP de cada requisição.
- **Domingo, 25/10, às 17h (Brasília):** ofertas, grupos, denúncias e contatos são apagados e a API passa a responder 410. O instante fica em `ELECTION.purgeAt` (`src/config.ts`).
- **Segunda, 26/10:** o banco D1 inteiro é apagado, junto com as cópias de segurança que o provedor guarda por até 30 dias.

O texto completo está em `public/privacidade.html`.

## Arquitetura

- Cloudflare Worker (`src/`) com Workers Static Assets (`public/`) e banco D1 (`migrations/`).
- Turnstile na criação de ofertas e grupos, na revelação de contato e de link de convite, e nas denúncias.
- Denúncia não esconde nada sozinha. Ela entra na fila de moderação e gera um aviso no Telegram (mais um alerta quando chegam 10 denúncias em 10 minutos), se `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` estiverem definidos.
- Um cron de hora em hora faz a limpeza.

## Rodar localmente

```sh
npm install
npx wrangler d1 migrations apply carona --local
npx wrangler dev --var TURNSTILE_SITE_KEY:1x00000000000000000000AA
```

`npm run dev` também sobe o servidor, mas usa a chave real do Turnstile definida em `wrangler.jsonc`.

O arquivo `.dev.vars` (fora do Git) precisa de `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` e de `IP_SALT`.

Testes:

```sh
npm test            # Worker (vitest)
npm run typecheck   # TypeScript
npm run test:data   # scripts de dados (Python)
```

## Refazer os dados

Os scripts usam só a biblioteca padrão do Python 3.

```sh
npm run data -- --download                     # locais de votação (ou --csv <arquivo>)
python3 -I scripts/build-hours.py --workers 3  # movimento por hora do 1º turno
python3 -I scripts/build-changes.py --csv eleitorado_local_votacao_2026_BRASIL.csv
```

Rode `build-changes.py` depois de `build-hours.py`, porque ele substitui os arquivos `h-changes` gerados a partir dos logs. O download dos logs é grande e pode ser retomado. Metodologia, fusos, retomada e auditoria estão em [docs/hourly-turnout.md](docs/hourly-turnout.md) (em inglês).

O texto das perguntas frequentes fica em `content/faq.md`. A página é `public/faq.html`.

## Deploy

Aplique as migrações antes do deploy:

```sh
npx wrangler d1 migrations apply carona --remote
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put IP_SALT
npx wrangler deploy
```

Ao adicionar um domínio, inclua-o nos hostnames do widget do Turnstile e em `ALLOWED_HOSTNAMES` no `wrangler.jsonc`. Sem isso, todo POST falha com 403.

## Moderação

A API de administração precisa do segredo `ADMIN_TOKEN` (`npx wrangler secret put ADMIN_TOKEN`). Sem ele, ela responde 404. Guarde o token numa variável de ambiente, nunca no histórico do shell nem no repositório.

```sh
BASE=https://rotadademocracia.online
AUTH="Authorization: Bearer $ADMIN_TOKEN"
curl -H "$AUTH" "$BASE/api/admin/denuncias"             # denúncias pendentes, sem contato nem link de convite
curl -H "$AUTH" "$BASE/api/admin/denuncias?detalhe=1"   # o mesmo, com contato e link de convite
curl -X POST -H "$AUTH" "$BASE/api/admin/ofertas/<id>/ocultar"    # esconde uma oferta (e marca as denúncias dela como revisadas)
curl -X POST -H "$AUTH" "$BASE/api/admin/ofertas/<id>/restaurar"  # volta a mostrar
curl -X POST -H "$AUTH" "$BASE/api/admin/grupos/<id>/ocultar"     # o mesmo para grupos de WhatsApp
curl -X POST -H "$AUTH" "$BASE/api/admin/grupos/<id>/restaurar"
```

## Licença

Copyright (C) 2026 Joselito

Este programa é software livre, distribuído sob a GNU General Public License, versão 3 (GPL-3.0-only). O texto completo está em [LICENSE](LICENSE).

Os dados do TSE seguem a licença CC-BY da fonte original.
