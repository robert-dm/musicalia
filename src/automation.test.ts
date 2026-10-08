import {
  evalAutomation,
  hydrateAutomation,
  movePoint,
  nearestPointIndex,
  normFromValue,
  removePoint,
  serializeAutomation,
  setLanePoints,
  upsertPoint,
  valueFromNorm
} from './automation'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(evalAutomation([], 1) === null, 'empty curve returns null')
assert(evalAutomation([{ t: 2, v: 0.5 }], 0) === 0.5, 'single point is constant')
assert(evalAutomation([{ t: 0, v: 0 }, { t: 2, v: 1 }], 1) === 0.5, 'linear midpoint')
assert(evalAutomation([{ t: 0, v: 0 }, { t: 2, v: 1 }], -1) === 0, 'holds first value before start')
assert(evalAutomation([{ t: 0, v: 0 }, { t: 2, v: 1 }], 9) === 1, 'holds last value after end')
assert(
  Math.abs((evalAutomation([{ t: 0, v: 10 }, { t: 4, v: -2 }], 1) ?? 0) - 7) < 1e-9,
  'linear interpolates non-0-1 values'
)

const merged = upsertPoint([{ t: 0, v: 0 }, { t: 1, v: 1 }], 1.02, 0.4, 0.04)
assert(merged.length === 2 && Math.abs(merged[1].v - 0.4) < 1e-9, 'upsert merges nearby time')
const added = upsertPoint([{ t: 0, v: 0 }], 1, 0.8)
assert(added.length === 2 && added[1].t === 1, 'upsert adds a distinct point')

const moved = movePoint([{ t: 0, v: 0 }, { t: 1, v: 1 }], 0, 2, 0.25)
assert(moved[0].t <= moved[1].t && moved[1].v === 0.25, 'move re-sorts points')
assert(removePoint([{ t: 0, v: 0 }, { t: 1, v: 1 }], 0).length === 1, 'remove drops index')
assert(nearestPointIndex([{ t: 0, v: 0 }, { t: 1, v: 1 }], 1, 1, 40, 40, 10) === 1, 'nearest hits close point')
assert(nearestPointIndex([{ t: 0, v: 0 }], 5, 5, 10, 10, 8) === -1, 'nearest ignores far points')

assert(Math.abs(normFromValue(5, 0, 10) - 0.5) < 1e-9, 'normFromValue maps range')
assert(Math.abs(valueFromNorm(0.25, -1, 1) - -0.5) < 1e-9, 'valueFromNorm maps range')

const raw = [
  { paramId: 'volume', points: [{ t: 1, v: 0.2 }, { time: 0, value: 0.8 }] },
  { id: 'pan', points: [{ t: 'nope', v: 1 }] },
  { paramId: 'eq.low', points: [{ t: 0, v: 3 }] }
]
const hydrated = hydrateAutomation(raw)
assert(hydrated.length === 2, 'hydrate keeps valid lanes')
assert(hydrated[0].points[0].t === 0 && hydrated[0].points[1].v === 0.2, 'hydrate sorts and accepts time/value aliases')
assert(hydrated[1].paramId === 'eq.low', 'hydrate accepts paramId')

const serialized = serializeAutomation(hydrated)
assert(JSON.parse(JSON.stringify(serialized))[0].points.length === 2, 'serialize is JSON-safe')
assert(serializeAutomation(undefined).length === 0, 'serialize empty')

const lanes = setLanePoints([], 'volume', [{ t: 1, v: 0.5 }])
assert(lanes.length === 1 && lanes[0].paramId === 'volume', 'setLanePoints inserts')
assert(setLanePoints(lanes, 'volume', []).length === 0, 'setLanePoints drops empty lane')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ automation unit tests passed')
