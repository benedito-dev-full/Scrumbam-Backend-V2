import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO do payload de `join:list` / `leave:list` (Socket.io).
 *
 * O front envia `{ listId }` onde `listId === projectId === DProject.chave`
 * (a "lista" do board É o DProject — ver plano Task 6).
 *
 * Validação leve: garante que `listId` é uma string não vazia antes de
 * acionar o RBAC (`ProjectsService.findAccessibleProjectIds`).
 *
 * @example
 * ```typescript
 * socket.emit('join:list', { listId: '12345' });
 * ```
 */
export class JoinListDto {
  /**
   * Chave do DProject (lista) à qual o cliente quer assinar updates em
   * tempo real. String com BigInt serializado.
   */
  @IsString()
  @IsNotEmpty()
  listId!: string;
}
