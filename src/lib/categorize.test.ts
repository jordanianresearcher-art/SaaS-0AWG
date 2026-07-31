import { describe, expect, it } from 'vitest'
import { guessCategoryFromName } from './categorize'

describe('guessCategoryFromName', () => {
  it('recognizes common car-audio product names', () => {
    expect(guessCategoryFromName('12" Subwoofer')).toBe('subwoofer')
    expect(guessCategoryFromName('Ported 12-inch Sub Box')).toBe('enclosure')
    expect(guessCategoryFromName('500W Monoblock Amplifier')).toBe('mono_amp')
    expect(guessCategoryFromName('4-Channel Amplifier')).toBe('multi_amp')
    expect(guessCategoryFromName('4-Gauge Amp Wiring Kit')).toBe('wiring_kit')
    expect(guessCategoryFromName('2-Channel Line Output Converter')).toBe('integration')
    expect(guessCategoryFromName('In-Dash Bass Knob')).toBe('bass_control')
    expect(guessCategoryFromName('AGM Battery')).toBe('battery')
    expect(guessCategoryFromName('Big 3 Upgrade Kit')).toBe('big_three')
    expect(guessCategoryFromName('Epicenter Bass Restoration Processor')).toBe('epicenter')
    expect(guessCategoryFromName('Steering Wheel Control Integration Module')).toBe('integration_module')
    expect(guessCategoryFromName('Sound Deadening Mat')).toBe('sound_treatment')
    expect(guessCategoryFromName('OFC Wiring, 10ft')).toBe('ofc_wiring')
    expect(guessCategoryFromName('1-Inch Tweeter Set')).toBe('tweeter')
    expect(guessCategoryFromName('6x9 Coaxial Door Speakers')).toBe('door_speaker')
    expect(guessCategoryFromName('CarPlay Receiver')).toBe('radio')
    expect(guessCategoryFromName('8-Channel DSP Processor')).toBe('dsp')
    expect(guessCategoryFromName('Backup Camera')).toBe('camera')
    expect(guessCategoryFromName('Fiberglass Fabrication Kit')).toBe('fabrication')
  })

  it('falls back to searching the description when the name alone is ambiguous', () => {
    expect(guessCategoryFromName('NA-8SLM V.2', 'A powerful 8-inch subwoofer for tight spaces')).toBe('subwoofer')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(guessCategoryFromName('Nemesis Audio Gift Card')).toBeNull()
    expect(guessCategoryFromName('')).toBeNull()
  })

  it('never fires on a name/description that only faintly resembles a pattern', () => {
    // "Sound" alone shouldn't trip sound_treatment; needs "deaden"/"dampen"/"treatment".
    expect(guessCategoryFromName('Sound System Bundle')).toBeNull()
  })
})
