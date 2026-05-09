import { IOperacaoConstruct } from './IOperacaoConstruct';

/**
 * Parâmetros para construção de OperacaoPedido.
 * Estende IOperacaoConstruct adicionando o idClasse do tipo de pedido.
 */
export interface IOperacaoPedidoConstruct extends IOperacaoConstruct {
  /** idClasse como string (bigint stringificado). Ex: '-300', '-301', '-302', '-303' */
  classe: string;
}
