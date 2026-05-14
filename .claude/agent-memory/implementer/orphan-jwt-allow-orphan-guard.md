---
name: orphan-jwt-allow-orphan-guard
description: Gotchas e decisões da Etapa 2 do plano orphan-workspace — @AllowOrphan + RequireWorkspaceGuard + JwtStrategy relaxada. ADR-V2-040.
metadata:
  type: project
---

# Etapa 2 orphan-workspace — infra de JWT órfão

**Why:** primeira mudança não-trivial em guards desde F3. Padrão se repetirá em qualquer projeto multi-tenant do template Devari-Core (rede social, fintech, etc.) — vale documentar o "como" para não recolher pegadinhas no próximo SaaS.

**How to apply:** ao precisar permitir que JWT autenticado mas "sem tenant" acesse rotas específicas (ex.: `/auth/me`, criar tenant, listar convites), reusar este padrão exato.

## Decisões de design

1. **`RequireWorkspaceGuard` NÃO é APP_GUARD global.** Em NestJS, APP_GUARD roda ANTES dos guards de controller (`@UseGuards`). Como `AuthCompositeGuard` está em `@UseGuards` controller-by-controller (não como APP_GUARD), registrar `RequireWorkspaceGuard` como APP_GUARD global faria com que ele rodasse antes do `AuthCompositeGuard` popular `req.user` → guard liberaria tudo silenciosamente. Solução: **injetar `RequireWorkspaceGuard` no constructor do `AuthCompositeGuard`** e invocá-lo no final do `canActivate`, FORA de qualquer try/catch (caso contrário a `ForbiddenException NO_WORKSPACE` seria engolida).

2. **`OrgTenantGuard` foi RELAXADO** (linha 69-76): antes lançava `ForbiddenException('organizationId ausente no token')`. Agora retorna `true` quando `!user?.organizationId` — quem decide é o `RequireWorkspaceGuard`. Isso é seguro porque o `OrgTenantGuard` só roda em rotas que já passaram pelo `AuthCompositeGuard` (que invocou o `RequireWorkspaceGuard`). Se chegou aqui sem org, é porque a rota tem `@AllowOrphan()` — e o `OrgTenantGuard` não tem o que validar.

3. **`RolesGuard` precisou de null-check** antes de `BigInt(user.organizationId)`. Cenário: rota com `@AllowOrphan() + @Roles('ADMIN')` — combinação contraditória mas o código não pode crashar com `BigInt(undefined)`. Resposta: 403 `{ code: 'NO_WORKSPACE' }` (consistente com o RequireWorkspaceGuard).

## Gotchas que pegariam um agente nova vez

- **ESLint hook bloqueia import sem uso.** Ao adicionar import de classe nova num arquivo, AGRUPAR a declaração + primeiro uso na MESMA Edit. Tentar `Edit` só do import → hook reverte com `@typescript-eslint/no-unused-vars`.
- **`switch-org` usa `JwtAuthGuard` direto, não `AuthCompositeGuard`.** Marcamos `@AllowOrphan()` ali por consistência semântica, mas o decorator NÃO tem efeito prático nessa rota — quem libera órfão lá é o `JwtStrategy.validate` (que agora aceita payload sem org). Se um dia migrar `switch-org` para `AuthCompositeGuard`, o `@AllowOrphan()` passa a ser load-bearing.
- **`tsconfig.build.json` exclui `**/*spec.ts`** — então `make build` passa mesmo com erros TS em specs pre-existentes de OUTROS módulos (automation/agents, executions). Diferente de `npx tsc --noEmit` que checa tudo. Ao validar DoD, rodar `make build` (válido) e `npm test -- auth` (passa, 46/46), não confiar só em `tsc --noEmit` global.
- **`ForbiddenException.getResponse()`** retorna o objeto literal passado ao construtor (`{ code: 'NO_WORKSPACE', message: '...' }`), não uma string. Testes precisam fazer `(err as ForbiddenException).getResponse() as { code: string }`.
- **`AuthCompositeGuard.spec.ts` precisou de mock novo** do `RequireWorkspaceGuard` (default `canActivate: () => true`) porque o construtor agora exige o provider. Esquecer disso = `Cannot read property 'canActivate' of undefined` em runtime e testes verdes silenciosos no spec do composite.

## Tests adicionados

- `src/auth/guards/require-workspace.guard.spec.ts` — 7 cenários (sem user, apikey, mcpkey, JWT com org, JWT órfão + AllowOrphan, JWT órfão + sem AllowOrphan, authMethod ausente como fallback JWT).
- `src/auth/guards/roles.guard.spec.ts` — +1 cenário para órfão + @Roles ⇒ 403 NO_WORKSPACE.
- `src/auth/guards/auth-composite.guard.spec.ts` — mock atualizado para incluir `RequireWorkspaceGuard`.

## Próximos passos (Etapas 3+)

Etapa 3 destrava o `login` órfão (remove o 401 temporário de Etapa 1). Quando isso for feito, o teste manual com curl deixará de exigir JWT forjado — pode usar credenciais reais de user sem workspace. ADR-V2-040 ainda PENDENTE de redação formal (vai com Etapa 5 via Documenter).
