import { Decimal } from '@prisma/client/runtime/library';

/**
 * PedidoCabecalho — Value Object que encapsula os campos do cabeçalho de DPedido.
 *
 * Centraliza setters/getters e a serialização de dados Json.
 * Não tem dependência de Prisma (VO puro — sem decorators ORM).
 *
 * Uso no Engine:
 *   op.pedidoCab.setValor(new Decimal(100));
 *   op.pedidoCab.setPessoa(BigInt(userId));
 *   op.pedidoCab.setDados({ command: ... });
 *   const data = op.pedidoCab.getData(); // para OperacaoPedido.grava()
 */
export class PedidoCabecalho {
  private _valor: Decimal | null = null;
  private _pessoa: bigint | null = null;
  private _locEscritu: bigint | null = null;
  private _dados: object | null = null;
  private _metaDados: object | null = null;
  private _aprovedBy: string | null = null;
  private _dataAprovacao: Date | null = null;

  /** Define o valor monetário do pedido */
  setValor(valor: Decimal | number): void {
    this._valor = valor instanceof Decimal ? valor : new Decimal(valor);
  }

  /** Define a pessoa associada ao pedido (FK para DEntidade) */
  setPessoa(id: bigint): void {
    this._pessoa = id;
  }

  /** Define o local de escrituração (FK para DEntidade) */
  setLocEscritu(id: bigint): void {
    this._locEscritu = id;
  }

  /** Define os dados polimórficos (serializado em DPedido.dados Json) */
  setDados(dados: object): void {
    this._dados = dados;
  }

  /** Define metadados (serializado em DPedido.metaDados Json) */
  setMetaDados(meta: object): void {
    this._metaDados = meta;
  }

  /** Registra o aprovador e a data de aprovação */
  setAprovedBy(aprovador: string): void {
    this._aprovedBy = aprovador;
    this._dataAprovacao = new Date();
  }

  /** Retorna o valor do pedido (null se não definido) */
  getValor(): Decimal | null {
    return this._valor;
  }

  /** Retorna o ID da pessoa (null se não definido) */
  getPessoa(): bigint | null {
    return this._pessoa;
  }

  /** Retorna o ID do local de escrituração (null se não definido) */
  getLocEscritu(): bigint | null {
    return this._locEscritu;
  }

  /** Retorna os dados polimórficos (null se não definido) */
  getDados(): object | null {
    return this._dados;
  }

  /** Retorna os metadados (null se não definido) */
  getMetaDados(): object | null {
    return this._metaDados;
  }

  /** Retorna o aprovador (null se não aprovado) */
  getAprovedBy(): string | null {
    return this._aprovedBy;
  }

  /** Retorna a data de aprovação (null se não aprovado) */
  getDataAprovacao(): Date | null {
    return this._dataAprovacao;
  }

  /**
   * Retorna snapshot dos campos para uso em OperacaoPedido.grava()
   * ao construir o data do DPedido.create().
   */
  getData(): {
    valor: Decimal | null;
    pessoa: bigint | null;
    locEscritu: bigint | null;
    dados: object | null;
    metaDados: object | null;
    aprovedBy: string | null;
    dataAprovacao: Date | null;
  } {
    return {
      valor: this._valor,
      pessoa: this._pessoa,
      locEscritu: this._locEscritu,
      dados: this._dados,
      metaDados: this._metaDados,
      aprovedBy: this._aprovedBy,
      dataAprovacao: this._dataAprovacao,
    };
  }
}
