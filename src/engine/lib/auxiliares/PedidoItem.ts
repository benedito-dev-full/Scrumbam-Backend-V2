import { Decimal } from '@prisma/client/runtime/library';

/**
 * PedidoItem — Value Object que representa 1 item de pedido em memória.
 *
 * DECISÃO CEO Q3 (2026-05-09): DPedidoItem NÃO existe como tabela no schema Prisma V2.
 * Itens de execution ficam serializados em DPedido.dados (campo Json).
 * Este VO existe para compatibilidade futura com Engines que tenham itens múltiplos
 * (ex: futuro Engine de cobrança com múltiplos itens).
 *
 * SEM Prisma. SEM decorators ORM. VO puro — apenas dados em memória.
 */
export class PedidoItem {
  private readonly _descricao: string;
  private readonly _quantidade: number;
  private readonly _valorUnitario: Decimal;

  constructor(descricao: string, quantidade: number, valorUnitario: Decimal) {
    this._descricao = descricao;
    this._quantidade = quantidade;
    this._valorUnitario = valorUnitario;
  }

  getDescricao(): string {
    return this._descricao;
  }

  getQuantidade(): number {
    return this._quantidade;
  }

  getValorUnitario(): Decimal {
    return this._valorUnitario;
  }

  getTotal(): Decimal {
    return this._valorUnitario.mul(this._quantidade);
  }

  toJson(): object {
    return {
      descricao: this._descricao,
      quantidade: this._quantidade,
      valorUnitario: this._valorUnitario.toString(),
      total: this.getTotal().toString(),
    };
  }
}
