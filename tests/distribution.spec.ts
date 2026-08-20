import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('distribution documentation', () => {
  it('uses the public OMDSH GitHub source without machine-local paths', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    expect(readme).toContain('dsh plugin --profile web add github:omdsh-dev/dsh-tool-tariff')
    expect(readme).toContain('dsh plugin --profile headless add github:omdsh-dev/dsh-tool-tariff')
    expect(readme).not.toMatch(/[A-Z]:\/Users\//i)
    expect(readme).not.toContain('link:C:/')
  })
})
