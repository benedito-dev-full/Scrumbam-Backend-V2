/**
 * Copia os assets .js do engine/dvfs para o diretorio dist.
 * Script cross-platform (substitui o mkdir -p + cp do Unix).
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'engine', 'dvfs');
const dest = path.join(__dirname, '..', 'dist', 'src', 'engine', 'dvfs');

// Cria o destino recursivamente (equivalente a mkdir -p)
fs.mkdirSync(dest, { recursive: true });

// Copia cada arquivo .js
const files = fs.readdirSync(src).filter((f) => f.endsWith('.js'));

if (files.length === 0) {
  console.warn('[copy-dvfs-assets] Nenhum arquivo .js encontrado em', src);
  process.exit(0);
}

for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`[copy-dvfs-assets] Copiado: ${file}`);
}

console.log(`[copy-dvfs-assets] ${files.length} arquivo(s) copiado(s) para ${dest}`);
