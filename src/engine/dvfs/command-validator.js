// command-validator.js — DVFS chave=4 (cálculo)
// Valida o comando contra regras de segurança: path traversal, tamanho, conteúdo obrigatório, env allowlist.
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Lança Error se inválido — o Engine captura em calcula() e propaga como erro estruturado.
// Não modifica op.dados (script de validação puro).
//
// Executado APÓS risk-gate-validator (chave=3) — dados.risk já está populado.
//
// Task 15 (Bloco C): adicionada validação de env allowlist e detecção de secrets.
(function (op) {
  const command = op.dados && op.dados.command ? op.dados.command : {};
  const cwd = command.cwd || '';
  const text = command.text || '';
  const env = command.env || {};

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

  // Task 15: Validar env allowlist
  const ALLOWED_ENV_KEYS = [
    'NODE_ENV',
    'CI',
    'FORCE_COLOR',
    'NO_COLOR',
    'TERM',
    'LANG',
    'LC_ALL',
  ];

  // Task 15: Patterns de secrets em env values
  const SECRET_PATTERNS = [
    /token/i,
    /secret/i,
    /key/i,
    /password/i,
    /credential/i,
    /api[_-]?key/i,
    /access[_-]?key/i,
    /private[_-]?key/i,
    /aws[_-]?secret/i,
    /database[_-]?url/i,
  ];

  // Validar cada env var
  for (const key in env) {
    // Validar key na allowlist
    if (!ALLOWED_ENV_KEYS.includes(key)) {
      throw new Error('Env key não permitida: ' + key + '. Permitidas: ' + ALLOWED_ENV_KEYS.join(', '));
    }

    // Validar value não contém secret aparente
    const value = env[key];
    for (let i = 0; i < SECRET_PATTERNS.length; i++) {
      if (SECRET_PATTERNS[i].test(value)) {
        throw new Error('Env value para ' + key + ' contém padrão de secret aparente');
      }
    }
  }
})
