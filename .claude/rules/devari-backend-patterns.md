---
# Skill de contexto geral - carrega sempre
---

# Padroes Backend Devari Core (Template Framework)

**Versao:** 1.0
**Data:** 2026-02-26
**Aplicavel a:** Todo codigo TypeScript em src/

---

## CONTEXTO CRITICO

O Devari Core e um **template framework para gerar backends SaaS B2B2B/C**.
Cada projeto gerado herda estes padroes. Se o template for fragil, TODOS
os projetos gerados serao frageis.

**Implicacao:** Qualidade enterprise obrigatoria. Padroes aqui propagam
para dezenas de SaaS em producao.

**Todos os padroes abaixo sao OBRIGATORIOS.**

---

## 1. ACESSO AO BANCO DE DADOS

### SEMPRE usar PrismaService (NUNCA DatabaseService)

**Contexto:** O `DatabaseService` esta sendo **descontinuado**. Todos os novos codigos devem usar `PrismaService` diretamente.

```typescript
// CORRETO
import { PrismaService } from '../prisma.service';
// ou
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class MeuService {
  constructor(private readonly prisma: PrismaService) {}

  async buscarEntidade(id: string) {
    return await this.prisma.dEntidade.findFirst({
      where: {
        chave: BigInt(id),
        excluido: false
      }
    });
  }
}
```

```typescript
// ERRADO - NUNCA FACA ISSO
import { DatabaseService } from '../database/database.service';

constructor(private readonly database: DatabaseService) {}  // DEPRECATED!
```

**Localizacao do arquivo:** `src/prisma.service.ts`

---

## 2. IDs E BIGINT

### BigInt OBRIGATORIO para todos os IDs

**Contexto:** O banco de dados usa `BIGSERIAL` para PKs. TypeScript representa isso como `bigint`, NAO `number`.

```typescript
// CORRETO - Converter string para BigInt
const entidadeId = BigInt(dto.entidadeId);
const projetoId = BigInt(req.params.id);

// Query usando BigInt
const entidade = await this.prisma.dEntidade.findFirst({
  where: { chave: entidadeId }  // entidadeId e bigint
});
```

```typescript
// ERRADO - parseInt/Number perde precisao
const entidadeId = parseInt(dto.entidadeId);      // Maximo: 2^53-1 (unsafe!)
const entidadeId = Number(dto.entidadeId);        // Mesma limitacao

// ERRADO - String em where clause
where: { chave: dto.entidadeId }  // Type error! Espera bigint
```

**Por que BigInt?**
- PostgreSQL BIGINT: -9.223.372.036.854.775.808 a 9.223.372.036.854.775.807
- JavaScript Number: -9.007.199.254.740.991 a 9.007.199.254.740.991 (perde precisao!)
- BigInt: suporta range completo sem perda

---

## 3. TRANSACTIONS PARA OPERACOES MULTI-TABELA

### SEMPRE usar `prisma.$transaction` quando modificar multiplas tabelas

**Contexto:** Operacoes que afetam multiplas tabelas devem ser **atomicas**. Se uma parte falha, TUDO deve fazer rollback.

```typescript
// CORRETO - Transaction garante atomicidade
async criarEntidadeComConta(dto: CreateEntidadeDto) {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Criar entidade
    const entidade = await tx.dEntidade.create({
      data: {
        nome: dto.nome,
        idClasse: BigInt(dto.idClasse),
        // ...
      }
    });

    // 2. Criar conta virtual associada
    const conta = await tx.dEntidade.create({
      data: {
        idClasse: BigInt(-40),  // Conta virtual
        idLocEscritu: entidade.chave,
        // ...
      }
    });

    // Se QUALQUER operacao falhar, TODAS fazem rollback
    return entidade;
  });
}
```

```typescript
// ERRADO - Sem transaction (inconsistencia!)
async criarEntidadeComConta(dto: CreateEntidadeDto) {
  const entidade = await this.prisma.dEntidade.create({ data });

  // Se falhar aqui, entidade ja foi criada mas sem conta!
  const conta = await this.prisma.dEntidade.create({ data });
}
```

**Quando usar transaction:**
- Criar entidade + conta virtual associada
- Criar pedido + registros filhos
- Qualquer operacao que afete multiplas tabelas relacionadas
- Operacoes que precisam de atomicidade (rollback total se falhar)

---

## 4. DATAS E TIMEZONE

### SEMPRE usar TimezoneService para filtros de data

**Contexto:** Sistema opera no timezone **America/Sao_Paulo** (UTC-3). Criar datas manualmente com UTC pode gerar filtros incorretos.

```typescript
// CORRETO - Usar TimezoneService
import { TimezoneService } from 'src/common/services/timezone.service';

constructor(
  private readonly timezoneService: TimezoneService
) {}

async listarEntidades(dateFrom: string, dateTo: string) {
  // Aplica filtros no timezone correto
  const filtro = this.timezoneService.applyDateFilters(dateFrom, dateTo);

  return await this.prisma.dEntidade.findMany({
    where: {
      chcriacao: filtro  // { gte: Date, lte: Date } no timezone Brasil
    }
  });
}
```

```typescript
// CORRETO - Metodos especificos
const startOfDay = this.timezoneService.toStartOfDayBrazil(new Date());
const endOfDay = this.timezoneService.toEndOfDayBrazil(new Date());

// Periodos pre-definidos
const today = this.timezoneService.getPeriodDates('today');
const thisWeek = this.timezoneService.getPeriodDates('week');
const thisMonth = this.timezoneService.getPeriodDates('month');
```

```typescript
// ERRADO - Criar Date manualmente com UTC
where: {
  chcriacao: {
    gte: new Date(dateFrom + 'T00:00:00.000Z'),  // UTC! Nao e Brasilia!
    lte: new Date(dateTo + 'T23:59:59.999Z')
  }
}

// ERRADO - setHours usa timezone local da maquina
const date = new Date(dateFrom);
date.setHours(0, 0, 0, 0);  // Depende do timezone do servidor!
```

**Localizacao do arquivo:** `src/common/services/timezone.service.ts`

**Por que e critico:**
- Filtros de data incorretos = relatorios errados
- Queries podem retornar dados do dia errado

---

## 5. SERVICOS CENTRALIZADOS (NUNCA DUPLIQUE)

### EntidadeService.getEntidadeIdFromUserGroup

**Contexto:** Sistema tem 2 tabelas de usuarios:
- `DUserGroup`: Credenciais de login (user/password)
- `DEntidade`: Dados cadastrais completos (nome, endereco, etc.)

Muitas FKs esperam `DEntidade.chave`, NAO `DUserGroup.chave`.

```typescript
// CORRETO - Usar metodo centralizado
import { EntidadeService } from '../entidades/entidades.service';

constructor(
  private readonly entidadeService: EntidadeService
) {}

// Converter DUserGroup.chave -> DEntidade.chave
const entidadeId = await this.entidadeService.getEntidadeIdFromUserGroup(userId);

// Usar em FK
await this.prisma.dEvento.create({
  data: {
    idUsuario: entidadeId,  // FK para DEntidade
    // ...
  }
});
```

```typescript
// ERRADO - Usar DUserGroup.chave diretamente em FK de DEntidade
await this.prisma.dEvento.create({
  data: {
    criadoPor: userGroupId  // ERRO! criadoPor e FK para DEntidade, nao DUserGroup!
  }
});
```

**Localizacao:** `src/entidades/entidades.service.ts` (metodo publico)

---

## 6. N+1 QUERIES - ZERO TOLERANCIA

**Contexto:** Projetos gerados vao processar milhares de requisicoes. N+1 queries causam degradacao severa de performance.

**Reviewer REJEITA codigo com N+1 queries.**

### CORRETO - Usar include/select (JOIN)

```typescript
// 1 query total (JOIN no banco)
const entidades = await this.prisma.dEntidade.findMany({
  where: { idClasse: BigInt(-45) },
  include: {
    DEntidade_DEntidade_idLocEscrituToDEntidade: {
      select: {
        chave: true,
        nome: true
      }
    }
  }
});

// Acesso direto
entidades.forEach(e => {
  console.log(e.DEntidade_DEntidade_idLocEscrituToDEntidade);
});
```

### ERRADO - Loop com query (N+1 problem)

```typescript
// 1 query inicial
const entidades = await this.prisma.dEntidade.findMany({
  where: { idClasse: BigInt(-45) }
});

// +N queries (1 para cada entidade)
for (const entidade of entidades) {
  const vinculo = await this.prisma.dVincula.findFirst({  // N+1 !!!
    where: { idLocEscritu: entidade.chave }
  });
  entidade.vinculo = vinculo;
}

// Total: 1 + N queries (se N=1000 -> 1001 queries! INACEITAVEL!)
```

**Como detectar N+1:**
```bash
# Executar com logging
DATABASE_LOGGING=true make dev

# Fazer request
curl http://localhost:3000/api/v1/entidades

# Contar queries nos logs
# Target: 3-5 queries por request
# Red flag: 20+ queries
```

**Reviewer valida isso na Phase de testes!**

---

## 7. EVENTOS - ORDEM CRITICA

**Contexto:** Eventos devem ser emitidos APENAS apos persistencia bem-sucedida.

### CORRETO - Persistir primeiro, emitir depois

```typescript
async criarPedido(dto: CreatePedidoDto) {
  // 1. Persistir no banco (via Engine/Operacao)
  const op = new OperacaoPedido({
    usuario: userId.toString(),
    classe: dto.idClasse.toString(),
    bd: this.prisma
  });
  await op.nova();
  op.pedidoCab.setValor(dto.valor);
  await op.calcula();
  await op.aprova({ aprovador: userId });
  await op.grava();

  // 2. SOMENTE APOS sucesso, emitir evento
  await this.eventProducer.emit('order.created', {
    pedidoId: op.pedidoCab.getData().chave.toString(),
    valor: dto.valor
  });

  return op.pedidoCab.getData();
}
```

**Razao:** Se evento e emitido ANTES e o create falha, o evento fica **orfao** (processadores vao buscar pedido que nao existe).

### ERRADO - Emitir antes de persistir

```typescript
async criarPedido(dto: CreatePedidoDto) {
  // Emite evento antes
  await this.eventProducer.emit('order.created', {
    pedidoId: 'ainda-nao-existe',
    valor: dto.valor
  });

  // Se falhar aqui, evento orfao!
  const op = new OperacaoPedido({ ... });
  await op.nova();
  await op.grava();
}
```

---

## 8. VALORES MONETARIOS

### SEMPRE usar Decimal(19,4), NUNCA Float

**Contexto:** Float tem problemas de precisao (0.1 + 0.2 = 0.30000000000000004).

```typescript
// CORRETO - Schema Prisma
model DPedido {
  valor     Decimal @db.Decimal(19, 4)  // 15 digitos inteiros, 4 decimais
  desconto  Decimal @db.Decimal(19, 4)
}

// CORRETO - Calculos
import { Decimal } from '@prisma/client/runtime/library';

const valor = new Decimal(100.00);
const taxa = new Decimal(2.50);
const liquido = valor.minus(taxa);  // 97.50 (preciso!)
```

```typescript
// ERRADO - Float/Number
valor: number;  // Perde precisao em centavos!

const liquido = 100.00 - 2.50;  // JavaScript Float (impreciso)
```

**Conversao segura:**
```typescript
// Decimal -> Number (para response DTO)
const valorNumber = parseFloat(pedido.valor.toFixed(2));

// Number -> Decimal (para persistir)
const valorDecimal = new Decimal(dto.valor);
```

---

## 9. VALIDACAO E DTOs

### SEMPRE usar DTOs com class-validator

```typescript
// CORRETO - DTO com validacoes
import { IsString, IsNumber, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEntidadeDto {
  @ApiProperty({ example: 'Empresa ABC', description: 'Nome da entidade' })
  @IsString()
  nome: string;

  @ApiProperty({ example: '-45', description: 'ID da classe da entidade' })
  @IsString()
  idClasse: string;

  @ApiPropertyOptional({ example: 'Observacao opcional' })
  @IsOptional()
  @IsString()
  observacao?: string;
}
```

**Controller com DTO:**
```typescript
@Post()
async criar(@Body() dto: CreateEntidadeDto) {  // Validacao automatica!
  return await this.service.criar(dto);
}
```

---

## 10. GUARDS E AUTENTICACAO

### Proteger endpoints com Guards apropriados

```typescript
// CORRETO - Endpoint protegido
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('entidades')
@UseGuards(JwtAuthGuard)  // Requer autenticacao
export class EntidadeController {

  @Get(':id/metricas')
  async getMetricas(@Param('id') id: string) {
    // ...
  }
}
```

```typescript
// ERRADO - Endpoint sem protecao
@Get('entidades/:id/dados')  // Dados sensiveis SEM guard!
async getDados(@Param('id') id: string) {
  // Qualquer um pode acessar!
}
```

---

## 11. LOGGING E ERROR HANDLING

### Usar Logger do NestJS, NUNCA console.log

```typescript
// CORRETO
import { Logger } from '@nestjs/common';

export class MeuService {
  private readonly logger = new Logger(MeuService.name);

  async processar() {
    this.logger.log('Iniciando processamento');
    this.logger.debug('Detalhes tecnicos', { entidadeId: 123 });
    this.logger.warn('Situacao atipica detectada');
    this.logger.error('Erro critico', error.stack);
  }
}
```

```typescript
// ERRADO
console.log('Processando...');  // Nao tem contexto, nao vai para logs estruturados
```

### Lancar HttpException apropriada

```typescript
// CORRETO - Excecoes especificas
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException
} from '@nestjs/common';

if (!entidade) {
  throw new NotFoundException(`Entidade ${id} nao encontrada`);
}

if (existingEntidade) {
  throw new ConflictException(`Entidade com este identificador ja existe`);
}

if (valor <= 0) {
  throw new BadRequestException('Valor deve ser maior que zero');
}
```

---

## 12. PADROES DE CONTROLLER

```typescript
// CORRETO - Controller limpo (orquestra, nao implementa)
@Controller('entidades')
@UseGuards(JwtAuthGuard)
export class EntidadeController {
  private readonly logger = new Logger(EntidadeController.name);

  constructor(
    private readonly entidadeService: EntidadeService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar entidades por classe' })
  @ApiResponse({ status: 200, description: 'Lista retornada', type: ListEntidadeResponseDto })
  @ApiResponse({ status: 404, description: 'Classe nao encontrada' })
  async listar(
    @Query() query: ListEntidadeQueryDto
  ): Promise<ListEntidadeResponseDto> {
    this.logger.log(`Listando entidades com classe ${query.idClasse}`);

    // Delega para service (controller NAO tem logica de negocio)
    return await this.entidadeService.listarPorClasse(query);
  }
}
```

**Controller NAO deve:**
- Acessar Prisma diretamente (usa service)
- Ter logica de negocio (delega para service)
- Fazer calculos complexos
- Emitir eventos (service faz isso)

**Controller DEVE:**
- Validar entrada (via DTOs)
- Orquestrar chamadas de services
- Transformar response (se necessario)
- Tratar excecoes (try/catch se necessario)

---

## 13. PADROES DE SERVICE

```typescript
// CORRETO - Service com responsabilidade unica
@Injectable()
export class EntidadeService {
  private readonly logger = new Logger(EntidadeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
    private readonly eventProducer: EventProducerService
  ) {}

  async listarPorClasse(
    query: ListEntidadeQueryDto
  ): Promise<ListEntidadeResponseDto> {
    this.logger.debug(`Fetching entities for classe ${query.idClasse}`);

    // 1. Validacao de negocio
    const classe = await this.prisma.dClasse.findFirst({
      where: { chave: BigInt(query.idClasse) }
    });

    if (!classe) {
      throw new NotFoundException(`Classe ${query.idClasse} nao encontrada`);
    }

    // 2. Query otimizada (ZERO N+1)
    const entidades = await this.prisma.dEntidade.findMany({
      where: {
        idClasse: BigInt(query.idClasse),
        excluido: false
      },
      include: {
        DClasse: {
          select: { chave: true, nome: true, codigo: true }
        }
      },
      take: query.limit || 20,
      orderBy: { chave: 'desc' }
    });

    // 3. Transformacao de dados
    return this.buildListResponse(entidades);
  }

  // Metodos privados para logica auxiliar
  private buildListResponse(data: any[]): ListEntidadeResponseDto {
    // ...
  }
}
```

---

## 14. EVENT EMISSION - PADROES

### Usar EventProducerService, NUNCA emitir direto

```typescript
// CORRETO
import { EventProducerService } from '../eventos/core/event-producer.service';

constructor(
  private readonly eventProducer: EventProducerService
) {}

// Emitir evento apos persistencia
await this.eventProducer.addInternalEvent(
  'entity.created',
  {
    entidadeId: entidade.chave.toString(),
    idClasse: entidade.idClasse.toString(),
    nome: entidade.nome
  },
  correlationId
);
```

**Nomenclatura padrao (formato: dominio.entidade.acao):**
- Pedidos: `order.created`, `order.approved`, `order.cancelled`
- Entidades: `entity.created`, `entity.updated`, `entity.deleted`
- Sistema: `system.audit.log`, `system.health.check`
- Retry: `retry.attempted`, `retry.blocked`

**Ver `devari-event-naming.md` para nomenclatura completa.**

**REGRA CRITICA:** Adapters emitem eventos, `EventRouterService` decide a fila. **NUNCA** implemente logica de roteamento no adapter.

---

## 15. PERFORMANCE

### Cursor Pagination para listas grandes

```typescript
// CORRETO - Cursor pagination (escalavel)
async listar(cursor?: string, limit: number = 20) {
  return await this.prisma.dEntidade.findMany({
    where: {
      ...(cursor ? { chave: { gt: BigInt(cursor) } } : {}),
      excluido: false
    },
    take: limit,
    orderBy: { chave: 'asc' }
  });
}
```

```typescript
// ERRADO - Offset pagination (nao escala)
async listar(page: number, limit: number) {
  const skip = (page - 1) * limit;
  return await this.prisma.dEntidade.findMany({
    skip: skip,  // Performance degrada em paginas altas (skip=10000)
    take: limit
  });
}
```

### Usar select para reduzir payload

```typescript
// CORRETO - Seleciona apenas campos necessarios
const entidades = await this.prisma.dEntidade.findMany({
  where: { idClasse: BigInt(-45) },
  select: {
    chave: true,
    nome: true,
    cpfCnpj: true
    // NAO busca outros 20 campos desnecessarios
  }
});
```

---

## 16. TESTES

### Padrao de testes (unit + integration)

```typescript
// CORRETO - Teste unitario de service
describe('EntidadeService', () => {
  let service: EntidadeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EntidadeService,
        {
          provide: PrismaService,
          useValue: {
            dEntidade: {
              findMany: jest.fn(),
              create: jest.fn()
            },
            dClasse: {
              findFirst: jest.fn()
            }
          }
        }
      ]
    }).compile();

    service = module.get(EntidadeService);
    prisma = module.get(PrismaService);
  });

  it('deve listar entidades por classe com sucesso', async () => {
    const mockData = [{ chave: BigInt(1), nome: 'Entidade 1' }];
    jest.spyOn(prisma.dClasse, 'findFirst').mockResolvedValue({ chave: BigInt(-45) });
    jest.spyOn(prisma.dEntidade, 'findMany').mockResolvedValue(mockData);

    const result = await service.listarPorClasse({ idClasse: '-45' });

    expect(result.items).toHaveLength(1);
    expect(prisma.dEntidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ idClasse: BigInt(-45) })
      })
    );
  });
});
```

---

## 17. SWAGGER/OPENAPI DECORATORS

### SEMPRE documentar endpoints

```typescript
// CORRETO - Endpoint bem documentado
@Get(':id')
@ApiOperation({
  summary: 'Buscar entidade por ID',
  description: 'Retorna dados completos da entidade incluindo classe e vinculos'
})
@ApiParam({
  name: 'id',
  description: 'ID da entidade (chave da DEntidade)',
  example: '123'
})
@ApiResponse({
  status: 200,
  description: 'Entidade encontrada',
  type: EntidadeResponseDto
})
@ApiResponse({
  status: 404,
  description: 'Entidade nao encontrada'
})
async findOne(@Param('id') id: string): Promise<EntidadeResponseDto> {
  // ...
}
```

---

## 18. IMPORTS ORGANIZADOS

### Ordem padrao de imports

```typescript
// 1. NestJS
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

// 2. Libraries externas
import { Decimal } from '@prisma/client/runtime/library';

// 3. Services do projeto
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { EntidadeService } from '../entidades/entidades.service';

// 4. DTOs
import { CreateEntidadeDto } from './dto/create-entidade.dto';
import { EntidadeResponseDto } from './dto/entidade-response.dto';

// 5. Types/Interfaces/Enums
import { EntityType } from '../common/enums/entity-type.enum';
```

---

## 19. CONSTANTES DE IDs

### Design Polimorfico com DClasse

O Devari Core usa `DClasse` com IDs negativos para definir a taxonomia do sistema. IDs sao definidos por projeto (via seeds).

**Referencia:** `prisma/seeds/classes.seed.ts`

```typescript
// REGRA: Usar constantes do seed, nao hardcoded
// Ver templates/classes-base-template.ts para as ~50 classes fixas

// Exemplos de classes fixas (presentes em TODO projeto):
// -40: Conta Virtual
// -45: Marketplace
// -47: Seller
// -49: Plataforma
// -50: Comprador
// -51: Agrupamento de Projeto (pai para classes de projeto)

// Exemplos de classes especificas (variam por dominio):
// -400 a -999: Definidas no YAML (seed_classes.classes_especificas)
```

**REGRA:** Ao criar features, consultar `prisma/seeds/classes.seed.ts` para IDs validos. NAO inventar IDs -- usar os que ja existem no seed.

---

## 20. 3 PILARES (Referencia Rapida)

Os 3 Pilares sustentam TODO o Devari Core. Detalhe completo em `devari-3-pilares.md`.

### Pilar 1: Engine/Operacao
- **SEMPRE** usar Engine para INSERT em tabelas transacionais (DPedido, DTitulo, DMovDispo)
- Workflow: `nova() -> setDados() -> calcula() -> aprova() -> grava()`
- **NUNCA** usar `prisma.dPedido.create()` direto

### Pilar 2: Endpoints Genericos
- Reusar `/entidades?idClasse=X` e `/tabelas?idClasse=X`
- **NAO** criar controllers duplicados (UserController, StatusController, etc.)

### Pilar 3: Seed de Classes
- Sistema **NAO INICIA** sem seed correto
- SEMPRE priorizar seed como FASE 1 de qualquer implementacao
- ~50 classes fixas (templates/) + N classes especificas (por dominio)

---

## 21. CHECKLIST DE QUALIDADE

Antes de considerar codigo "pronto", verificar:

- [ ] PrismaService (nao DatabaseService)
- [ ] BigInt para todos os IDs
- [ ] Transactions em operacoes multi-tabela
- [ ] TimezoneService para filtros de data
- [ ] EntidadeService.getEntidadeIdFromUserGroup (conversao IDs)
- [ ] N+1 queries = ZERO (verificado com DATABASE_LOGGING)
- [ ] Eventos emitidos APOS persistencia
- [ ] Decimal para valores monetarios
- [ ] DTOs com class-validator
- [ ] Guards em endpoints privados
- [ ] Logger (nao console.log)
- [ ] HttpException apropriada
- [ ] Swagger decorators completos
- [ ] Imports organizados
- [ ] Testes (unit + integration)
- [ ] Build passa: `make build`
- [ ] Engine/Operacao para INSERT em tabelas transacionais (Pilar 1)
- [ ] Endpoints genericos reutilizados quando possivel (Pilar 2)
- [ ] Seed de Classes correto e completo (Pilar 3)

---

**Este skill sera injetado automaticamente em todos os agents que trabalham com codigo TypeScript em `src/**/*.ts`.**
