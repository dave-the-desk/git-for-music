import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const srcRootUrl = new URL('../apps/web/src/', import.meta.url);
const srcRootPath = fileURLToPath(srcRootUrl);

function resolveAliasTarget(specifier) {
  const relativePath = specifier.slice(2);
  const absoluteBase = path.join(srcRootPath, relativePath);
  const candidates = [
    absoluteBase,
    `${absoluteBase}.ts`,
    `${absoluteBase}.tsx`,
    `${absoluteBase}.js`,
    `${absoluteBase}.jsx`,
    `${absoluteBase}.mjs`,
    `${absoluteBase}.cjs`,
    path.join(absoluteBase, 'index.ts'),
    path.join(absoluteBase, 'index.tsx'),
    path.join(absoluteBase, 'index.js'),
    path.join(absoluteBase, 'index.jsx'),
    path.join(absoluteBase, 'index.mjs'),
    path.join(absoluteBase, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stats = statSync(candidate);
    if (stats.isFile()) {
      return pathToFileURL(candidate).href;
    }
  }

  return null;
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveAliasTarget(specifier);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
