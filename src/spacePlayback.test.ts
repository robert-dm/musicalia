import {
  clearMediaSessionHandlers,
  isSpaceKey,
  isTypingTarget,
  modalHasTextField,
  pageHasPlaybackFocus,
  spacePlaybackDecision,
  spaceToggleAction
} from './spacePlayback'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(isSpaceKey({ code: 'Space', key: ' ' }), 'code Space')
assert(isSpaceKey({ key: 'Spacebar' }), 'legacy Spacebar')
assert(!isSpaceKey({ code: 'Enter', key: 'Enter' }), 'Enter is not Space')

assert(spacePlaybackDecision({ code: 'Space', key: ' ' }, { pageHasFocus: true }) === 'toggle', 'plain Space toggles')
assert(spacePlaybackDecision({ code: 'Space', key: ' ', repeat: true }, { pageHasFocus: true }) === 'suppress', 'key repeat is ignored')
assert(spacePlaybackDecision({ code: 'Space', key: ' ', metaKey: true }, { pageHasFocus: true }) === 'ignore', 'Meta+Space is ignored')
assert(spacePlaybackDecision({ code: 'Space', key: ' ', ctrlKey: true }, { pageHasFocus: true }) === 'ignore', 'Ctrl+Space is ignored')
assert(
  spacePlaybackDecision({ code: 'Space', key: ' ' }, { modalHasTextField: true, pageHasFocus: true }) === 'suppress',
  'modal with a text field suppresses Space'
)
assert(
  spacePlaybackDecision({ code: 'Space', key: ' ' }, { pageHasFocus: false }) === 'ignore',
  'Space is ignored when the page is not focused'
)
assert(
  pageHasPlaybackFocus({ hasFocus: () => true, visibilityState: 'visible' }),
  'visible focused document can toggle'
)
assert(
  !pageHasPlaybackFocus({ hasFocus: () => false, visibilityState: 'visible' }),
  'unfocused tab cannot toggle'
)
assert(
  !pageHasPlaybackFocus({ hasFocus: () => true, visibilityState: 'hidden' }),
  'hidden tab cannot toggle'
)
assert(!pageHasPlaybackFocus(null), 'missing document cannot toggle')

const sessionCalls: Array<[string, null]> = []
clearMediaSessionHandlers({
  setActionHandler(action: string, handler: null) {
    sessionCalls.push([action, handler])
  }
})
assert(sessionCalls.some(([action, handler]) => action === 'play' && handler === null), 'clears Media Session play')
assert(sessionCalls.some(([action, handler]) => action === 'pause' && handler === null), 'clears Media Session pause')
assert(sessionCalls.every(([, handler]) => handler === null), 'never registers a Media Session handler')

assert(spaceToggleAction(true, true) === 'stop-record', 'Space stops recording first')
assert(spaceToggleAction(false, true) === 'pause', 'Space pauses when transport is running')
assert(spaceToggleAction(false, false) === 'play', 'Space plays when idle')

const input = { tagName: 'INPUT' } as unknown as EventTarget
const area = { tagName: 'TEXTAREA' } as unknown as EventTarget
const select = { tagName: 'SELECT' } as unknown as EventTarget
const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget
const button = { tagName: 'BUTTON' } as unknown as EventTarget
assert(isTypingTarget(input), 'input is a typing target')
assert(isTypingTarget(area), 'textarea is a typing target')
assert(isTypingTarget(select), 'select is a typing target')
assert(isTypingTarget(editable), 'contenteditable is a typing target')
assert(!isTypingTarget(button), 'button is not a typing target')
assert(
  spacePlaybackDecision({ code: 'Space', key: ' ', target: input }, { pageHasFocus: true }) === 'ignore',
  'Space in an input is ignored'
)

function fakeRoot(modals: Array<{ hasText: boolean }>): ParentNode {
  return {
    querySelectorAll: () =>
      modals.map((m) => ({
        querySelector: () => (m.hasText ? {} : null)
      }))
  } as unknown as ParentNode
}
assert(modalHasTextField(fakeRoot([{ hasText: true }])), 'auth-style modal has a text field')
assert(!modalHasTextField(fakeRoot([{ hasText: false }])), 'help modal without fields does not block')
assert(!modalHasTextField(fakeRoot([])), 'no modal does not block')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ space playback unit tests passed')
