---
paths:
  - "prisma/migrations/**/*.sql"
  - "prisma/schema.prisma"
---

# Protocol de Migrations - Devari Core

**Quando migrations sao necessarias:**
- Mudancas de schema (colunas, tabelas, indices)
- Alteracoes que afetam dados existentes
- Qualquer DDL (CREATE, ALTER, DROP)

**RISCO: Migrations afetam o template base e propagam para TODOS projetos derivados!**

---

## Protocolo Obrigatorio (3 Agents)

### Strategist DEVE planejar:
- [ ] Migration up (SQL forward)
- [ ] Migration down (SQL rollback)
- [ ] Data migration (se necessario)
- [ ] Backup strategy ANTES de executar

### Implementer DEVE:
- [ ] Criar migration via `npx prisma migrate dev`
- [ ] Testar up em dev/test
- [ ] Testar down (rollback funciona?)
- [ ] **NAO executar em prod** (apenas gerar .sql)

### Reviewer DEVE verificar:
- [ ] Migration e idempotente (rodar 2x nao quebra)
- [ ] Rollback funciona (down restaura estado)
- [ ] Sem risco de perda de dados
- [ ] Backup documentado no plan

---

**Migrations requerem Strategist Path OBRIGATORIO.**
