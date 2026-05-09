import Operacao from './Operacao';
import { PedidoCabecalho } from '../auxiliares/PedidoCabecalho';
import { PedidoItens } from '../auxiliares/PedidoItens';
import { DvfsLoaderHelper } from '../../helpers/dvfs-loader.helper';
import { IOperacaoPedidoConstruct } from '../interfaces/IOperacaoPedidoConstruct';

/**
 * OperacaoPedido — Engine completo do Devari Core.
 *
 * Implementa o workflow polimórfico completo para INSERT em tabelas transacionais:
 *   nova() → calcula() → aprova() → grava()
 *
 * Carrega scripts DVFS via DvfsLoaderHelper e os executa nos momentos corretos:
 *   - Chave 3 (pré-cálculo): `_funcPreCalculo(this)` em calcula()
 *   - Chave 4 (cálculo): `_funcCalculo(this)` em calcula()
 *   - Chave 5 (pós-cálculo): `_funcPosCalculo(this)` em calcula()
 *   - Chave 6 (pré-gravação): `_funcPreGravacao(this)` em grava()
 *   - Chave 7 (pós-gravação): `_funcPosGravacao(this)` em grava() APÓS INSERT
 *
 * REGRA INVIOLÁVEL (ADR-V2-016):
 *   Filtro DVFS usa `s.chaveScript` (INTEGER no schema).
 *   NUNCA usar `s.id` — esse campo NÃO existe no schema Prisma V2.
 *
 * REGRA INVIOLÁVEL (Pilar 1):
 *   Engine APENAS para INSERT em DPedido idClasse=-300..-303.
 *   NUNCA instanciar para DTask, DProject, DEntidade, DTabela, DVincula.
 *
 * @see ADR-V2-016 (script-key-binding)
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see devari-3-pilares.md §Pilar 1
 * @see devari-polymorphic-engine.md §2
 */
export default class OperacaoPedido extends Operacao {
  /** Cabeçalho do pedido: encapsula campos de DPedido */
  public pedidoCab: PedidoCabecalho;

  /** Coleção de itens (VO puro — itens ficam em DPedido.dados Json no V2) */
  protected _itensPedido: PedidoItens;

  /** idClasse como string. Definido no constructor. Pode ser sobrescrito em calcula() por subclasses */
  protected _classeBase: string;

  /** Controle de fluxo */
  protected _operacaoCalculada = false;
  protected _aprovado: boolean | null = null;
  protected _baixado: boolean | null = null;

  /**
   * Scripts DVFS carregados em nova() via _carregaScriptsCalc() e _carregaScriptsGrav().
   *
   * CRÍTICO ADR-V2-016: carregados pelo Map retornado por DvfsLoaderHelper.loadScripts().
   * A chave do Map é chaveScript (3,4,5,6,7) — não row.chave (PK BIGSERIAL da DVFS).
   */
  protected _funcPreCalculo: ((op: this) => void | Promise<void>) | undefined;    // chave=3
  protected _funcCalculo: ((op: this) => void | Promise<void>) | undefined;       // chave=4
  protected _funcPosCalculo: ((op: this) => void | Promise<void>) | undefined;    // chave=5
  protected _funcPreGravacao: ((op: this) => void | Promise<void>) | undefined;   // chave=6
  protected _funcPosGravacao: ((op: this) => void | Promise<void>) | undefined;   // chave=7

  /** Loader de scripts DVFS com cache TTL 5min e fallback para idClasse=-300 */
  private _dvfsLoader: DvfsLoaderHelper;

  constructor(params: IOperacaoPedidoConstruct) {
    super(params);
    this._classeBase = params.classe;
    this.pedidoCab = new PedidoCabecalho();
    this._itensPedido = new PedidoItens();
    this._dvfsLoader = new DvfsLoaderHelper();
  }

  /**
   * Carrega scripts DVFS de cálculo (chaves 3, 4, 5).
   * Chamado internamente por nova().
   *
   * CRÍTICO ADR-V2-016:
   * - `scripts` é Map<chaveScript, conteudo> retornado por DvfsLoaderHelper
   * - scripts.get(3), scripts.get(5) etc. usam chaveScript como chave (CORRETO)
   * - NUNCA filtrar por row.id ou row.chave para selecionar scripts
   */
  protected async _carregaScriptsCalc(): Promise<void> {
    const scripts = await this._dvfsLoader.loadScripts(
      this._database,
      BigInt(this._classeBase),
    );

    // CRÍTICO ADR-V2-016: usar scripts.get(N) onde N = chaveScript (3, 4, 5)
    // O DvfsLoaderHelper já garantiu que a chave do Map é chaveScript, não row.id
    const conteudo3 = scripts.get(3);
    const conteudo4 = scripts.get(4);
    const conteudo5 = scripts.get(5); // ADR-V2-016: chave 5 DEVE ser carregada

    if (conteudo3) {
      try {
        // eslint-disable-next-line no-eval
        this._funcPreCalculo = eval(`(${conteudo3})`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`DVFS chave 3 eval error: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `DVFS chave 3 não encontrada para idClasse=${this._classeBase} (pré-cálculo ausente)`,
      );
    }

    if (conteudo4) {
      try {
        // eslint-disable-next-line no-eval
        this._funcCalculo = eval(`(${conteudo4})`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`DVFS chave 4 eval error: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `DVFS chave 4 não encontrada para idClasse=${this._classeBase} (cálculo ausente)`,
      );
    }

    if (conteudo5) {
      try {
        // eslint-disable-next-line no-eval
        this._funcPosCalculo = eval(`(${conteudo5})`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`DVFS chave 5 eval error: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `DVFS chave 5 não encontrada para idClasse=${this._classeBase} (pós-cálculo vazio)`,
      );
    }
  }

  /**
   * Carrega scripts DVFS de gravação (chaves 6, 7).
   * Chamado internamente por nova().
   *
   * CRÍTICO ADR-V2-016:
   * - scripts.get(7) usa chaveScript=7 (CORRETO)
   * - NUNCA usar scripts.get(row.id) ou qualquer campo PK para selecionar scripts
   */
  protected async _carregaScriptsGrav(): Promise<void> {
    const scripts = await this._dvfsLoader.loadScripts(
      this._database,
      BigInt(this._classeBase),
    );

    const conteudo6 = scripts.get(6);
    const conteudo7 = scripts.get(7); // ADR-V2-016: chave 7 DEVE ser carregada

    if (conteudo6) {
      try {
        // eslint-disable-next-line no-eval
        this._funcPreGravacao = eval(`(${conteudo6})`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`DVFS chave 6 eval error: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `DVFS chave 6 não encontrada para idClasse=${this._classeBase} (pré-gravação vazio)`,
      );
    }

    if (conteudo7) {
      try {
        // eslint-disable-next-line no-eval
        this._funcPosGravacao = eval(`(${conteudo7})`); // ADR-V2-016
      } catch (e) {
        const err = e as Error;
        this.logger.warn(`DVFS chave 7 eval error: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `DVFS chave 7 não encontrada para idClasse=${this._classeBase} (pós-gravação vazio)`,
      );
    }
  }

  /**
   * Inicializa a operação: gera chave via sequence + carrega scripts DVFS.
   *
   * ORDEM: super.nova() (gera chcriacao) → _carregaScriptsCalc() → _carregaScriptsGrav()
   *
   * @param chaveCustom Chave personalizada (usar apenas em testes)
   */
  async nova(chaveCustom?: bigint): Promise<void> {
    await super.nova(chaveCustom);
    await this._carregaScriptsCalc();
    await this._carregaScriptsGrav();
    this.logger.debug(`Scripts DVFS carregados para idClasse=${this._classeBase}`);
  }

  /**
   * Executa os scripts DVFS de cálculo (chaves 3, 4, 5) em ordem.
   *
   * Guards de undefined protegem cada script — script ausente é avisado em warn
   * mas não lança erro (chaves 5, 6, 7 são opcionais; chaves 3 e 4 são
   * obrigatórias em OperacaoExecucaoClaude mas opcionais em OperacaoPedido base).
   *
   * Idempotente: chamar calcula() duas vezes não re-executa scripts.
   */
  async calcula(): Promise<void> {
    if (this._operacaoCalculada) return;

    // Chave 3: pré-cálculo
    if (this._funcPreCalculo) {
      await this._funcPreCalculo(this);
    }

    // Chave 4: cálculo
    if (this._funcCalculo) {
      await this._funcCalculo(this);
    }

    // Chave 5: pós-cálculo — ADR-V2-016: DEVE ser executado se carregado
    if (this._funcPosCalculo) {
      await this._funcPosCalculo(this);
    }

    this._operacaoCalculada = true;
  }

  /**
   * Aprova o pedido: marca como aprovado e registra aprovador.
   *
   * Se calcula() ainda não foi chamado, chama internamente antes de aprovar.
   *
   * @param params.aprovador ID/identificador do aprovador (ex: 'auto:risk-gate-low', '12345')
   */
  async aprova(params: { aprovador: string }): Promise<void> {
    if (!this._operacaoCalculada) {
      await this.calcula();
    }
    this._aprovado = true;
    this.pedidoCab.setAprovedBy(params.aprovador);
    this.logger.debug(`Pedido aprovado por ${params.aprovador}`);
  }

  /**
   * Persiste o pedido em DPedido via transaction atômica.
   *
   * Fluxo:
   *   1. Se calcula() não foi chamado: chama internamente
   *   2. Executa DVFS chave 6 (pré-gravação): última validação antes do INSERT
   *   3. INSERT DPedido em $transaction (chave pré-gerada via sequence)
   *   4. Executa DVFS chave 7 (pós-gravação) APÓS INSERT bem-sucedido (ADR-V2-016)
   *
   * REGRA (Padrão #7 devari-backend-patterns):
   *   Scripts pós-gravação (chave 7) rodam APÓS persistência bem-sucedida.
   *   Eventos nunca são emitidos antes do INSERT.
   */
  async grava(): Promise<void> {
    if (!this._operacaoCalculada) {
      await this.calcula();
    }

    // Pré-gravação: DVFS chave 6
    if (this._funcPreGravacao) {
      await this._funcPreGravacao(this);
    }

    // INSERT atômico em DPedido
    await this._database.$transaction(async (tx) => {
      await tx.dPedido.create({
        data: {
          chave: this.chcriacao,
          idClasse: BigInt(this._classeBase),
          idLocEscritu: this.pedidoCab.getLocEscritu() ?? undefined,
          idPessoa: this.pedidoCab.getPessoa() ?? undefined,
          valor: this.pedidoCab.getValor() ?? undefined,
          aprovado: this._aprovado ?? false,
          baixado: this._baixado ?? false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dados: (this.pedidoCab.getDados() as any) ?? undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metaDados: (this.pedidoCab.getMetaDados() as any) ?? undefined,
          dataAprovacao: this.pedidoCab.getDataAprovacao() ?? undefined,
        },
      });
    });

    this.logger.log(
      `DPedido persistido — chave=${this.chcriacao}, idClasse=${this._classeBase}`,
    );

    // Pós-gravação: DVFS chave 7 — APÓS INSERT (ADR-V2-016, Padrão #7)
    if (this._funcPosGravacao) {
      await this._funcPosGravacao(this); // ADR-V2-016: _funcPosGravacao carregada via chaveScript=7
    }
  }
}
