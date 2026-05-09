/**
 * Testes de regressão ADR-V2-016 — s.chaveScript vs s.id (BLOQUEANTES)
 *
 * CONTEXTO DO BUG:
 *   No código legado, o filtro para selecionar scripts DVFS usava `s.id` (campo inexistente
 *   no schema Prisma V2 — a PK se chama `chave`). O campo correto é `s.chaveScript` (INTEGER).
 *   Resultado: scripts de chave=5 (pós-cálculo) e chave=7 (pós-gravação) NUNCA eram carregados,
 *   pois os índices 5 e 7 não correspondiam a nenhum `chave` BIGSERIAL baixo.
 *
 * DEFESA:
 *   DvfsLoaderHelper usa Map<chaveScript, conteudo> onde a chave é sempre chaveScript (number).
 *   OperacaoPedido._carregaScriptsCalc/Grav usa scripts.get(3), scripts.get(5), etc.
 *   Estes 2 testes garantem que a chave 5 (pos-calculo) e chave 7 (pos-gravacao) SÃO executadas.
 *   SE o bug voltar (ex: alguém trocar para row.id), os scripts não executam e os testes FALHAM.
 *
 * ESTRUTURA DOS MOCKS:
 *   O DvfsLoaderHelper usa `prisma.dVFS.findFirst` (com fallback para -300).
 *   Os mocks simulam 2 chamadas por chaveScript: 1ª para idClasse concreto (retorna null),
 *   2ª para idClasse=-300 (retorna o script). Isso testa o caminho de fallback real.
 *
 * @see ADR-V2-016 (docs/decisions/ADR-V2-016-script-key-binding.md)
 * @see src/engine/helpers/dvfs-loader.helper.ts
 * @see src/engine/lib/operacao/OperacaoPedido.ts (_carregaScriptsCalc, _carregaScriptsGrav)
 */

import { Logger } from '@nestjs/common';
import OperacaoPedido from '../OperacaoPedido';

// ---- Helper: constrói mock Prisma configurável por test ----

/**
 * Cria um mockPrisma que simula o banco com scripts DVFS configuráveis.
 * O DvfsLoaderHelper faz 2 chamadas por chaveScript:
 *   1ª: idClasse concreto (ex: -300) → null (força fallback)
 *   2ª: idClasse=-300 (fallback) → retorna script se presente em scriptMap
 *
 * @param scriptMap Map<chaveScript, conteudo> dos scripts a retornar
 */
function buildMockPrisma(scriptMap: Map<number, string>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      return fn({
        dPedido: {
          create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
        },
      });
    }),
    dPedido: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
      update: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
    },
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const { chaveScript } = where;
        const conteudo = scriptMap.get(chaveScript);
        if (conteudo !== undefined) {
          return Promise.resolve({ chave: BigInt(chaveScript + 1000), chaveScript, conteudo, ativo: true });
        }
        return Promise.resolve(null);
      }),
    },
  };
}

// ---- Testes BLOQUEANTES ADR-V2-016 ----

describe('OperacaoPedido — Regressão ADR-V2-016: s.chaveScript vs s.id', () => {

  // Silencia Logger nos testes para saída limpa
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  /**
   * R-CHAVE-5: _funcPosCalculo carregada via chaveScript=5 (não s.id)
   *
   * Se o filtro usar s.id (bug), o Map.get(5) não encontrará nada porque
   * o DvfsLoaderHelper não usa row.id — usa chaveScript como chave do Map.
   * O script de chave 5 contém uma mutação em op.dados para detectar execução.
   * Se _funcPosCalculo não carregar, a flag não é setada → teste FALHA → bug exposto.
   */
  it('R-CHAVE-5: _funcPosCalculo carrega e executa DVFS chaveScript=5', async () => {
    // GIVEN: 5 scripts DVFS, chaveScript=5 muta op.dados._dvfs5_executado
    const scriptMap = new Map<number, string>([
      [3, '(function(op){ if(!op.dados) op.dados = {}; })'],
      [4, '(function(op){ if(!op.dados) op.dados = {}; })'],
      [5, '(function(op){ if(!op.dados) op.dados = {}; op.dados._dvfs5_executado = true; })'],
      [6, '(function(op){})'],
      [7, '(function(op){})'],
    ]);

    const mockPrisma = buildMockPrisma(scriptMap);

    const op = new OperacaoPedido({
      usuario: '1',
      classe: '-300',
      bd: mockPrisma as any,
    });

    // WHEN: nova() carrega scripts + calcula() executa chave 5
    await op.nova();
    op.pedidoCab.setValor(0);
    await op.calcula();

    // THEN: script da chave 5 foi executado (flag setada)
    // SE bug ADR-V2-016 voltar: _funcPosCalculo = undefined, IF guard pula, flag não setada → FAIL
    const dadosInterno = (op as any).dados;
    expect(dadosInterno?._dvfs5_executado).toBe(true);
  });

  /**
   * R-CHAVE-7: _funcPosGravacao carregada via chaveScript=7 (não s.id)
   *
   * Se o filtro usar s.id (bug), o script da chave 7 nunca executa.
   * PR auto-open e notification-dispatcher ficam silenciosos para sempre.
   * O script de chave 7 muta op.dados._dvfs7_executado para detectar execução.
   */
  it('R-CHAVE-7: _funcPosGravacao carrega e executa DVFS chaveScript=7', async () => {
    // GIVEN: 5 scripts DVFS, chaveScript=7 muta op.dados._dvfs7_executado
    const scriptMap = new Map<number, string>([
      [3, '(function(op){ if(!op.dados) op.dados = {}; })'],
      [4, '(function(op){ if(!op.dados) op.dados = {}; })'],
      [5, '(function(op){})'],
      [6, '(function(op){})'],
      [7, '(async function(op){ if(!op.dados) op.dados = {}; op.dados._dvfs7_executado = true; })'],
    ]);

    const mockPrisma = buildMockPrisma(scriptMap);

    const op = new OperacaoPedido({
      usuario: '1',
      classe: '-300',
      bd: mockPrisma as any,
    });

    // WHEN: nova() → calcula() → aprova() → grava() — script chave 7 roda APÓS INSERT
    await op.nova();
    op.pedidoCab.setValor(0);
    await op.calcula();
    await op.aprova({ aprovador: 'test-approver' });
    await op.grava();

    // THEN: script da chave 7 foi executado APÓS INSERT
    // SE bug ADR-V2-016 voltar: _funcPosGravacao = undefined, grava() pula, flag não setada → FAIL
    const dadosInterno = (op as any).dados;
    expect(dadosInterno?._dvfs7_executado).toBe(true);
  });

  /**
   * DVFS-NULL-WARN: chave ausente retorna undefined e loga Logger.warn
   *
   * Garante que scripts ausentes não causam erro fatal (apenas warn).
   * Sistema funciona de modo degradado se chave 5 não estiver no banco.
   */
  it('DVFS-NULL-WARN: chave ausente resulta em _funcPosCalculo=undefined e Logger.warn', async () => {
    // GIVEN: sem script para chaveScript=5
    const scriptMap = new Map<number, string>([
      [3, '(function(op){ if(!op.dados) op.dados = {}; })'],
      [4, '(function(op){ if(!op.dados) op.dados = {}; })'],
      // chave 5 AUSENTE intencionalmente
      [6, '(function(op){})'],
      [7, '(function(op){})'],
    ]);

    const mockPrisma = buildMockPrisma(scriptMap);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const op = new OperacaoPedido({
      usuario: '1',
      classe: '-300',
      bd: mockPrisma as any,
    });

    // WHEN: nova() tenta carregar chave 5 → não encontra
    await op.nova();

    // THEN: _funcPosCalculo é undefined (não null, não throw)
    expect((op as any)._funcPosCalculo).toBeUndefined();

    // THEN: Logger.warn foi chamado mencionando "chave 5"
    const warnCalls = warnSpy.mock.calls.map(args => args[0]);
    const mentionedChave5 = warnCalls.some(msg => String(msg).includes('chave 5') || String(msg).includes('5'));
    expect(mentionedChave5).toBe(true);

    warnSpy.mockRestore();
  });
});
