import {
  AUTOMATION_PARAMS,
  defaultTrackFx,
  effectiveCompressor,
  effectiveDelayMix,
  effectiveEq,
  effectiveFilter,
  effectiveReverbMix,
  getTrackParam,
  hydrateTrackAudio,
  hydrateTrackFx,
  resolvedParamValue,
  serializeTrackAudio,
  serializeTrackFx,
  setTrackParam,
  shiftOpenIndices
} from './trackFx'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const fx = defaultTrackFx()
assert(fx.eq.bypass === false && fx.eq.low === 0, 'EQ starts flat and active')
assert(fx.compressor.bypass && fx.delay.bypass && fx.reverb.bypass && fx.filter.bypass, 'other FX start bypassed')

const old = hydrateTrackFx(undefined)
assert(old.eq.high === 0 && old.filter.type === 'lowpass', 'missing fx hydrates to defaults')
const partial = hydrateTrackFx({ eq: { low: 4, bypass: true }, filter: { type: 'highpass', cutoff: 400 } })
assert(partial.eq.low === 4 && partial.eq.bypass && partial.filter.type === 'highpass', 'partial fx hydrates')
assert(partial.filter.cutoff === 400 && partial.compressor.ratio === 4, 'unspecified modules keep defaults')

const roundTrip = serializeTrackFx(partial)
assert(roundTrip.eq.low === 4 && roundTrip.filter.type === 'highpass', 'serialize clamps via hydrate')

const track = { volume: 0.8, pan: 0.25, fx: defaultTrackFx(), automation: [] as { paramId: string; points: { t: number; v: number }[] }[] }
assert(getTrackParam(track, 'volume') === 0.8, 'get volume')
assert(getTrackParam(track, 'pan') === 0.25, 'get pan')
assert(getTrackParam(setTrackParam(track, 'eq.low', 6), 'eq.low') === 6, 'set/get eq.low')
assert(getTrackParam(setTrackParam(track, 'delay.mix', 2), 'delay.mix') === 1, 'clamps to param max')
assert(AUTOMATION_PARAMS.some((p) => p.id === 'reverb.size'), 'reverb.size is automatable')
assert(!AUTOMATION_PARAMS.some((p) => p.id.includes('bypass')), 'bypass is not automatable')

const automated = {
  ...track,
  automation: [{ paramId: 'volume', points: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }]
}
assert(resolvedParamValue(automated, 'volume', 1) === 0.5, 'automation overrides static at time')
assert(resolvedParamValue(automated, 'pan', 1) === 0.25, 'missing lane uses static')
assert(resolvedParamValue(track, 'volume', 1) === 0.8, 'no points uses static')

assert(effectiveEq({ bypass: true, low: 6, mid: 3, high: -3 }).low === 0, 'bypassed EQ is flat')
assert(effectiveCompressor({ ...fx.compressor, bypass: true }).ratio === 1, 'bypassed compressor is 1:1')
assert(effectiveFilter({ ...fx.filter, type: 'lowpass', bypass: true }).cutoff === 20000, 'bypassed LP is open')
assert(effectiveFilter({ ...fx.filter, type: 'highpass', bypass: true }).cutoff === 20, 'bypassed HP is open')
assert(effectiveDelayMix({ ...fx.delay, bypass: true, mix: 0.9 }) === 0, 'bypassed delay wet 0')
assert(effectiveReverbMix({ ...fx.reverb, bypass: false, mix: 0.4 }) === 0.4, 'active reverb keeps mix')

const saved = serializeTrackAudio({
  pan: 0.5,
  fx: setTrackParam(track, 'reverb.mix', 0.4).fx,
  automation: [{ paramId: 'eq.mid', points: [{ t: 1, v: 2 }] }]
})
const json = JSON.parse(JSON.stringify(saved))
const loaded = hydrateTrackAudio(json)
assert(loaded.pan === 0.5, 'pan roundtrips')
assert(loaded.fx.reverb.mix === 0.4, 'fx roundtrips through JSON')
assert(loaded.automation[0].paramId === 'eq.mid' && loaded.automation[0].points[0].v === 2, 'automation roundtrips')

const fromLegacy = hydrateTrackAudio({ mute: true, volume: 0.4 })
assert(fromLegacy.pan === 0 && fromLegacy.fx.eq.low === 0 && fromLegacy.automation.length === 0, 'legacy tracks hydrate audio fields')

assert(shiftOpenIndices([0, 2, 4], 2).join(',') === '0,3', 'open indices shift after delete')
assert(shiftOpenIndices([1], 1).length === 0, 'deleted index is removed')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ track fx unit tests passed')
