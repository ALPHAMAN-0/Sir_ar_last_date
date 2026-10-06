import { describe, expect, it } from 'vitest'
import { describeSkips, isSkippedFolder, MIN_BYTES, noSkips, skipReason } from './rules.ts'

const BIG = 5_000

describe('skipReason', () => {
  it('keeps the files a student writes', () => {
    for (const path of [
      'index.html',
      'src/App.jsx',
      'src/components/TodoList.jsx',
      'app/Http/Controllers/StudentController.php',
      'lib/main.dart',
      'Main.java',
      'report.pdf',
      'docs/Project Report.docx',
      'analysis.ipynb',
      'project.zip',
      'package.json',
      'README.md',
      'config.js',
      'maps/level1.map',
    ]) {
      expect(skipReason(path, BIG), path).toBeNull()
    }
  })

  it('leaves out downloaded packages and build output on any level', () => {
    for (const path of [
      'node_modules/react/index.js',
      'backend/node_modules/express/lib/express.js',
      'frontend/dist/assets/index-abc.js',
      'vendor/autoload.php',
      'venv/Lib/site-packages/flask/app.py',
      'app/build/outputs/apk/debug/output.json',
      'target/classes/application.properties',
      'Project/bin/Debug/net8.0/app.deps.json',
      'ios/Pods/Manifest.lock',
      '__pycache__/main.cpython-312.txt',
    ]) {
      expect(skipReason(path, BIG), path).toBe('thirdParty')
    }
  })

  it('does not mistake a file for a folder of the same name', () => {
    expect(skipReason('build', BIG)).toBeNull()
    expect(skipReason('scripts/vendor', BIG)).toBeNull()
    expect(skipReason('app/build.gradle', BIG)).toBeNull()
  })

  it('leaves out what a tool writes: dot paths, lock files, configs, minified code', () => {
    for (const path of [
      '.gitignore',
      '.env',
      '.github/workflows/ci.yml',
      '.vscode/settings.json',
      'frontend/.eslintrc.json',
      '.claude/skills/x/SKILL.md',
      'package-lock.json',
      'frontend/yarn.lock',
      'composer.lock',
      'gradlew',
      'LICENSE',
      'vite.config.js',
      'eslint.config.mjs',
      'tailwind.config.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'public/js/jquery.min.js',
      'css/bootstrap.min.css',
      'static/app.js.map',
    ]) {
      expect(skipReason(path, BIG), path).toBe('tool')
    }
  })

  it('leaves out pictures, fonts and compiled files, whatever the letter case', () => {
    for (const path of [
      'public/favicon.svg',
      'src/assets/hero.png',
      'images/Photo.JPG',
      'fonts/Inter.woff2',
      'out.exe',
      'lib/mysql-connector.jar',
      'Main.class',
      'data/app.sqlite3',
    ]) {
      expect(skipReason(path, BIG), path).toBe('binary')
    }
  })

  it('leaves out files too small to mean anything', () => {
    expect(skipReason('src/index.css', 22)).toBe('tiny')
    expect(skipReason('requirements.txt', MIN_BYTES - 1)).toBe('tiny')
    expect(skipReason('requirements.txt', MIN_BYTES)).toBeNull()
    expect(skipReason('empty.py', 0)).toBe('tiny')
  })

  it('names the folder rule first, so a picture inside node_modules counts once', () => {
    expect(skipReason('node_modules/pkg/logo.png', 3)).toBe('thirdParty')
    expect(skipReason('.git/logo.png', 3)).toBe('tool')
  })
})

describe('isSkippedFolder', () => {
  it('skips third-party, build and dot folders but not source folders', () => {
    for (const name of ['node_modules', 'Node_Modules', 'vendor', 'dist', '.git', '.idea', 'Pods']) {
      expect(isSkippedFolder(name), name).toBe(true)
    }
    for (const name of ['src', 'lib', 'app', 'public', 'android', 'frontend', 'env']) {
      expect(isSkippedFolder(name), name).toBe(false)
    }
  })
})

describe('describeSkips', () => {
  it('lists only the rules that left something out', () => {
    expect(describeSkips(noSkips())).toBe('')
    expect(describeSkips({ thirdParty: 6196, tool: 12, binary: 0, tiny: 1 })).toBe(
      '6,196 in third-party or build folders, 12 tool settings and lock files, 1 almost empty',
    )
  })
})
