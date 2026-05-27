/**
 * Enum dos tipos de alvo suportados pelo CommentsModule polimórfico.
 *
 * V1 (atual): task, project, folder, list.
 * DOC fica pronto para entrar quando DocsModule for implementado — basta
 * descomentar a linha + adicionar uma entrada no `CommentTargetResolver`.
 *
 * Cada `targetType` mapeia para uma estratégia diferente de:
 * - Como achar o alvo (tabela + idClasse).
 * - Como validar acesso do requester (ProjectsService vs ProjectMembersService).
 *
 * @see CommentTargetResolver — implementação das regras de cada tipo.
 */
export enum CommentTargetType {
  TASK = 'task',
  PROJECT = 'project',
  FOLDER = 'folder',
  LIST = 'list',
  // DOC = 'doc',  // DEFERIDO — habilitar quando DocsModule for implementado
}
