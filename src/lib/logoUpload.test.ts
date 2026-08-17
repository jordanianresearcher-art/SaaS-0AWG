import { describe, it, expect } from 'vitest'
import { LOGO_MAX_BYTES, logoObjectPath, validateLogoFile } from './logoUpload'

describe('validateLogoFile', () => {
  it('accepts the formats the bucket allows', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
      expect(validateLogoFile({ type, size: 1000 })).toBeNull()
    }
  })

  it('rejects a format the bucket would refuse, with a message an owner can act on', () => {
    expect(validateLogoFile({ type: 'application/pdf', size: 1000 })).toMatch(/PNG, JPG, WEBP, or SVG/)
    expect(validateLogoFile({ type: 'image/gif', size: 1000 })).toMatch(/PNG, JPG, WEBP, or SVG/)
  })

  it('rejects a file over the bucket size limit', () => {
    expect(validateLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/larger than 2MB/)
    expect(validateLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull()
  })
})

describe('logoObjectPath', () => {
  it('puts the user id first, which is what the bucket RLS policy checks', () => {
    const path = logoObjectPath('user-123', 'image/png')
    expect(path.split('/')[0]).toBe('user-123')
  })

  it('uses the extension matching the mime type', () => {
    expect(logoObjectPath('u', 'image/png')).toMatch(/\.png$/)
    expect(logoObjectPath('u', 'image/jpeg')).toMatch(/\.jpg$/)
    expect(logoObjectPath('u', 'image/webp')).toMatch(/\.webp$/)
    expect(logoObjectPath('u', 'image/svg+xml')).toMatch(/\.svg$/)
  })

  it('falls back to .png for an unexpected mime type rather than producing an extensionless object', () => {
    expect(logoObjectPath('u', 'application/octet-stream')).toMatch(/\.png$/)
  })

  it('gives every upload a distinct name so one logo never clobbers another', () => {
    expect(logoObjectPath('u', 'image/png')).not.toBe(logoObjectPath('u', 'image/png'))
  })
})
