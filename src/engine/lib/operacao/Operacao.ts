import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { getNextSequenceKey } from '../../helpers/sequence.helper';
import { IOperacaoConstruct } from '../interfaces/IOperacaoConstruct';

/**
 * Operacao — Classe base abstrata do Engine Devari Core.
 *
 * Todos os Engines herdam desta classe. Fornece:
 * - Geração de chave única via PostgreSQL sequence (`chcriacao_seq`)
 * - Lifecycle básico (nova/erro)
 * - Logger contextualizado por subclasse
 *
 * NÃO contém calcula/aprova/grava — isso é responsabilidade de OperacaoPedido.
 * NÃO contém lógica de negócio — apenas infraestrutura do Engine.
 *
 * Hierarquia de extensão:
 *   Operacao (abstract)
 *     └── OperacaoPedido (FULL workflow + DVFS)
 *           └── OperacaoExecucaoClaude (V2 — Risk Gate + Approval + Claude Runner)
 *
 * @see devari-3-pilares.md §Pilar 1
 * @see devari-polymorphic-engine.md §2
 */
export default abstract class Operacao {
  protected readonly logger: Logger;
  protected readonly _database: PrismaService;
  protected readonly _usuario: string;

  /** Chave única gerada pela sequence chcriacao_seq antes do INSERT */
  protected chcriacao!: bigint;

  /** Flag: nova() já foi chamado nesta instância */
  protected _iniciado = false;

  constructor(params: IOperacaoConstruct) {
    this._database = params.bd;
    this._usuario = params.usuario;
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Inicializa a operação: gera chave única via PostgreSQL sequence.
   * Deve ser SEMPRE o primeiro método chamado após o constructor.
   *
   * @param chaveCustom Chave personalizada (usar apenas em testes)
   * @throws Error se nova() já foi chamado nesta instância
   */
  async nova(chaveCustom?: bigint): Promise<void> {
    if (this._iniciado) {
      this.erro({
        mensagem:
          'nova() já foi chamado nesta instância. Criar uma nova instância para nova operação.',
      });
    }

    this.chcriacao =
      chaveCustom !== undefined
        ? chaveCustom
        : await getNextSequenceKey(this._database);

    this._iniciado = true;
    this.logger.debug(`Operação iniciada — chave=${this.chcriacao}, usuario=${this._usuario}`);
  }

  /**
   * Lança erro estruturado com log antes.
   * Centraliza o padrão de erro do Engine: sempre loga antes de lançar.
   *
   * @param params.mensagem Mensagem do erro
   * @param params.detalhes Detalhes opcionais (objeto, stack, etc.)
   * @throws Error com mensagem formatada
   */
  protected erro(params: { mensagem: string; detalhes?: unknown }): never {
    this.logger.error(`[Engine] ${params.mensagem}`, params.detalhes);
    throw new Error(`[Engine] ${params.mensagem}`);
  }
}
