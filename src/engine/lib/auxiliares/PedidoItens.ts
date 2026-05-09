import { PedidoItem } from './PedidoItem';

/**
 * PedidoItens — Value Object que representa a coleção de itens de um pedido em memória.
 *
 * DECISÃO CEO Q3 (2026-05-09): DPedidoItem NÃO existe como tabela no schema Prisma V2.
 * Itens de execution ficam serializados em DPedido.dados (campo Json).
 * Esta coleção existe para compatibilidade futura com Engines que tenham itens múltiplos.
 *
 * SEM Prisma. SEM decorators ORM. VO puro — apenas dados em memória.
 */
export class PedidoItens {
  private _itens: PedidoItem[] = [];

  /** Adiciona um item à coleção */
  add(item: PedidoItem): void {
    this._itens.push(item);
  }

  /** Retorna cópia defensiva da lista de itens */
  getAll(): PedidoItem[] {
    return [...this._itens];
  }

  /** Limpa todos os itens */
  clear(): void {
    this._itens = [];
  }

  /** Retorna o número de itens */
  count(): number {
    return this._itens.length;
  }

  /** Serializa todos os itens para array de objetos simples */
  toJson(): object[] {
    return this._itens.map((i) => i.toJson());
  }
}
