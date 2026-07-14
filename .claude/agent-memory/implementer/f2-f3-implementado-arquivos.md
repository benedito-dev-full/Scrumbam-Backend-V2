---
name: f2-f3-implementado-arquivos
description: Snapshots de estrutura de arquivos F2 (endpoints genéricos + convenção ADR-V2-015) e F3 (Auth + RBAC duplo). Derivável do repo; consultar para orientação rápida.
metadata:
  type: project
---

# F2 / F3 — Estrutura de Arquivos Implementada

Snapshot histórico movido de `MEMORY.md`. Gotchas F3 canônicos vivem em
[codepaths-gotchas-f3-f10.md](codepaths-gotchas-f3-f10.md).

## Convenção ADR-V2-015 (F2)
- **Canônico:** `?idClasse=-150` → BigInt direto, sem log
- **Deprecated:** `?classe=USER` → LRU cache (TTL 5min) + Logger.warn + headers `Deprecation: true`, `Sunset: 2026-06-05`
- **Ambos / Nenhum:** → 400 BadRequest
- **Sunset:** 2026-06-05 (2 sprints a partir de F2)

## F2 — arquivos
```
src/common/pipes/parse-bigint.pipe.ts           # string → bigint, valida ^-?\d+$
src/common/pipes/parse-optional-bigint.pipe.ts  # versão opcional
src/common/decorators/skip-guard.decorator.ts   # TOMBSTONE F3 — não usar; usar @Public()
src/common/helpers/lru-cache.ts                 # LRU genérico max:200 ttl:5min
src/common/dto/pagination-meta.dto.ts           # movida de src/entidades/dto/ em F3
src/common/helpers/validar-classe.helper.ts     # extraída de entidades+tabelas em F3
src/entidades/entidades.service.ts              # 8 métodos (inclui getEntidadeIdFromUserGroup)
src/entidades/entidades.controller.ts           # F3: AuthCompositeGuard + OrgTenantGuard
src/tabelas/tabelas.service.ts                  # F3: validarClasse helper + formatTabelaResponse
src/tabelas/helpers/format-tabela-response.ts   # extraída de tabelas.service.ts em F3
src/classes/classes.controller.ts               # F3: AuthCompositeGuard, POST retorna 403
```
- **DEvento.idUsuario aponta para DEntidade.chave (não DUserGroup.chave)** — usar `EntidadeService.getEntidadeIdFromUserGroup(userGroupId)`.

## F3 — Auth + RBAC duplo — arquivos
```
src/auth/auth.service.ts             # register (tx), login, refresh, logout, getMe, updateMe, deleteMe
src/auth/auth.controller.ts          # 13 endpoints /auth/*, /auth/me/api-key, /auth/me/mcp-key
src/auth/strategies/jwt.strategy.ts  # PassportStrategy JWT
src/auth/guards/jwt-auth.guard.ts    # NÃO lança; @Public() bypass
src/auth/guards/api-key.guard.ts     # X-API-Key; popula req['project']; NÃO lança
src/auth/guards/mcp-key.guard.ts     # X-MCP-Key; NÃO lança
src/auth/guards/auth-composite.guard.ts # OR: MCP→APIKey→JWT; ÚNICO que lança 401
src/auth/guards/org-tenant.guard.ts  # DProject.idEstab + LRU cache
src/auth/guards/roles.guard.ts       # DVincula role + LRU cache
src/auth/decorators/public.decorator.ts  # @Public() substitui @SkipGuard()
src/auth/services/role-resolver.service.ts # LRU 1000 entries TTL 5min; N+1 ZERO
src/auth/services/api-key.service.ts # DTabela(-471): generate/validate (SHA-256)/revoke
src/auth/services/mcp-key.service.ts # DTabela(-472) + DUserGroup.dados.mcpKeyHash
src/auth/services/refresh-token.service.ts # rotação estrita; reuse detection
src/permissoes/*                     # CRUD DPermissao, @Roles('ADMIN')
```

## Gotchas F3 críticos
- **forwardRef obrigatório** AuthModule↔EntidadesModule/TabelasModule/ClassesModule (circular dep).
- **Guards internos NÃO lançam** — retornam false; AuthCompositeGuard é o único que lança.
- **Refresh token scan em POST /auth/refresh** — DUserGroup.dados.refreshTokenHash; F14 indexa.
- **BCRYPT_ROUNDS = 12** em auth.service.ts. **bcryptjs** (não bcrypt); `import * as bcrypt from 'bcryptjs'`.
- **JwtPayload sub/entidadeId/organizationId são strings** (evita BigInt serialization).
- **AuthCompositeGuard** verifica req.user após JwtAuthGuard.canActivate (JWT pode retornar true sem user).
