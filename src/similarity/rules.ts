// The fixed rules: which files of a repo are never compared, whatever the
// class looks like. They remove what a student did not write, so that two
// repos do not look alike only because both ran `npm install`.
//
// Checked against real student repos: without these rules, every file that
// unrelated repos had in common was a favicon, a lock file or a config stub.

import type { SkipCounts, SkipReason } from './types.ts'

/** Files smaller than this say nothing: a one-line README, an empty stylesheet. */
export const MIN_BYTES = 64

// Folders that hold downloaded packages or build output. Matched on any level,
// because `backend/node_modules` is as common as `node_modules`.
const FOLDERS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'venv', 'virtualenv',
  'site-packages', '__pycache__', '__macosx', 'dist', 'build', 'out', 'target', 'bin',
  'obj', 'coverage', 'pods', 'deriveddata', 'cmake-build-debug', 'cmake-build-release',
])

// Files a tool writes, not a person.
const TOOL_FILES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock',
  'bun.lockb', 'composer.lock', 'gemfile.lock', 'poetry.lock', 'pipfile.lock', 'uv.lock',
  'cargo.lock', 'pubspec.lock', 'podfile.lock', 'packages.lock.json', 'go.sum', 'gradlew',
  'gradlew.bat', 'mvnw', 'mvnw.cmd', 'gradle-wrapper.properties', 'thumbs.db', 'desktop.ini',
  'license', 'license.md', 'license.txt', 'licence', 'licence.md', 'licence.txt',
  'tsconfig.json', 'jsconfig.json', 'next-env.d.ts', 'vite-env.d.ts', 'react-app-env.d.ts',
])
// vite.config.js, eslint.config.mjs, tsconfig.app.json, jquery.min.js, app.js.map
const TOOL_PATTERN = /(\.config\.[cm]?[jt]s|^tsconfig\..+\.json|\.min\.(js|css)|\.(js|css)\.map)$/

// Pictures, sound, video, fonts, compiled code and database files.
const BINARY = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'avif', 'ico', 'icns', 'svg', 'tif', 'tiff',
  'psd', 'ai', 'eps', 'heic', 'heif', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'mov',
  'avi', 'mkv', 'webm', 'm4v', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'class', 'jar', 'war',
  'ear', 'dll', 'exe', 'so', 'dylib', 'o', 'a', 'lib', 'pdb', 'pyc', 'pyo', 'apk', 'aab',
  'ipa', 'dex', 'wasm', 'db', 'sqlite', 'sqlite3',
])

/** True for a folder that is never opened: third-party code, build output, tool settings. */
export function isSkippedFolder(name: string): boolean {
  return name.startsWith('.') || FOLDERS.has(name.toLowerCase())
}

/** Why this file is not compared, or null when it is. */
export function skipReason(path: string, size: number): SkipReason | null {
  const parts = path.split('/')
  const name = (parts[parts.length - 1] ?? '').toLowerCase()
  for (let i = 0; i < parts.length - 1; i++) {
    if (FOLDERS.has(parts[i].toLowerCase())) return 'thirdParty'
  }
  // .gitignore, .env, .github/workflows/ci.yml, .vscode/settings.json
  if (parts.some((part) => part.startsWith('.'))) return 'tool'
  if (TOOL_FILES.has(name) || TOOL_PATTERN.test(name)) return 'tool'
  const dot = name.lastIndexOf('.')
  if (dot > 0 && BINARY.has(name.slice(dot + 1))) return 'binary'
  if (size < MIN_BYTES) return 'tiny'
  return null
}

export const noSkips = (): SkipCounts => ({ thirdParty: 0, tool: 0, binary: 0, tiny: 0 })

export const SKIP_TEXT: Record<SkipReason, string> = {
  thirdParty: 'in third-party or build folders',
  tool: 'tool settings and lock files',
  binary: 'pictures, fonts and compiled files',
  tiny: 'almost empty',
}

/** "6,196 in third-party or build folders, 12 tool settings and lock files" */
export function describeSkips(skipped: SkipCounts): string {
  return (Object.keys(SKIP_TEXT) as SkipReason[])
    .filter((reason) => skipped[reason] > 0)
    .map((reason) => `${skipped[reason].toLocaleString('en')} ${SKIP_TEXT[reason]}`)
    .join(', ')
}
