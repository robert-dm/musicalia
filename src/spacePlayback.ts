export const SPACE_TYPING_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

export const SPACE_MODAL_SELECTOR = '.drive-projects-modal, .modal-overlay, .confirm-modal'

export const SPACE_MODAL_TEXT_SELECTOR =
  'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""]'

export function isSpaceKey(e: { code?: string; key?: string }): boolean {
  return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar'
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as HTMLElement
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function') {
    try {
      return Boolean(el.closest(SPACE_TYPING_SELECTOR))
    } catch {
      return false
    }
  }
  return false
}

export function modalHasTextField(root: ParentNode = document): boolean {
  const modals = root.querySelectorAll(SPACE_MODAL_SELECTOR)
  for (const modal of modals) {
    if (modal.querySelector(SPACE_MODAL_TEXT_SELECTOR)) return true
  }
  return false
}

export type SpacePlaybackDecision = 'toggle' | 'suppress' | 'ignore'

export function spacePlaybackDecision(
  e: { code?: string; key?: string; repeat?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null },
  options?: { modalHasTextField?: boolean }
): SpacePlaybackDecision {
  if (!isSpaceKey(e)) return 'ignore'
  if (e.metaKey || e.ctrlKey || e.altKey) return 'ignore'
  if (isTypingTarget(e.target ?? null)) return 'ignore'
  if (e.repeat) return 'suppress'
  if (options?.modalHasTextField) return 'suppress'
  return 'toggle'
}

export function spaceToggleAction(isRecording: boolean, transportStarted: boolean): 'stop-record' | 'pause' | 'play' {
  if (isRecording) return 'stop-record'
  if (transportStarted) return 'pause'
  return 'play'
}
