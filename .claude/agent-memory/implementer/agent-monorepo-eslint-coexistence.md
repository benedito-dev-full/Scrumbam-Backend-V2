---
name: agent-monorepo-eslint-coexistence
description: Coexistência de ESLint do subprojeto agent/ com flat config raiz V2 — caminho que destravou o PostToolUse hook
metadata:
  type: feedback
---

# Subprojeto `agent/` + ESLint do root V2 — coexistência

## Rule

O subprojeto `agent/` precisa de **flat config próprio** (`agent/eslint.config.js`) + ESLint v9.x. Não use legacy `.eslintrc.js` em subprojeto monorepo quando o root usa flat config.

## Why

O hook `PostToolUse` do projeto roda:
```bash
cd "$dir_do_package_json_mais_proximo" && npx eslint "$file_path" --max-warnings 0
```

Para arquivos em `agent/src/*.ts`, o `cd` cai em `agent/` (que tem `package.json` próprio). `npx eslint` em ESLint 9 (root) e ESLint 8/9 (subprojeto) procura `eslint.config.js` subindo na árvore. Se o agent não tem flat config próprio, o eslint do agent encontra o flat config do root (`/eslint.config.js`) — esse só lista `src/**/*.ts`, ignora `agent/**` por padrão, então retorna warning `"File ignored because of a matching ignore pattern"`. Com `--max-warnings 0`, o hook bloqueia.

Solução tentada que falhou:
- ESLint 8 + `.eslintrc.js` no agent → flat config do root tem prioridade quando `npx eslint` 8.x encontra `eslint.config.js` no path.
- Adicionar `agent/**` em `ignores:` do flat config root → não ajuda porque o eslint não está IGNORANDO por escolha, está usando esse config inteiro e o file não casa com `files:`.

Solução que funcionou:
1. ESLint v9 no agent (`"eslint": "^9.0.0"` + plugins compatíveis 8.x do `@typescript-eslint`).
2. Flat config próprio em `agent/eslint.config.js` (com `files: ['src/**/*.ts', '__tests__/**/*.ts']` relativos ao cwd do agent).
3. Adicionar `agent/**` no `ignores:` do flat config root (defesa em profundidade — quando alguém roda `npx eslint` a partir do root tocando arquivo do agent, o root pula em vez de warning).

## How to apply

Para qualquer subprojeto futuro dentro de V2 (ex: novos binários, libs separadas):
- Subprojeto com seu próprio `package.json` → use flat config próprio + ESLint v9.
- Adicione o glob do subprojeto em `ignores:` do `eslint.config.js` raiz.
- Teste manualmente: `cd subprojeto && npx eslint src/algum.ts` deve passar sem warnings antes de comitar.

## Related

- [[backend-pdfkit-namespace-broken]] (pendência pré-existente do backend)
