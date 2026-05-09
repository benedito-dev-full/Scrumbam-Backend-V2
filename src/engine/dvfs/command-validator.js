// command-validator.js — DVFS chave=4 (cálculo)
// Valida o comando contra regras de segurança: path traversal, tamanho, conteúdo obrigatório.
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Lança Error se inválido — o Engine captura em calcula() e propaga como erro estruturado.
// Não modifica op.dados (script de validação puro).
//
// Executado APÓS risk-gate-validator (chave=3) — dados.risk já está populado.
(function (op) {
  const command = op.dados && op.dados.command ? op.dados.command : {};
  const cwd = command.cwd || '';
  const text = command.text || '';

  // Validar path traversal em cwd
  if (cwd.includes('..')) {
    throw new Error('Path traversal detectado em cwd (contém ".."): ' + cwd);
  }

  // Validar paths absolutos proibidos em cwd
  if (/^\/etc|^\/var|^\/root|^\/bin|^\/sbin|^\/usr\/bin|^\/usr\/sbin/.test(cwd)) {
    throw new Error('Path de sistema proibido em cwd: ' + cwd);
  }

  // Validar que command.text não está vazio
  if (!text || text.trim().length === 0) {
    throw new Error('command.text não pode estar vazio');
  }

  // Validar tamanho máximo (50.000 caracteres)
  if (text.length > 50000) {
    throw new Error('command.text excede 50000 caracteres (tamanho: ' + text.length + ')');
  }
})
