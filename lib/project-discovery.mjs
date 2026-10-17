import path from 'node:path';

export const projectMarkers = new Set(['.git', '.hg', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'CMakeLists.txt', 'Package.swift']);
const excluded = /(?:^|\/)(?:node_modules|vendor|third[_-]party|site-packages|dist-packages|\.git|\.hg|\.svn|\.runtime|\.Trash|\.private-backups|backups?|fixtures?|acceptance-evidence|\.venv(?:[-_][^/]*)?|venv(?:[-_][^/]*)?|__pycache__|\.?caches?|\.npm|\.pnpm-store|\.pytest_tmp|\.pytest_cache|\.tox|\.nox|\.gradle|\.swiftpm|\.build|\.next|\.nuxt|dist|build|target)(?:\/|$)|\.app(?:\/|$)/i;
export const within = (filename, root) => filename === root || filename.startsWith(root + path.sep);
export const projectDirectoryEligible = (directory, home) => within(directory, home) && !excluded.test(path.relative(home, directory)) && !['Library', 'Applications'].includes(path.relative(home, directory).split(path.sep)[0]);

// The disk inventory discovers projects without a second filesystem walk.
export function projectMarker(filename, home, info) {
  if (!within(filename, home) || info.isSymbolicLink()) return null;
  const name = path.basename(filename), directory = path.dirname(filename);
  if (!projectMarkers.has(name) && !/\.(?:xcodeproj|sln)$/.test(name)) return null;
  if (!projectDirectoryEligible(directory, home)) return null;
  if (!info.isFile() && !info.isDirectory()) return null;
  return { path: directory, marker: name };
}
