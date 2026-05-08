# ADR-V2-025 — BigInt Serialization Strategy

**Status:** Proposto (Documenter — F2)
**Data:** 2026-05-08
**Fase:** F2 (decision pending final review)
**Decisores:** Implementer (escolha F2) + Reviewer (validação) + Documenter (formalização)
**Tags:** #V2 #fase-F2 #core #typescript #performance

---

## Contexto e Problema

JavaScript nativo `JSON.stringify()` não serializa `BigInt`. PostgreSQL usa `BIGSERIAL` para PKs, representado como `bigint` em TypeScript (range: -2^63 até 2^63-1, enquanto `number` cobre apenas até 2^53-1). A conversão de `BigInt` para `string` é necessária antes de qualquer response JSON.

**Cenário:**
```typescript
// Prisma retorna chave como bigint
const entidade = await prisma.dEntidade.findFirst({ where: { chave: BigInt(123) } });
// entidade.chave = BigInt(123n)

// Tentativa de JSON.stringify
JSON.stringify(entidade);
// TypeError: Do not know how to serialize a BigInt
```

**Impacto:** Toda response HTTP com campo `BigInt` falha em 500 (internal server error) se não for serializada antes.

**Questão arquitetural:** Centralizar a serialização (interceptor global) ou deixar modular (por-module helpers)?

---

## Alternativas Consideradas

### Opção 1: Formatação por módulo (helpers) — ESCOLHIDA para F2

**Implementação F2:**
- Cada controller/service implementa seu próprio `format-response.ts` ou inline
- Exemplo: `src/entidades/helpers/format-entidade-response.ts` converte BigInt → string
- Exemplo: `src/tabelas/` faz formatação inline no service

**Prós:**
- Granular: cada módulo controla quais campos serializa
- Testável isoladamente (helpers são funções puras)
- Zero overhead em módulos que não lidam com BigInt
- Sem dependência global de interceptor

**Contras:**
- Duplicação de lógica (cada módulo reimplementa)
- Risco: módulo futuro esquece de serializar → 500 em prod
- Menos "enterprise" que interceptor global

**Decisão F2:** IMPLEMENTADO. Justificativa: F2 tem apenas 3 módulos (entidades, tabelas, classes), duplicação é aceitável. Seguro e testado.

### Opção 2: Interceptor global em `main.ts` — CANDIDATO para F3

**Implementação F3:**
```typescript
// src/common/interceptors/bigint-serializer.interceptor.ts
@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => this.serializeBigInts(data))
    );
  }

  private serializeBigInts(obj: any): any {
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(item => this.serializeBigInts(item));
    if (obj !== null && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, this.serializeBigInts(v)])
      );
    }
    return obj;
  }
}

// main.ts
const app = await NestFactory.create(AppModule);
app.useGlobalInterceptors(new BigIntSerializerInterceptor());
```

**Prós:**
- DRY: implementado uma vez, funciona para TODOS os módulos
- Garante: nenhum BigInt escapa (não-esquecível)
- Enterprise pattern: consistente com NestJS best practices
- Descentraliza: módulos não precisam se importar com serialização

**Contras:**
- Overhead: interceptor processa TODA response (incluindo strings, booleans, etc.)
- Menos granular: tudo é serializado (se houver campo que DEVERIA ser BigInt no JSON, não é possível)
- Dependência global mais pesada
- Recursão em objetos grandes pode ter impacto

**Decisão F3:** CANDIDATO. Só implementar se performance for aceitável. Revisar com carga real.

### Opção 3: Custom JSON.stringify com `replacer` — DESCARTADA

```typescript
JSON.stringify(obj, (key, value) => {
  if (typeof value === 'bigint') return value.toString();
  return value;
});
```

**Descartada porque:** Requer passar `replacer` em TODA chamada de JSON.stringify. Inviável em produção (esquecível em cada endpoint).

---

## Decisão

**F2 (AGORA — 2026-05-08):**
- Manter **formatação por módulo** (helpers) conforme implementado
- Cada módulo converte seus BigInts antes de retornar
- Exemplos em F2: `format-entidade-response.ts`, `formatTabelaResponse` inline

**F3 (PRÓXIMA FASE):**
- Avaliar **interceptor global** `BigIntSerializerInterceptor` em `main.ts`
- Critérios de aceitação:
  1. Implementar e testar overhead (benchmark com 1000 responses)
  2. Recursão em objetos grandes (DEvento.metaDados, DVincula.metaDados) não degrada performance
  3. Nenhuma diferença em latência p99 vs formatação por módulo
- Se overhead < 2% → implementar interceptor em F3
- Se overhead > 5% → manter helpers por módulo (atual)

**Rationale:**
- F2 está OK com helpers (pequeno número de módulos)
- F3 adiciona mais controllers (Auth, projetos, tarefas) → dívida técnica cresce
- Antes de F5+ explodir em módulos, decidir estratégia central vs descentralizada

---

## Consequências

### Positivas (F2)
- Cada módulo é dono de sua serialização — responsabilidade clara
- Testes de response format isolados por módulo
- Zero risco de interceptor quebrado impactando TODOS os endpoints

### Negativas (F2)
- `formatTabelaResponse` está inline no `tabelas.service.ts` (inconsistência com `entidades/helpers/`)
- Duplicação: `validarClasse` e `formatResponse` repetem em múltiplos modules
- Pode ficar pesado em F5+ com 20+ controllers

### Pendentes (F3)
- Decisão final sobre interceptor global após implementação + benchmark
- Se interceptor for escolhido em F3, remover helpers por módulo (refactor)

---

## Implementação (Referência F2)

**Que foi implementado agora:**

1. `src/entidades/helpers/format-entidade-response.ts` — função pura
   ```typescript
   export function formatEntidadeResponse(entidade: any): EntidadeResponseDto {
     return {
       chave: entidade.chave.toString(),
       idClasse: entidade.idClasse.toString(),
       nome: entidade.nome,
       classe: { codigo: entidade.classe?.codigo, nome: entidade.classe?.nome },
       // ... demais campos
     };
   }
   ```

2. `src/entidades/entidades.controller.ts` — chamada antes de return
   ```typescript
   @Get()
   async listar(@Query() query: ListEntidadeQueryDto) {
     const result = await this.entidadeService.listarPorClasse(query);
     return {
       items: result.items.map(formatEntidadeResponse),
       pagination: result.pagination
     };
   }
   ```

3. `src/tabelas/tabelas.service.ts` — inline (inconsistência menor registrada)
   ```typescript
   private formatTabela(t: any): TabelaResponseDto {
     return {
       chave: t.chave.toString(),
       idClasse: t.idClasse.toString(),
       // ...
     };
   }
   ```

**O que será feito em F3 (se interceptor aprovado):**
- Remover `format-entidade-response.ts`
- Remover `formatTabela` inline
- Adicionar `BigIntSerializerInterceptor` em `main.ts`
- Controllers retornam objeto bruto (serialização automática)

---

## Referências

- `devari-backend-patterns.md` §2 (BigInt OBRIGATÓRIO)
- `src/entidades/helpers/format-entidade-response.ts` (F2 implementation)
- `src/entidades/entidades.controller.ts` (exemplo de uso)
- F3 plan (quando escrito) — incluirá benchmark vs helpers

---

**Status:** Proposto (será finalizado em F3 com implementação de interceptor)
**Próximo:** Reviewer + Documenter validam em F2 final; Strategist decide em F3
