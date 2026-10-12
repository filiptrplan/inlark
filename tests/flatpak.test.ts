import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('standalone Flatpak release preparation', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'inlark-flatpak-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function prepare(version = '0.3.0') {
    const archive = join(directory, `inlark-${version}-x64.tar.gz`)
    writeFileSync(archive, 'the packaged release')
    const output = join(directory, 'manifest')
    execFileSync(process.execPath, ['scripts/prepare-flatpak.mjs', version, archive, output], {
      env: { ...process.env, RELEASE_DATE: '2026-10-11' },
    })
    return { archive, output }
  }

  it('packages the exact local archive and generates release-specific metadata', () => {
    const { archive, output } = prepare()
    const manifest = JSON.parse(readFileSync(join(output, 'com.inlark.Inlark.json'), 'utf8'))
    const source = manifest.modules[0].sources[0]
    expect(resolve(output, source.path)).toBe(archive)
    expect(source.sha256).toBe(createHash('sha256').update(readFileSync(archive)).digest('hex'))
    expect(source.url).toBeUndefined()
    expect(source['strip-components']).toBe(0)
    const metadata = readFileSync(join(output, 'com.inlark.Inlark.metainfo.xml'), 'utf8')
    expect(metadata).toContain('<release version="0.3.0" date="2026-10-11">')
    expect(metadata).toContain('/v0.3.0/.github/assets/inbox-dark.png')
    expect(metadata).not.toMatch(/@VERSION@|@DATE@/)
    expect(readFileSync(join(output, 'com.inlark.Inlark.png'))).toEqual(
      readFileSync('apps/desktop/resources/icon.png'),
    )
  })

  it.each(['0.3.0-beta.1', '0.3.0+build.1'])('can package release %s', (version) => {
    const { output } = prepare(version)
    expect(readFileSync(join(output, 'com.inlark.Inlark.metainfo.xml'), 'utf8')).toContain(
      `<release version="${version}"`,
    )
  })

  it('rejects mismatched archive versions before producing a manifest', () => {
    const archive = join(directory, 'inlark-0.2.0-x64.tar.gz')
    writeFileSync(archive, 'old release')
    const result = spawnSync(
      process.execPath,
      ['scripts/prepare-flatpak.mjs', '0.3.0', archive, join(directory, 'output')],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Expected archive named inlark-0.3.0-x64.tar.gz')
  })

  it.each(['0.3.0-beta..1', '0.3.0-01', '../0.3.0', '0.3.0"'])(
    'rejects invalid version %s',
    (version) => {
      const result = spawnSync(
        process.execPath,
        ['scripts/prepare-flatpak.mjs', version, 'unused'],
        {
          encoding: 'utf8',
        },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Supply a release version')
    },
  )

  it.each(['2026-02-30', '2026-13-01'])('rejects invalid metadata date %s', (date) => {
    const archive = join(directory, 'inlark-0.3.0-x64.tar.gz')
    writeFileSync(archive, 'release')
    const result = spawnSync(process.execPath, ['scripts/prepare-flatpak.mjs', '0.3.0', archive], {
      env: { ...process.env, RELEASE_DATE: date },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('RELEASE_DATE must be a valid ISO date')
  })
})
