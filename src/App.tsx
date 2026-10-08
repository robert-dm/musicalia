import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { flushSync } from 'react-dom'
import * as Tone from 'tone'
import JSZip from 'jszip'
import './App.css'
import './AudioDiagnostics.css'
import { StemSplitDialog, StemSplitProgress } from './StemSplitDialog'
import { separateStems, isStemSeparationSupported } from './stemSeparator'
import { autosaveProject, loadProject, clearProject, saveAudioBuffer, loadAudioBuffer } from './projectManager'
import {
  register,
  login,
  verifyAuth,
  clearAuth,
  type User
} from './cloudStorage'
import { detectBPM } from './bpmDetector'
import { encodeAudioBufferWAV } from './wav'
import { TrackHeader } from './TrackHeader'
import { TrackLane } from './TrackLane'
import { FxRack } from './FxRack'
import { AutomationLaneView } from './AutomationLaneView'
import { applyTrackFxChain, createTrackFxChain, disposeTrackFxChain, type TrackFxChain } from './trackFxChain'
import {
  applyClipPlayback,
  clampPitchSemitones,
  clampTempoRate,
  createClipPlayer,
  effectiveBpm,
  songTimeFromWall,
  wallDelayForSong
} from './clipPlayer'
import { resolvePracticeTrack, toggleAislar, togglePractice } from './practiceMode'
import { analyzeHarmony, hydrateHarmony, serializeHarmony, type HarmonyResult } from './harmony'
import { laneForParam, setLanePoints, type AutomationLane } from './automation'
import {
  AUTOMATION_PARAMS,
  AUTO_LANE_HEIGHT,
  DEFAULT_PAN,
  FX_RACK_HEIGHT,
  defaultTrackFx,
  getTrackParam,
  hydrateTrackAudio,
  hydrateTrackFx,
  paramMeta,
  serializeTrackAudio,
  setTrackParam,
  shiftOpenIndices,
  type FilterType,
  type TrackFxState
} from './trackFx'
import { clipBufferSignature } from './trackRenderMemo'
import {
  applyClipTrim,
  applyTrimPreviewStyles,
  deltaTimeFromLanePx,
  trimStatesEqual,
  type ClipTrimEdge,
  type ClipTrimState
} from './clipTrim'
import {
  DEFAULT_TRACK_VOLUME,
  appendEmptyTrack,
  createEmptyTrack,
  initialEmptyTracks,
  nextPistaName
} from './trackList'
import {
  applySeekSnap,
  clickTimeFromX,
  isClickGesture,
  persistSnapEnabled,
  readStoredSnapEnabled,
  snapActiveDuringDrag
} from './playheadSeek'
import {
  dataTransferHasFiles,
  dropTimeOnLane,
  ignoredAudioToast,
  partitionDroppedFiles,
  resolveDropPlacement,
  trackIndexFromPoint
} from './audioImport'
import {
  armedIndexAfterDelete,
  compensatedRecordOffset,
  drawRecordingPeaks,
  listAudioInputDevices,
  micErrorMessage,
  nativeAudioContext,
  nextGrabacionName,
  pcmChunksToAudioBuffer,
  persistMicDeviceId,
  readStoredMicDeviceId,
  recordLatencySeconds,
  requestMicStream,
  resolveRecordTrack,
  startPcmCapture,
  type PcmCapture
} from './audioRecord'
import {
  clearMediaSessionHandlers,
  isSpaceKey,
  modalHasTextField,
  pageHasPlaybackFocus,
  spacePlaybackDecision,
  spaceToggleAction
} from './spacePlayback'
import {
  ContextMenuItem,
  IconCircleHelp,
  IconClipboardPaste,
  IconCopy,
  IconCopyPlus,
  IconDownload,
  IconFilePlus,
  IconFolderOpen,
  IconLogIn,
  IconLogOut,
  IconMagnet,
  IconMetronome,
  IconMoveHorizontal,
  IconMoveVertical,
  IconPause,
  IconPencil,
  IconPlay,
  IconPlus,
  IconRecord,
  IconRepeat,
  IconSave,
  IconScissors,
  IconSkipBack,
  IconSliders,
  IconSpline,
  IconSplit,
  IconStop,
  IconTrash,
  IconVolume2
} from './uiIcons'
import {
  clampGroupTimeDelta,
  clampGroupTrackDelta,
  clientRectsIntersect,
  commitEditedTrackName,
  deleteTrackFromList,
  marqueeClientRect,
  mergeSelection,
  packClipboard,
  pastePlacement,
  resolveTrackName
} from './clipSelection'

const APP_VERSION = '0.00XXb'

interface ClipboardClip {
  buffer: AudioBuffer
  fileName: string
  sourceStart: number
  duration: number
  relTime: number
  relTrack: number
}

interface ContextMenuState {
  x: number
  y: number
  trackIndex: number
  clipId: string | null
  time: number
  kind?: 'header' | 'timeline' | 'empty'
}

interface Clip {
  player: Tone.GrainPlayer
  fileName: string
  isPlaying: boolean
  buffer: AudioBuffer
  startPosition: number
  offsetSeconds: number
  id: string
  sourceStart: number
  duration: number
  selected?: boolean
}

interface TrackState {
  mute: boolean
  solo: boolean
  volume: number
  pan: number
  fx: TrackFxState
  automation: AutomationLane[]
  clips: Clip[]
  name?: string
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTrackIndex, setRecordingTrackIndex] = useState<number | null>(null)
  const [recordArmedIndex, setRecordArmedIndex] = useState<number | null>(null)
  const [recordLayoutTick, setRecordLayoutTick] = useState(0)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [micDeviceId, setMicDeviceId] = useState<string | null>(() => readStoredMicDeviceId())
  const [bpm, setBpm] = useState(120)
  const [pitchSemitones, setPitchSemitones] = useState(0)
  const [tempoRate, setTempoRate] = useState(1)
  const [practiceIndex, setPracticeIndex] = useState<number | null>(null)
  const [harmony, setHarmony] = useState<HarmonyResult | null>(null)
  const [harmonySource, setHarmonySource] = useState<'mix' | number>('mix')
  const [harmonyBusy, setHarmonyBusy] = useState(false)
  const pitchRef = useRef(0)
  const tempoRateRef = useRef(1)
  const practiceIndexRef = useRef<number | null>(null)
  const playOriginSongRef = useRef(0)
  const playOriginWallRef = useRef(0)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [isLoopEnabled, setIsLoopEnabled] = useState(false)
  const [countInBars, _setCountInBars] = useState(2)
  const [isDraggingLoop, setIsDraggingLoop] = useState(false)
  const [isDraggingLoopEdge, setIsDraggingLoopEdge] = useState<'start' | 'end' | null>(null)
  const [loopDragStart, setLoopDragStart] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null)
  const [fileDragActive, setFileDragActive] = useState(false)
  const trackGainsRef = useRef<Tone.Gain[]>([])
  const trackChainsRef = useRef<TrackFxChain[]>([])
  const isPlayingRef = useRef(false)
  const [fxOpenTracks, setFxOpenTracks] = useState<number[]>([])
  const [autoOpenTracks, setAutoOpenTracks] = useState<number[]>([])
  const [autoParamByTrack, setAutoParamByTrack] = useState<Record<number, string>>({})
  const [selectedAutoPoint, setSelectedAutoPoint] = useState<{ trackIndex: number; paramId: string; index: number } | null>(null)
  const audioInitializedRef = useRef(false)
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [isResizing, setIsResizing] = useState(false)
  const [playheadPosition, setPlayheadPosition] = useState(0)
  const playheadPositionRef = useRef(0)
  const playheadElRef = useRef<HTMLDivElement>(null)
  const timeDisplayRef = useRef<HTMLSpanElement>(null)
  const meterDisplayRef = useRef<HTMLSpanElement>(null)
  const timelineMaxRef = useRef(100)
  const playheadAnimationRef = useRef<number | null>(null)
  const dragLiveRef = useRef({
    tempOffset: 0,
    tempTrack: null as number | null,
    threshold: false,
    distance: 0,
    timeDelta: 0,
    trackDelta: 0,
    minOffset: 0,
    minTrack: 0,
    maxTrack: 0
  })
  const seekToPositionRef = useRef<(seconds: number, shiftKey?: boolean) => void>(() => {})
  const loopGestureRef = useRef({ x: 0, y: 0, distance: 0 })
  const marqueeLiveRef = useRef({
    active: false,
    didDrag: false,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    additive: false,
    toggle: false
  })
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [tempLoopStart, setTempLoopStart] = useState<number | null>(null)
  const [tempLoopEnd, setTempLoopEnd] = useState<number | null>(null)
  const [horizontalZoom, setHorizontalZoom] = useState(1)
  const [verticalZoom, setVerticalZoom] = useState(1)
  const lanesColumnRef = useRef<HTMLDivElement>(null)
  const [showStemDialog, setShowStemDialog] = useState(false)
  const [stemProgress, setStemProgress] = useState<number>(0)
  const [isProcessingStems, setIsProcessingStems] = useState(false)
  const stemAbortControllerRef = useRef<AbortController | null>(null)
  const pendingFileRef = useRef<File | null>(null)
  const pendingOffsetRef = useRef(0)
  const importQueueRef = useRef<Array<{ file: File; trackIndex: number; createNew: boolean; offsetSeconds: number }>>([])
  const importUndoSavedRef = useRef(false)
  const fileDragDepthRef = useRef(0)
  const highlightedDropTrackRef = useRef<number | null>(null)
  const recordLiveRef = useRef<{
    trackIndex: number
    startOffset: number
    capture: PcmCapture
    stream: MediaStream
    el: HTMLElement | null
    canvas: HTMLCanvasElement | null
    startedPlayback: boolean
  } | null>(null)
  const recordElapsedRef = useRef<HTMLSpanElement>(null)
  const isRecordingRef = useRef(false)
  const lastRecordLayoutRef = useRef(0)
  const stopRecordingRef = useRef<(opts?: { then?: 'stop' | 'pause' | 'keep'; commit?: boolean }) => Promise<void>>(async () => {})
  const handlePlayRef = useRef<() => void | Promise<void>>(async () => {})
  const handlePauseRef = useRef<() => void>(() => {})
  const metronomePlayerRef = useRef<Tone.Player | null>(null)
  const [trackStates, setTrackStates] = useState<TrackState[]>(() =>
    initialEmptyTracks().map((track) => ({ ...track, clips: [] as Clip[] }))
  )
  const meterRef = useRef<Tone.Meter | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [currentProjectName, setCurrentProjectName] = useState('Proyecto sin título')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string>('')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportTracks, setExportTracks] = useState<boolean[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [exportMixed, setExportMixed] = useState(false)
  const [exportIncludeCountIn, setExportIncludeCountIn] = useState(false)
  const isDraggingClipRef = useRef(false)
  const [clipboard, setClipboard] = useState<ClipboardClip[] | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const projectLoadGenRef = useRef<number>(0)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [snapEnabled, setSnapEnabled] = useState(() => readStoredSnapEnabled())
  const [undoStack, setUndoStack] = useState<any[]>([])
  const [redoStack, setRedoStack] = useState<any[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [currentFileHandle, setCurrentFileHandle] = useState<any>(null)
  const [trackDeleteConfirm, setTrackDeleteConfirm] = useState<{
    trackIndex: number
    name: string
    clipCount: number
  } | null>(null)
  const [renamingTrack, setRenamingTrack] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renamingTrackRef = useRef<number | null>(null)
  const trackStatesRef = useRef(trackStates)
  trackStatesRef.current = trackStates
  practiceIndexRef.current = practiceIndex
  const selectedClipIdsRef = useRef(selectedClipIds)
  selectedClipIdsRef.current = selectedClipIds
  const appCommitCountRef = useRef(0)
  appCommitCountRef.current += 1
  const trimLiveRef = useRef<{
    active: boolean
    trackIndex: number
    clipId: string
    edge: ClipTrimEdge
    startX: number
    orig: ClipTrimState & { bufferDuration: number }
    next: ClipTrimState
    wrapper: HTMLElement | null
    waveform: HTMLElement | null
  } | null>(null)
  const lastClipBufferSigRef = useRef<string | null>(null)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const lanesScrollRef = useRef<HTMLDivElement>(null)
  const syncingVerticalScroll = useRef(false)
  
  const getCountInSeconds = () => {
    const secondsPerBeat = 60 / bpm
    const beatsPerBar = 4
    return countInBars * beatsPerBar * secondsPerBeat
  }

  const snapToGrid = (timeSeconds: number): number => {
    const secondsPerBeat = 60 / bpm
    const snapInterval = secondsPerBeat / 4
    return Math.round(timeSeconds / snapInterval) * snapInterval
  }

  const saveUndo = () => {
    const state = {
      trackStates: trackStates.map(t => ({
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        name: t.name,
        ...serializeTrackAudio(t),
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected,
          buffer: c.buffer,
          playerBuffer: c.player.buffer
        }))
      })),
      playheadPosition,
      loopStart,
      loopEnd
    }
    setUndoStack(prev => [...prev.slice(-49), state])
    setRedoStack([])
  }

  const handleUndo = () => {
    if (isRecordingRef.current) {
      void stopRecordingRef.current({ then: 'keep', commit: false })
    }
    if (undoStack.length === 0) return
    const currentState = {
      trackStates: JSON.parse(JSON.stringify(trackStates.map(t => ({
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        name: t.name,
        ...serializeTrackAudio(t),
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected
        }))
      })))),
      playheadPosition,
      loopStart,
      loopEnd
    }
    const prevState = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev, currentState])
    restoreState(prevState)
  }

  const handleRedo = () => {
    if (isRecordingRef.current) {
      void stopRecordingRef.current({ then: 'keep', commit: false })
    }
    if (redoStack.length === 0) return
    const currentState = {
      trackStates: JSON.parse(JSON.stringify(trackStates.map(t => ({
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        name: t.name,
        ...serializeTrackAudio(t),
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected
        }))
      })))),
      playheadPosition,
      loopStart,
      loopEnd
    }
    const nextState = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    setUndoStack(prev => [...prev, currentState])
    restoreState(nextState)
  }

  const restoreState = async (state: any) => {
    const currentClipMap = new Map<string, Clip>()
    trackStates.forEach(t => {
      t.clips.forEach(c => currentClipMap.set(c.id, c))
    })
    
    for (let extra = state.trackStates.length; extra < trackStates.length; extra++) {
      trackStates[extra].clips.forEach(c => {
        try { c.player.dispose() } catch { /* already disposed */ }
      })
    }

    const newTrackStates = await Promise.all(state.trackStates.map(async (t: any, trackIdx: number) => {
      const clips = await Promise.all(t.clips.map(async (clipData: any) => {
        const existingClip = currentClipMap.get(clipData.id)
        if (existingClip) {
          return {
            ...existingClip,
            offsetSeconds: clipData.offsetSeconds,
            sourceStart: clipData.sourceStart,
            duration: clipData.duration,
            selected: clipData.selected
          }
        } else {
          const player = makeClipPlayer()
          player.buffer = new Tone.ToneAudioBuffer(clipData.buffer)
          player.loop = false
          if (trackGainsRef.current[trackIdx]) {
            player.connect(trackGainsRef.current[trackIdx])
          }
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer: clipData.buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds,
            id: clipData.id,
            sourceStart: clipData.sourceStart,
            duration: clipData.duration,
            selected: clipData.selected
          }
        }
      }))
      
      const restoredClipIds = new Set(clips.map(c => c.id))
      trackStates[trackIdx]?.clips.forEach(c => {
        if (!restoredClipIds.has(c.id)) {
          c.player.dispose()
        }
      })
      
      return {
        mute: !!t.mute,
        solo: !!t.solo,
        volume: typeof t.volume === 'number' ? t.volume : DEFAULT_TRACK_VOLUME,
        name: t.name,
        ...hydrateTrackAudio(t),
        clips: clips.filter(c => c !== null)
      }
    }))
    reconnectAllClips(newTrackStates as TrackState[])
    setTrackStates(newTrackStates as any)
    commitPlayhead(state.playheadPosition)
    setLoopStart(state.loopStart)
    setLoopEnd(state.loopEnd)
  }

  const ensureTrackGains = (count: number) => {
    while (trackChainsRef.current.length < count) {
      const chain = createTrackFxChain(DEFAULT_TRACK_VOLUME)
      trackChainsRef.current.push(chain)
      trackGainsRef.current.push(chain.gain)
    }
  }

  const reconnectAllClips = (tracks: TrackState[]) => {
    ensureTrackGains(tracks.length)
    tracks.forEach((track, i) => {
      const gain = trackGainsRef.current[i]
      if (!gain) return
      track.clips.forEach(clip => {
        try { clip.player.disconnect() } catch { /* already disconnected */ }
        clip.player.connect(gain)
      })
    })
    while (trackChainsRef.current.length > tracks.length) {
      const chain = trackChainsRef.current.pop()
      trackGainsRef.current.pop()
      disposeTrackFxChain(chain)
    }
  }

  const applyAllTrackAudio = (time?: number) => {
    const tracks = trackStatesRef.current
    const t = Number.isFinite(time) ? (time as number) : getSongTime()
    const anySolo = tracks.some(tr => tr.solo)
    const ramp = isPlayingRef.current ? 0.05 : 0.02
    tracks.forEach((track, i) => {
      const chain = trackChainsRef.current[i]
      if (chain) applyTrackFxChain(chain, track, t, anySolo, ramp)
    })
  }

  const getSongTime = () => {
    if (!isPlayingRef.current) return playheadPositionRef.current
    return songTimeFromWall(
      playOriginSongRef.current,
      playOriginWallRef.current,
      Tone.now(),
      tempoRateRef.current
    )
  }

  const applyAllClipPlayback = (tracks = trackStatesRef.current) => {
    const rate = tempoRateRef.current
    const pitch = pitchRef.current
    tracks.forEach((track) => {
      track.clips.forEach((clip) => applyClipPlayback(clip.player, rate, pitch))
    })
  }

  const makeClipPlayer = (buffer?: AudioBuffer | Tone.ToneAudioBuffer) => {
    const player = createClipPlayer(buffer)
    applyClipPlayback(player, tempoRateRef.current, pitchRef.current)
    return player
  }

  const startClipAtSongTime = (clip: Clip, songTime: number): boolean => {
    applyClipPlayback(clip.player, tempoRateRef.current, pitchRef.current)
    const clipStart = clip.offsetSeconds
    const clipEnd = clip.offsetSeconds + clip.duration
    if (songTime >= clipEnd) return false
    let when = Tone.now()
    let offset = clip.sourceStart
    if (songTime < clipStart) {
      when = Tone.now() + wallDelayForSong(clipStart - songTime, tempoRateRef.current)
      offset = clip.sourceStart
    } else {
      offset = clip.sourceStart + (songTime - clipStart)
    }
    const remaining = clip.duration - (offset - clip.sourceStart)
    if (offset < clip.buffer.duration && remaining > 0.02) {
      clip.player.loop = false
      // GrainPlayer duration is wall-clock; convert remaining song seconds through tempoRate.
      clip.player.start(when, offset, wallDelayForSong(remaining, tempoRateRef.current))
      return true
    }
    return false
  }

  const retargetPlayingClips = (songTime: number) => {
    trackStatesRef.current.forEach((track) => {
      track.clips.forEach((clip) => {
        try { clip.player.stop() } catch { /* already stopped */ }
        clip.isPlaying = startClipAtSongTime(clip, songTime)
      })
    })
  }

  const applyTrackAudioNow = (trackIndex: number, patch?: Partial<TrackState>) => {
    const tracks = trackStatesRef.current
    const track = tracks[trackIndex]
    const chain = trackChainsRef.current[trackIndex]
    if (!track || !chain) return
    const anySolo = tracks.some(tr => tr.solo)
      applyTrackFxChain(
      chain,
      { ...track, ...patch },
      getSongTime(),
      anySolo,
      isPlayingRef.current ? 0.05 : 0.02
    )
  }

  const writeTrackAutomation = (trackIndex: number, paramId: string, points: AutomationLane['points'], commit: boolean) => {
    const apply = (tracks: TrackState[]) => {
      if (!tracks[trackIndex]) return tracks
      const next = tracks.map((track, i) => (
        i === trackIndex
          ? { ...track, automation: setLanePoints(track.automation ?? [], paramId, points) }
          : track
      ))
      trackStatesRef.current = next
      applyAllTrackAudio()
      return next
    }
    if (!commit) {
      apply(trackStatesRef.current)
      return
    }
    setTrackStates(prev => apply(prev))
  }

  // Verify authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const user = await verifyAuth()
      if (user) {
        setCurrentUser(user)
      }
    }
    checkAuth()
  }, [])
  
  // Autosave on state changes (excluding playheadPosition to avoid copying audio on every tick).
  // Debounced so per-track sliders can commit without encoding WAV buffers on every input.
  // Volume/mute/solo/name-only updates skip re-encoding clip buffers.
  useEffect(() => {
    const saveState = async () => {
      const sig = clipBufferSignature(trackStates)
      const writeBuffers = sig !== lastClipBufferSigRef.current
      const tracks = await Promise.all(trackStates.map(async (t, i) => {
        const savedClips = await Promise.all(t.clips.map(async (clip, clipIdx) => {
          const bufferKey = `audio-buffer-${i}-${clipIdx}`
          if (writeBuffers) {
            await saveAudioBuffer(bufferKey, clip.buffer)
          }
          return {
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            audioBufferKey: bufferKey,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration
          }
        }))
        
        return {
          name: resolveTrackName(t.name, i),
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          ...serializeTrackAudio(t),
          clips: savedClips
        }
      }))
      
      const state = {
        bpm,
        pitchSemitones,
        tempoRate,
        harmony: serializeHarmony(harmony),
        loopStart,
        loopEnd,
        playheadPosition,
        tracks,
        metronomeEnabled,
        isLoopEnabled
      }
      autosaveProject(state)
      lastClipBufferSigRef.current = sig
    }
    
    const timer = window.setTimeout(() => { void saveState() }, 1000)
    return () => window.clearTimeout(timer)
  }, [bpm, pitchSemitones, tempoRate, harmony, loopStart, loopEnd, trackStates, metronomeEnabled, isLoopEnabled])

  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDraggingLoop || isDraggingLoopEdge) {
        handleLoopMouseUp(e)
      }
    }
    
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [isDraggingLoop, isDraggingLoopEdge])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setHorizontalZoom(prev => Math.max(0.5, Math.min(4, prev + delta)))
      } else if (e.shiftKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setVerticalZoom(prev => Math.max(0.5, Math.min(3, prev + delta)))
      }
    }

    const lanesColumn = lanesColumnRef.current
    if (lanesColumn) {
      lanesColumn.addEventListener('wheel', handleWheel, { passive: false })
      return () => lanesColumn.removeEventListener('wheel', handleWheel)
    }
  }, [])

  useEffect(() => {
    Tone.getTransport().loop = false
  }, [isPlaying, isLoopEnabled, loopStart, loopEnd])
  
  // Load project on mount
  useEffect(() => {
    const loadGen = projectLoadGenRef.current
    console.log(`[Mount] Starting local project load, gen=${loadGen}`)
    
    loadProject().then(async (state) => {
      if (!state) {
        console.log(`[Mount] No local project found`)
        return
      }
      
      // Check if a newer load has started (cloud open or new project)
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Mount] Aborting stale local load (gen ${loadGen}, current ${projectLoadGenRef.current})`)
        return
      }
      
      await ensureAudio()
      ensureTrackGains(state.tracks.length)
      
      setBpm(state.bpm)
      const loadedPitch = clampPitchSemitones(Number((state as { pitchSemitones?: unknown }).pitchSemitones) || 0)
      const loadedRate = clampTempoRate(Number((state as { tempoRate?: unknown }).tempoRate) || 1)
      pitchRef.current = loadedPitch
      tempoRateRef.current = loadedRate
      setPitchSemitones(loadedPitch)
      setTempoRate(loadedRate)
      {
        const loadedHarmony = hydrateHarmony((state as { harmony?: unknown }).harmony)
        setHarmony(loadedHarmony)
        if (loadedHarmony) setHarmonySource(loadedHarmony.source)
      }
      setLoopStart(state.loopStart)
      setLoopEnd(state.loopEnd)
      commitPlayhead(state.playheadPosition)
      if (state.metronomeEnabled !== undefined) setMetronomeEnabled(state.metronomeEnabled)
      if (state.isLoopEnabled !== undefined) setIsLoopEnabled(state.isLoopEnabled)
      
      const newTrackStates = await Promise.all(state.tracks.map(async (t, i) => {
        // Handle old format with single clip
        if (t.clip) {
          const buffer = await loadAudioBuffer(t.clip.audioBufferKey)
          if (!buffer) {
            return {
              mute: !!t.mute,
              solo: !!t.solo,
              volume: typeof t.volume === 'number' ? t.volume : DEFAULT_TRACK_VOLUME,
              name: resolveTrackName(t.name, i),
              ...hydrateTrackAudio(t),
              clips: []
            }
          }
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = makeClipPlayer()
          player.buffer = toneBuffer
          player.loop = false
          player.connect(trackGainsRef.current[i])
          
          return {
            mute: !!t.mute,
            solo: !!t.solo,
            volume: typeof t.volume === 'number' ? t.volume : DEFAULT_TRACK_VOLUME,
            name: resolveTrackName(t.name, i),
            ...hydrateTrackAudio(t),
            clips: [{
              player,
              fileName: t.clip.fileName,
              isPlaying: false,
              buffer,
              startPosition: t.clip.startPosition,
              offsetSeconds: t.clip.offsetSeconds || getCountInSeconds(),
              id: t.clip.id || `clip-${Date.now()}-${i}-${Math.random()}`,
              sourceStart: (t.clip as any).sourceStart ?? 0,
              duration: (t.clip as any).duration ?? buffer.duration
            }]
          }
        }
        
        // Handle new format with clips array
        const loadedClips = await Promise.all((t.clips || []).map(async (clipData: any) => {
          const buffer = await loadAudioBuffer(clipData.audioBufferKey)
          if (!buffer) return null
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = makeClipPlayer()
          player.buffer = toneBuffer
          player.loop = false
          player.connect(trackGainsRef.current[i])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds || getCountInSeconds(),
            id: clipData.id || `clip-${Date.now()}-${i}-${Math.random()}`,
            sourceStart: clipData.sourceStart ?? 0,
            duration: clipData.duration ?? buffer.duration
          }
        }))
        
        return {
          mute: !!t.mute,
          solo: !!t.solo,
          volume: typeof t.volume === 'number' ? t.volume : DEFAULT_TRACK_VOLUME,
          name: resolveTrackName(t.name, i),
          ...hydrateTrackAudio(t),
          clips: loadedClips.filter(c => c !== null) as Clip[]
        }
      }))
      
      // Final check before applying state
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Mount] Aborting stale local load before setState (gen ${loadGen}, current ${projectLoadGenRef.current})`)
        return
      }
      
      setTrackStates(newTrackStates)
      setToastMessage('Proyecto local cargado')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      console.log(`[Mount] Local project loaded successfully`)
    })
  }, [])
  
  const handleNewProject = async () => {
    if (!confirm('¿Crear un nuevo proyecto? Se perderá el trabajo no guardado.')) return
    
    projectLoadGenRef.current++
    console.log(`[New Project] Starting new project, gen=${projectLoadGenRef.current}`)
    await clearProject()
    setCurrentProjectName('Proyecto sin título')
    window.location.reload()
  }
  
  const handleLogin = async (email: string, password: string) => {
    setAuthLoading(true)
    setErrorMessage(null)
    try {
      const { user } = await login(email, password)
      setCurrentUser(user)
      setShowAuth(false)
      setToastMessage(`Bienvenido, ${user.username}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (error: any) {
      console.error('Login error:', error)
      setErrorMessage(error.message || 'Error al iniciar sesión')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleRegister = async (username: string, email: string, password: string) => {
    setAuthLoading(true)
    setErrorMessage(null)
    try {
      const { user } = await register(username, email, password)
      setCurrentUser(user)
      setShowAuth(false)
      setToastMessage(`Cuenta creada. Bienvenido, ${user.username}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (error: any) {
      console.error('Register error:', error)
      setErrorMessage(error.message || 'Error al crear cuenta')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    clearAuth()
    setCurrentUser(null)
    setToastMessage('Sesión cerrada')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }

  const handleSaveToLocal = async (saveAs = false) => {
    try {
      const hasAnyAudio = trackStates.some(t => t.clips.length > 0)
      if (!hasAnyAudio) {
        setErrorMessage('No hay audio para guardar. Importa al menos un archivo de audio.')
        setTimeout(() => setErrorMessage(null), 5000)
        return
      }
      
      // If we have a saved file handle and this is not "Save As", reuse it
      if (!saveAs && currentFileHandle) {
        await saveProjectToFileHandle(currentFileHandle, currentProjectName)
        return
      }
      
      // Otherwise, ask for file location FIRST (before any async work)
      // This preserves user activation for showSaveFilePicker
      const fileName = `${currentProjectName.replace(/[^a-z0-9]/gi, '_')}.musicalia`
      
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'Proyecto Musicalia',
              accept: { 'application/x-musicalia': ['.musicalia'] }
            }]
          })
          
          // Extract the project name from the chosen file name
          const savedFileName = handle.name.replace(/\.musicalia$/, '').replace(/_/g, ' ')
          setCurrentProjectName(savedFileName)
          setCurrentFileHandle(handle)
          
          await saveProjectToFileHandle(handle, savedFileName)
        } catch (e: any) {
          if (e.name === 'AbortError') {
            // User cancelled, do nothing
            return
          }
          throw e
        }
      } else {
        // Fallback for browsers without File System Access API
        await saveFallbackDownload(fileName)
      }
    } catch (err: any) {
      console.error('[Save] Error:', err)
      const errorMsg = err.message || 'Error al guardar'
      setErrorMessage(`Error al guardar: ${errorMsg}`)
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }
  
  const saveProjectToFileHandle = async (fileHandle: any, projectName: string) => {
    try {
      setUploadProgress(5)
      setExportProgress('Preparando proyecto...')
      
      const zip = new JSZip()
      
      const projectData = {
        version: APP_VERSION,
        name: projectName,
        bpm,
        pitchSemitones,
        tempoRate,
        harmony: serializeHarmony(harmony),
        loopStart,
        loopEnd,
        playheadPosition,
        metronomeEnabled,
        countInBars,
        tracks: trackStates.map((t, trackIdx) => ({
          name: resolveTrackName(t.name, trackIdx),
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          ...serializeTrackAudio(t),
          clips: t.clips.map((clip, clipIdx) => ({
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration,
            audioFile: `audio_${trackIdx}_${clipIdx}.wav`
          }))
        }))
      }
      
      zip.file('project.json', JSON.stringify(projectData, null, 2))
      
      setExportProgress('Procesando audio...')
      
      const bufferMap = new Map<AudioBuffer, string>()
      
      for (let trackIdx = 0; trackIdx < trackStates.length; trackIdx++) {
        const track = trackStates[trackIdx]
        for (let clipIdx = 0; clipIdx < track.clips.length; clipIdx++) {
          const clip = track.clips[clipIdx]
          
          let audioFileName: string
          if (bufferMap.has(clip.buffer)) {
            audioFileName = bufferMap.get(clip.buffer)!
          } else {
            audioFileName = `audio_${trackIdx}_${clipIdx}.wav`
            bufferMap.set(clip.buffer, audioFileName)
            
            const wavData = encodeAudioBufferWAV(clip.buffer)
            // Use STORE (no compression) for WAV files - they're already compressed
            // and DEFLATE is slow and doesn't save much space
            zip.file(audioFileName, wavData.buffer as ArrayBuffer, { compression: 'STORE' })
          }
          
          const progress = 10 + ((trackIdx * track.clips.length + clipIdx + 1) / 
            trackStates.reduce((sum, t) => sum + t.clips.length, 0)) * 80
          setUploadProgress(progress)
        }
      }
      
      setExportProgress('Empaquetando...')
      setUploadProgress(90)
      
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      
      setExportProgress('Guardando en tu compu...')
      setUploadProgress(95)
      
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      
      setUploadProgress(100)
      
      setToastMessage(`✅ Proyecto guardado: ${projectName}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Save] Project saved successfully: ${projectName}`)
    } catch (err: any) {
      console.error('[Save] Error:', err)
      throw err
    } finally {
      setUploadProgress(0)
      setExportProgress('')
    }
  }
  
  const saveFallbackDownload = async (fileName: string) => {
    try {
      setUploadProgress(5)
      setExportProgress('Preparando proyecto...')
      
      const zip = new JSZip()
      
      const projectData = {
        version: APP_VERSION,
        name: currentProjectName,
        bpm,
        pitchSemitones,
        tempoRate,
        harmony: serializeHarmony(harmony),
        loopStart,
        loopEnd,
        playheadPosition,
        metronomeEnabled,
        countInBars,
        tracks: trackStates.map((t, trackIdx) => ({
          name: resolveTrackName(t.name, trackIdx),
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          ...serializeTrackAudio(t),
          clips: t.clips.map((clip, clipIdx) => ({
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration,
            audioFile: `audio_${trackIdx}_${clipIdx}.wav`
          }))
        }))
      }
      
      zip.file('project.json', JSON.stringify(projectData, null, 2))
      
      setExportProgress('Procesando audio...')
      
      const bufferMap = new Map<AudioBuffer, string>()
      
      for (let trackIdx = 0; trackIdx < trackStates.length; trackIdx++) {
        const track = trackStates[trackIdx]
        for (let clipIdx = 0; clipIdx < track.clips.length; clipIdx++) {
          const clip = track.clips[clipIdx]
          
          let audioFileName: string
          if (bufferMap.has(clip.buffer)) {
            audioFileName = bufferMap.get(clip.buffer)!
          } else {
            audioFileName = `audio_${trackIdx}_${clipIdx}.wav`
            bufferMap.set(clip.buffer, audioFileName)
            
            const wavData = encodeAudioBufferWAV(clip.buffer)
            zip.file(audioFileName, wavData.buffer as ArrayBuffer, { compression: 'STORE' })
          }
          
          const progress = 10 + ((trackIdx * track.clips.length + clipIdx + 1) / 
            trackStates.reduce((sum, t) => sum + t.clips.length, 0)) * 80
          setUploadProgress(progress)
        }
      }
      
      setExportProgress('Empaquetando...')
      setUploadProgress(90)
      
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      
      setExportProgress('Descargando...')
      setUploadProgress(95)
      
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      setUploadProgress(100)
      
      setToastMessage(`✅ Proyecto descargado: ${currentProjectName}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Save] Project downloaded: ${currentProjectName}`)
    } catch (err: any) {
      console.error('[Save] Error:', err)
      throw err
    } finally {
      setUploadProgress(0)
      setExportProgress('')
    }
  }
  

  const handleOpenFromLocal = async (file: File) => {
    try {
      setExportProgress('Cargando proyecto...')
      setUploadProgress(5)
      
      const zip = new JSZip()
      const contents = await zip.loadAsync(file)
      
      setUploadProgress(10)
      
      const projectFile = contents.file('project.json')
      if (!projectFile) {
        throw new Error('Archivo de proyecto inválido: falta project.json')
      }
      
      const projectJson = await projectFile.async('string')
      const projectData = JSON.parse(projectJson)
      
      setUploadProgress(20)
      setExportProgress('Cargando audio...')
      
      await ensureAudio()
      ensureTrackGains((projectData.tracks || []).length)
      
      projectLoadGenRef.current++
      const loadGen = projectLoadGenRef.current
      console.log(`[Open Local] Starting load, gen=${loadGen}`)
      
      const audioFiles = new Map<string, AudioBuffer>()
      const audioFileNames = Object.keys(contents.files).filter(name => name.endsWith('.wav'))
      
      for (let i = 0; i < audioFileNames.length; i++) {
        const fileName = audioFileNames[i]
        const file = contents.file(fileName)
        if (file) {
          const arrayBuffer = await file.async('arraybuffer')
          const audioBuffer = await Tone.context.decodeAudioData(arrayBuffer)
          audioFiles.set(fileName, audioBuffer)
          
          const progress = 20 + ((i + 1) / audioFileNames.length) * 60
          setUploadProgress(progress)
        }
      }
      
      setUploadProgress(80)
      setExportProgress('Restaurando proyecto...')
      
      const newTrackStates = await Promise.all(projectData.tracks.map(async (t: any, trackIdx: number) => {
        const clips = await Promise.all((t.clips || []).map(async (clipData: any) => {
          const audioBuffer = audioFiles.get(clipData.audioFile)
          if (!audioBuffer) {
            console.warn(`Audio file not found: ${clipData.audioFile}`)
            return null
          }
          
          const player = makeClipPlayer()
          player.buffer = new Tone.ToneAudioBuffer(audioBuffer)
          player.loop = false
          
          if (!trackGainsRef.current[trackIdx]) {
            console.warn(`Track gain ${trackIdx} not available`)
            return null
          }
          player.connect(trackGainsRef.current[trackIdx])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer: audioBuffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds,
            id: clipData.id,
            sourceStart: clipData.sourceStart ?? 0,
            duration: clipData.duration ?? audioBuffer.duration
          }
        }))
        
        return {
          name: resolveTrackName(t.name, trackIdx),
          mute: !!t.mute,
          solo: !!t.solo,
          volume: typeof t.volume === 'number' ? t.volume : DEFAULT_TRACK_VOLUME,
          ...hydrateTrackAudio(t),
          clips: clips.filter(c => c !== null) as Clip[]
        }
      }))
      
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Open Local] Aborted due to newer load, current gen=${projectLoadGenRef.current}`)
        return
      }
      
      setBpm(projectData.bpm || 120)
      const loadedPitch = clampPitchSemitones(Number(projectData.pitchSemitones) || 0)
      const loadedRate = clampTempoRate(Number(projectData.tempoRate) || 1)
      Tone.getTransport().bpm.value = effectiveBpm(projectData.bpm || 120, loadedRate)
      pitchRef.current = loadedPitch
      tempoRateRef.current = loadedRate
      setPitchSemitones(loadedPitch)
      setTempoRate(loadedRate)
      {
        const loadedHarmony = hydrateHarmony(projectData.harmony)
        setHarmony(loadedHarmony)
        if (loadedHarmony) setHarmonySource(loadedHarmony.source)
      }
      setLoopStart(projectData.loopStart ?? null)
      setLoopEnd(projectData.loopEnd ?? null)
      commitPlayhead(projectData.playheadPosition || 0)
      setTrackStates(newTrackStates)
      setCurrentProjectName(projectData.name || 'Proyecto sin título')
      
      setUploadProgress(100)
      setToastMessage('Proyecto cargado desde tu computadora')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Open Local] Load completed, gen=${loadGen}`)
    } catch (err: any) {
      console.error('Local open error:', err)
      setErrorMessage(err.message || 'Error al abrir proyecto local')
      setTimeout(() => setErrorMessage(null), 5000)
    } finally {
      setUploadProgress(0)
      setExportProgress('')
    }
  }

  const handleOpenExportDialog = () => {
    const tracksWithAudio = trackStates.map(t => t.clips.length > 0 && !t.mute)
    setExportTracks(tracksWithAudio)
    setShowExportDialog(true)
  }

  const sanitizeFilename = (name: string): string => {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim()
  }

  const handleExport = async () => {
    try {
      setShowExportDialog(false)
      setIsExporting(true)
      setExportProgress('Preparando...')
      setErrorMessage(null)
      
      const selectedIndices = exportTracks
        .map((selected, i) => selected ? i : -1)
        .filter(i => i >= 0 && trackStates[i].clips.length > 0)
      
      if (selectedIndices.length === 0) {
        setErrorMessage('Selecciona al menos una pista para exportar')
        setIsExporting(false)
        return
      }
      
      const anySolo = selectedIndices.some(i => trackStates[i].solo)
      const effectiveIndices = anySolo 
        ? selectedIndices.filter(i => trackStates[i].solo)
        : selectedIndices
      
      if (effectiveIndices.length === 0) {
        setErrorMessage('No hay pistas soloed seleccionadas')
        setIsExporting(false)
        return
      }
      
      const countInSeconds = exportIncludeCountIn ? getCountInSeconds() : 0
      const maxDuration = Math.max(...effectiveIndices.flatMap(i => 
        trackStates[i].clips.map(clip => clip.offsetSeconds + clip.duration)
      ))
      const totalDuration = maxDuration + countInSeconds
      const sampleRate = trackStates[effectiveIndices[0]].clips[0].buffer.sampleRate
      
      if (exportMixed) {
        // Export all tracks mixed into one file
        setExportProgress('Renderizando mezcla...')
        
        const offlineContext = new OfflineAudioContext(2, totalDuration * sampleRate, sampleRate)
        
        // Add metronome count-in if requested
        if (exportIncludeCountIn && metronomePlayerRef.current?.buffer) {
          const beatsPerBar = 4
          const totalBeats = countInBars * beatsPerBar
          const secondsPerBeat = 60 / bpm
          
          for (let beat = 0; beat < totalBeats; beat++) {
            const source = offlineContext.createBufferSource()
            source.buffer = metronomePlayerRef.current.buffer.get() as AudioBuffer
            const gain = offlineContext.createGain()
            gain.gain.value = 0.5
            source.connect(gain)
            gain.connect(offlineContext.destination)
            source.start(beat * secondsPerBeat)
          }
        }
        
        for (const i of effectiveIndices) {
          const track = trackStates[i]
          if (track.mute) continue
          
          const gainNode = offlineContext.createGain()
          gainNode.gain.value = track.volume
          gainNode.connect(offlineContext.destination)
          
          for (const clip of track.clips) {
            const source = offlineContext.createBufferSource()
            source.buffer = clip.buffer
            source.connect(gainNode)
            source.start(clip.offsetSeconds + countInSeconds, clip.sourceStart, clip.duration)
          }
        }
        
        const renderedBuffer = await offlineContext.startRendering()
        
        setExportProgress('Codificando mezcla...')
        
        const wavData = encodeAudioBufferWAV(renderedBuffer)
        
        const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        
        const fileName = sanitizeFilename(`${currentProjectName}.wav`)
        
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        
        URL.revokeObjectURL(url)
        
      } else {
        // Export tracks separately
        for (let idx = 0; idx < effectiveIndices.length; idx++) {
          const i = effectiveIndices[idx]
          const track = trackStates[i]
          
          setExportProgress(`Renderizando ${idx + 1}/${effectiveIndices.length}...`)
          
          const offlineContext = new OfflineAudioContext(2, totalDuration * sampleRate, sampleRate)
          
          // Add metronome count-in if requested
          if (exportIncludeCountIn && metronomePlayerRef.current?.buffer) {
            const beatsPerBar = 4
            const totalBeats = countInBars * beatsPerBar
            const secondsPerBeat = 60 / bpm
            
            for (let beat = 0; beat < totalBeats; beat++) {
              const source = offlineContext.createBufferSource()
              source.buffer = metronomePlayerRef.current.buffer.get() as AudioBuffer
              const gain = offlineContext.createGain()
              gain.gain.value = 0.5
              source.connect(gain)
              gain.connect(offlineContext.destination)
              source.start(beat * secondsPerBeat)
            }
          }
          
          const gainNode = offlineContext.createGain()
          gainNode.gain.value = track.volume
          gainNode.connect(offlineContext.destination)
          
          for (const clip of track.clips) {
            const source = offlineContext.createBufferSource()
            source.buffer = clip.buffer
            source.connect(gainNode)
            source.start(clip.offsetSeconds + countInSeconds, clip.sourceStart, clip.duration)
          }
          
          const renderedBuffer = await offlineContext.startRendering()
          
          setExportProgress(`Codificando ${idx + 1}/${effectiveIndices.length}...`)
          
          const wavData = encodeAudioBufferWAV(renderedBuffer)
          
          const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
          const url = URL.createObjectURL(blob)
          
          const trackName = track.name || `Pista ${i + 1}`
          const fileName = sanitizeFilename(`${currentProjectName} - ${trackName}.wav`)
          
          const a = document.createElement('a')
          a.href = url
          a.download = fileName
          a.click()
          
          URL.revokeObjectURL(url)
          
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      setToastMessage('Exportación completada')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      console.error('Export error:', err)
      setErrorMessage(err.message || 'Error al exportar')
    } finally {
      setIsExporting(false)
      setExportProgress('')
    }
  }

  const ensureAudio = async () => {
    const contextState = Tone.getContext().state
    console.log('[DEBUG] ensureAudio: Tone context state=', contextState)
    
    if (!audioInitializedRef.current) {
      await Tone.start()
      
      if (trackGainsRef.current.length === 0) {
        ensureTrackGains(Math.max(trackStatesRef.current.length, 1))
      } else {
        ensureTrackGains(trackStatesRef.current.length)
      }
      
      if (!metronomePlayerRef.current) {
        const clickBuffer = createClickSound()
        metronomePlayerRef.current = new Tone.Player(clickBuffer).toDestination()
        metronomePlayerRef.current.volume.value = -6
      }
      
      if (!meterRef.current) {
        meterRef.current = new Tone.Meter()
        Tone.getDestination().connect(meterRef.current)
        
        setInterval(() => {
          if (!meterRef.current) return
          const level = meterRef.current.getValue() as number
          const el = meterDisplayRef.current
          if (!el) return
          el.textContent = level > -100 ? `${level.toFixed(0)}dB` : '-∞'
          el.className = level > -60 ? 'level-active' : 'level-inactive'
        }, 100)
      }
      
      audioInitializedRef.current = true
    }
    
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    console.log('[DIAG] Destination mute:', Tone.getDestination().mute)
    console.log('[DIAG] Destination volume:', Tone.getDestination().volume.value)
    console.log('[DIAG] Gains:', trackGainsRef.current.map(g => g.gain.value))
  }

  const createClickSound = (): Tone.ToneAudioBuffer => {
    const sampleRate = Tone.getContext().sampleRate
    const duration = 0.05
    const length = Math.floor(sampleRate * duration)
    const audioBuffer = Tone.getContext().createBuffer(2, length, sampleRate)
    
    const freq = 1000
    for (let ch = 0; ch < 2; ch++) {
      const channel = audioBuffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const envelope = Math.exp(-t * 20)
        channel[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3
      }
    }
    
    return new Tone.ToneAudioBuffer(audioBuffer)
  }

  const playTestTone = async () => {
    await Tone.start()
    const osc = new Tone.Oscillator(440, 'sine').toDestination()
    osc.start()
    osc.stop('+0.5')
    setTimeout(() => osc.dispose(), 600)
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getMaxDuration = (): number => {
    let maxDuration = 0
    trackStatesRef.current.forEach(track => {
      track.clips.forEach(clip => {
        const clipEnd = clip.offsetSeconds + clip.duration
        maxDuration = Math.max(maxDuration, clipEnd)
      })
    })
    return maxDuration > 0 ? maxDuration : 0
  }

  const getLayoutMax = (): number => {
    const clipMax = getMaxDuration()
    const live = recordLiveRef.current
    if (!live) return clipMax > 0 ? clipMax : 100
    const elapsed = Math.max(0, playheadPositionRef.current - live.startOffset)
    const liveEnd = live.startOffset + elapsed + 12
    return Math.max(clipMax, liveEnd, 100)
  }

  const syncPlayheadDom = (seconds: number) => {
    playheadPositionRef.current = seconds
    const layoutMax = timelineMaxRef.current || 100
    const left = `${Math.min((seconds / layoutMax) * 100, 100)}%`
    if (playheadElRef.current) {
      playheadElRef.current.style.left = left
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = `${formatTime(seconds)} / ${formatTime(timelineMaxRef.current)}`
    }
  }

  const commitPlayhead = (seconds: number) => {
    syncPlayheadDom(seconds)
    setPlayheadPosition(seconds)
  }

  useLayoutEffect(() => {
    timelineMaxRef.current = getLayoutMax()
    syncPlayheadDom(playheadPositionRef.current)
  }, [trackStates, horizontalZoom, isRecording, recordLayoutTick, recordingTrackIndex])

  useLayoutEffect(() => {
    syncPlayheadDom(playheadPosition)
  }, [playheadPosition])

  useEffect(() => {
    applyAllTrackAudio(playheadPositionRef.current)
  }, [trackStates])

  const bindRecordingPreview = (trackIndex: number) => {
    const el = document.querySelector(
      `.track-content[data-track-index="${trackIndex}"] [data-recording-clip]`
    ) as HTMLElement | null
    const canvas = el?.querySelector('canvas') as HTMLCanvasElement | null
    return { el, canvas }
  }

  const updateRecordingPreview = (currentTime: number) => {
    const live = recordLiveRef.current
    if (!live) return
    const elapsed = Math.max(0, currentTime - live.startOffset)
    if (recordElapsedRef.current) {
      recordElapsedRef.current.textContent = formatTime(elapsed)
    }
    const needed = Math.max(timelineMaxRef.current, live.startOffset + elapsed + 12, 100)
    if (needed > timelineMaxRef.current + 2) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (now - lastRecordLayoutRef.current > 400) {
        lastRecordLayoutRef.current = now
        setRecordLayoutTick((tick) => tick + 1)
      }
    }
    const layoutMax = timelineMaxRef.current || 100
    if (live.el) {
      live.el.style.left = `${(live.startOffset / layoutMax) * 100}%`
      live.el.style.width = `${(Math.max(0.05, elapsed) / layoutMax) * 100}%`
    }
    if (live.canvas && live.capture.peaks.length) {
      const width = Math.max(40, Math.floor(live.el?.getBoundingClientRect().width || 40))
      if (live.canvas.width !== width) live.canvas.width = width
      if (live.canvas.height !== 64) live.canvas.height = 64
      drawRecordingPeaks(live.canvas, live.capture.peaks)
    }
  }

  const handlePlay = async () => {
    await Tone.start()
    await ensureAudio()
    
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] handlePlay: Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    console.log('[DEBUG] handlePlay: audio initialized, gains:', trackGainsRef.current.length)
    console.log('[DEBUG] trackStates with clips:', trackStates.filter(t => t.clips.length > 0).length)
    
    Tone.getTransport().bpm.value = effectiveBpm(bpm, tempoRateRef.current)
    
    const countInSeconds = getCountInSeconds()
    // When loop is enabled and marked, always start from loop start
    // Otherwise, start from current playhead position (clicked or paused)
    const startTime = (isLoopEnabled && loopStart !== null) ? loopStart : playheadPositionRef.current
    
    Tone.getTransport().loop = false
    Tone.getTransport().seconds = startTime
    Tone.getTransport().start()
    playOriginSongRef.current = startTime
    playOriginWallRef.current = Tone.now()
    applyAllClipPlayback()
    
    const startingInsideGap = startTime < countInSeconds
    
    if (metronomeEnabled && startingInsideGap && metronomePlayerRef.current) {
      const beatsPerBar = 4
      const totalBeats = countInBars * beatsPerBar
      const secondsPerBeatWall = 60 / Math.max(1, bpm * tempoRateRef.current)
      const clicksNeeded = Math.ceil((countInSeconds - startTime) / (60 / Math.max(1, bpm)))
      
      for (let beat = 0; beat < Math.min(clicksNeeded, totalBeats); beat++) {
        const time = Tone.now() + beat * secondsPerBeatWall
        metronomePlayerRef.current.start(time)
      }
    }
    
    const maxDuration = getMaxDuration()
    
    const skipRecordTrack = recordLiveRef.current?.trackIndex
    const sourceTracks = trackStatesRef.current
    const updatedStates = sourceTracks.map((track, trackIndex) => {
      if (trackIndex === skipRecordTrack) {
        return { ...track, clips: track.clips.map(clip => ({ ...clip, isPlaying: false })) }
      }
      const updatedClips = track.clips.map(clip => {
        const started = startClipAtSongTime(clip, startTime)
        return { ...clip, isPlaying: started }
      })
      return { ...track, clips: updatedClips }
    })
    
    setTrackStates(updatedStates)
    setIsPlaying(true)
    isPlayingRef.current = true
    setIsPaused(false)
    
    let lastUpdateTime = 0
    isPlayingRef.current = true
    const updatePlayhead = (timestamp: number) => {
      if (Tone.getTransport().state === 'started') {
        let currentTime = getSongTime()
        applyAllTrackAudio(currentTime)
        if (timestamp - lastUpdateTime < 50) {
          playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
          return
        }
        lastUpdateTime = timestamp

        if (isLoopEnabled && loopStart !== null && loopEnd !== null && currentTime >= loopEnd) {
          const span = Math.max(0.05, loopEnd - loopStart)
          currentTime = loopStart + ((currentTime - loopStart) % span)
          playOriginSongRef.current = currentTime
          playOriginWallRef.current = Tone.now()
          retargetPlayingClips(currentTime)
        } else if (!isLoopEnabled && !recordLiveRef.current && maxDuration > 0 && currentTime >= maxDuration) {
          currentTime = 0
          playOriginSongRef.current = 0
          playOriginWallRef.current = Tone.now()
          Tone.getTransport().seconds = 0
          retargetPlayingClips(0)
        }
        
        syncPlayheadDom(currentTime)
        updateRecordingPreview(currentTime)
        playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
      }
    }
    playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
  }

  const handlePause = () => {
    if (isRecordingRef.current) {
      void stopRecording({ then: 'pause' })
      return
    }
    Tone.getTransport().pause()
    
    if (playheadAnimationRef.current !== null) {
      cancelAnimationFrame(playheadAnimationRef.current)
      playheadAnimationRef.current = null
    }
    
    const pausedAt = getSongTime()
    isPlayingRef.current = false
    commitPlayhead(pausedAt)
    Tone.getTransport().seconds = pausedAt
    
    setTrackStates(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.isPlaying) {
          clip.player.stop()
        }
        return { ...clip, isPlaying: false }
      })
    })))
    
    setIsPlaying(false)
    isPlayingRef.current = false
    setIsPaused(true)
    applyAllTrackAudio(playheadPositionRef.current)
  }
  handlePlayRef.current = handlePlay
  handlePauseRef.current = handlePause

  const handleStop = () => {
    if (isRecordingRef.current) {
      void stopRecording({ then: 'stop' })
      return
    }
    const currentPosition = getSongTime()
    isPlayingRef.current = false
    
    Tone.getTransport().stop()
    
    if (playheadAnimationRef.current !== null) {
      cancelAnimationFrame(playheadAnimationRef.current)
      playheadAnimationRef.current = null
    }
    
    // Preserve playhead position where playback stopped
    commitPlayhead(currentPosition)
    Tone.getTransport().seconds = currentPosition
    
    setTrackStates(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.isPlaying) {
          clip.player.stop()
        }
        return { ...clip, isPlaying: false }
      })
    })))
    
    setIsPlaying(false)
    isPlayingRef.current = false
    setIsPaused(false)
    applyAllTrackAudio(currentPosition)
  }

  const handleJumpToStart = () => {
    seekToPosition(0)
    if (!isPlaying) {
      commitPlayhead(0)
      Tone.getTransport().seconds = 0
    }
  }

  const stopRecording = async (opts?: { then?: 'stop' | 'pause' | 'keep'; commit?: boolean }) => {
    const live = recordLiveRef.current
    if (!live) return
    isRecordingRef.current = false
    setIsRecording(false)
    setRecordingTrackIndex(null)
    const after = opts?.then ?? 'stop'
    const commit = opts?.commit !== false
    let captured: { chunks: Float32Array[][]; sampleRate: number } | null = null
    try {
      captured = live.capture.stop()
    } catch (err) {
      console.error('record stop failed', err)
    }
    live.stream.getTracks().forEach((track) => track.stop())
    recordLiveRef.current = null
    if (recordElapsedRef.current) recordElapsedRef.current.textContent = ''

    const ctx = nativeAudioContext(Tone.getContext().rawContext)
    if (commit && captured && captured.chunks.length > 0) {
      try {
        const buffer = pcmChunksToAudioBuffer(ctx, captured.chunks, captured.sampleRate)
        if (buffer.duration >= 0.05) {
          await ensureAudio()
          ensureTrackGains(trackStatesRef.current.length)
          const latency = recordLatencySeconds(ctx)
          const offset = compensatedRecordOffset(live.startOffset, latency)
          const player = makeClipPlayer()
          player.loop = false
          player.buffer = new Tone.ToneAudioBuffer(buffer)
          const gain = trackGainsRef.current[live.trackIndex]
          if (gain) player.connect(gain)
          const newClip: Clip = {
            player,
            fileName: 'Grabación',
            isPlaying: false,
            buffer,
            startPosition: 0,
            offsetSeconds: offset,
            id: `clip-${Date.now()}-${Math.random()}`,
            sourceStart: 0,
            duration: buffer.duration
          }
          const next = [...trackStatesRef.current]
          if (next[live.trackIndex]) {
            next[live.trackIndex] = {
              ...next[live.trackIndex],
              clips: [...next[live.trackIndex].clips, newClip]
            }
            trackStatesRef.current = next
            setTrackStates(next)
            showClipToast('Grabación lista')
          }
        } else {
          setErrorMessage('Grabación demasiado corta')
          setTimeout(() => setErrorMessage(null), 3000)
        }
      } catch (err) {
        console.error(err)
        setErrorMessage('No se pudo procesar la grabación')
        setTimeout(() => setErrorMessage(null), 4000)
      }
    }

    if (after === 'pause') handlePause()
    else if (after === 'stop') handleStop()
  }
  stopRecordingRef.current = stopRecording

  const handleRecordArm = (trackIndex: number) => {
    setRecordArmedIndex((prev) => (prev === trackIndex ? null : trackIndex))
  }

  const handleMicDeviceChange = (deviceId: string) => {
    setMicDeviceId(deviceId)
    persistMicDeviceId(deviceId)
  }

  const handleRecord = async () => {
    if (isRecordingRef.current) {
      await stopRecording({ then: 'stop' })
      return
    }
    await ensureAudio()
    const tracks = trackStatesRef.current
    const placement = resolveRecordTrack(recordArmedIndex, selectedTrack, tracks.length)
    let trackIndex = placement.trackIndex
    let stream: MediaStream
    try {
      stream = await requestMicStream(micDeviceId)
    } catch (err) {
      setErrorMessage(micErrorMessage(err))
      setTimeout(() => setErrorMessage(null), 4000)
      return
    }
    try {
      const devices = await listAudioInputDevices()
      setAudioInputs(devices)
      const selected = stream.getAudioTracks()[0]?.getSettings().deviceId
      if (typeof selected === 'string' && selected.length > 0 && selected !== micDeviceId) {
        setMicDeviceId(selected)
        persistMicDeviceId(selected)
      }
    } catch {
      // ignore enumerate failures
    }

    projectLoadGenRef.current++
    saveUndo()
    let nextTracks = tracks
    if (placement.createNew) {
      const name = nextGrabacionName(tracks.map((t) => t.name), tracks.length)
      nextTracks = [...tracks, { ...createEmptyTrack(name), clips: [] as Clip[] }]
      ensureTrackGains(nextTracks.length)
      trackIndex = nextTracks.length - 1
      trackStatesRef.current = nextTracks
    }

    const startOffset = playheadPositionRef.current
    const ctx = Tone.getContext().rawContext as AudioContext
    let capture: PcmCapture
    try {
      capture = startPcmCapture(ctx, stream)
    } catch (err) {
      console.error('[record] capture failed', err)
      stream.getTracks().forEach((track) => track.stop())
      setErrorMessage('No se pudo iniciar la captura de audio')
      setTimeout(() => setErrorMessage(null), 4000)
      return
    }

    recordLiveRef.current = {
      trackIndex,
      startOffset,
      capture,
      stream,
      el: null,
      canvas: null,
      startedPlayback: Tone.getTransport().state !== 'started'
    }
    isRecordingRef.current = true
    flushSync(() => {
      if (placement.createNew) {
        setTrackStates(nextTracks)
        setRecordArmedIndex(trackIndex)
        setSelectedTrack(trackIndex)
      }
      setRecordingTrackIndex(trackIndex)
      setIsRecording(true)
    })
    const preview = bindRecordingPreview(trackIndex)
    if (recordLiveRef.current) {
      recordLiveRef.current.el = preview.el
      recordLiveRef.current.canvas = preview.canvas
    }

    if (Tone.getTransport().state !== 'started') {
      await handlePlay()
    } else {
      const armed = trackStatesRef.current[trackIndex]
      armed?.clips.forEach((clip) => {
        if (clip.player.state === 'started') clip.player.stop()
        clip.isPlaying = false
      })
    }
    if (recordLiveRef.current && !trackStatesRef.current[trackIndex] && nextTracks[trackIndex]) {
      const restored = [...trackStatesRef.current, nextTracks[trackIndex]]
      ensureTrackGains(restored.length)
      trackStatesRef.current = restored
      setTrackStates(restored)
    }
  }

  useLayoutEffect(() => {
    const live = recordLiveRef.current
    if (!live || !isRecording) return
    if (!live.el || !live.el.isConnected) {
      const preview = bindRecordingPreview(live.trackIndex)
      live.el = preview.el
      live.canvas = preview.canvas
    }
  }, [isRecording, recordingTrackIndex, trackStates])

  useEffect(() => {
    const refreshInputs = () => {
      void listAudioInputDevices()
        .then(setAudioInputs)
        .catch(() => {})
    }
    refreshInputs()
    const media = navigator.mediaDevices
    if (!media?.addEventListener) return
    media.addEventListener('devicechange', refreshInputs)
    return () => media.removeEventListener('devicechange', refreshInputs)
  }, [])

  const handleSplitClip = async (trackIndex: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) return
    
    await ensureAudio()
    saveUndo()
    
    const splitTime = playheadPositionRef.current
    
    const clipToSplit = track.clips.find(clip => 
      splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration
    )
    
    if (!clipToSplit) {
      setErrorMessage('El playhead debe estar dentro de un clip')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }
    
    const splitOffset = splitTime - clipToSplit.offsetSeconds
    
    const firstPlayer = makeClipPlayer()
    firstPlayer.buffer = clipToSplit.player.buffer
    firstPlayer.loop = false
    firstPlayer.connect(trackGainsRef.current[trackIndex])
    
    const secondPlayer = makeClipPlayer()
    secondPlayer.buffer = clipToSplit.player.buffer
    secondPlayer.loop = false
    secondPlayer.connect(trackGainsRef.current[trackIndex])
    
    const newTrackStates = [...trackStates]
    const updatedClips = track.clips.map(clip => {
      if (clip.id === clipToSplit.id) {
        return null
      }
      return clip
    }).filter(c => c !== null) as Clip[]
    
    updatedClips.push({
      player: firstPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: clipToSplit.startPosition,
      offsetSeconds: clipToSplit.offsetSeconds,
      id: `${clipToSplit.id}-part1`,
      sourceStart: clipToSplit.sourceStart,
      duration: splitOffset
    })
    
    updatedClips.push({
      player: secondPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: 0,
      offsetSeconds: splitTime,
      id: `${clipToSplit.id}-part2`,
      sourceStart: clipToSplit.sourceStart + splitOffset,
      duration: clipToSplit.duration - splitOffset
    })
    
    clipToSplit.player.dispose()
    
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: updatedClips
    }
    
    setTrackStates(newTrackStates)
    setToastMessage('Clip dividido')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const splitClipAt = async (trackIndex: number, splitTime: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) return false
    
    await ensureAudio()
    
    const clipToSplit = track.clips.find(clip => 
      splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration
    )
    
    if (!clipToSplit) return false
    
    saveUndo()
    
    const splitOffset = splitTime - clipToSplit.offsetSeconds
    
    const firstPlayer = makeClipPlayer()
    firstPlayer.buffer = clipToSplit.player.buffer
    firstPlayer.loop = false
    firstPlayer.connect(trackGainsRef.current[trackIndex])
    
    const secondPlayer = makeClipPlayer()
    secondPlayer.buffer = clipToSplit.player.buffer
    secondPlayer.loop = false
    secondPlayer.connect(trackGainsRef.current[trackIndex])
    
    const newTrackStates = [...trackStates]
    const updatedClips = track.clips.map(clip => {
      if (clip.id === clipToSplit.id) {
        return null
      }
      return clip
    }).filter(c => c !== null) as Clip[]
    
    updatedClips.push({
      player: firstPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: clipToSplit.startPosition,
      offsetSeconds: clipToSplit.offsetSeconds,
      id: `${clipToSplit.id}-part1`,
      sourceStart: clipToSplit.sourceStart,
      duration: splitOffset
    })
    
    updatedClips.push({
      player: secondPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: 0,
      offsetSeconds: splitTime,
      id: `${clipToSplit.id}-part2`,
      sourceStart: clipToSplit.sourceStart + splitOffset,
      duration: clipToSplit.duration - splitOffset
    })
    
    clipToSplit.player.dispose()
    
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: updatedClips
    }
    
    setTrackStates(newTrackStates)
    setToastMessage('Clip dividido')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
    return true
  }

  const collectSelectedClips = () => {
    const items: { clip: Clip; trackIndex: number }[] = []
    trackStates.forEach((track, trackIndex) => {
      track.clips.forEach(clip => {
        if (selectedClipIds.has(clip.id)) items.push({ clip, trackIndex })
      })
    })
    return items
  }

  const copySelectedClips = () => {
    const items = collectSelectedClips()
    if (items.length === 0) return 0
    setClipboard(packClipboard(items.map(({ clip, trackIndex }) => ({
      buffer: clip.buffer,
      fileName: clip.fileName,
      sourceStart: clip.sourceStart,
      duration: clip.duration,
      offsetSeconds: clip.offsetSeconds,
      trackIndex
    }))).map(({ buffer, fileName, sourceStart, duration, relTime, relTrack }) => ({
      buffer,
      fileName,
      sourceStart,
      duration,
      relTime,
      relTrack
    })))
    return items.length
  }

  const copyClipToClipboard = (clip: Clip, trackIndex = 0) => {
    setClipboard(packClipboard([{
      buffer: clip.buffer,
      fileName: clip.fileName,
      sourceStart: clip.sourceStart,
      duration: clip.duration,
      offsetSeconds: clip.offsetSeconds,
      trackIndex
    }]).map(({ buffer, fileName, sourceStart, duration, relTime, relTrack }) => ({
      buffer,
      fileName,
      sourceStart,
      duration,
      relTime,
      relTrack
    })))
  }

  const showClipToast = (message: string) => {
    setToastMessage(message)
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const pasteClipAt = async (trackIndex: number, timeSeconds: number) => {
    if (!clipboard || clipboard.length === 0) {
      setErrorMessage('No hay clip copiado')
      setTimeout(() => setErrorMessage(null), 2000)
      return
    }
    
    await ensureAudio()
    saveUndo()
    const originTime = snapEnabled ? snapToGrid(timeSeconds) : timeSeconds
    const newTrackStates = trackStates.map(track => ({ ...track, clips: [...track.clips] }))
    const newIds = new Set<string>()

    clipboard.forEach((item, i) => {
      const place = pastePlacement(item.relTime, item.relTrack, originTime, trackIndex, trackStates.length)
      const player = makeClipPlayer()
      player.buffer = new Tone.ToneAudioBuffer(item.buffer)
      player.loop = false
      player.connect(trackGainsRef.current[place.trackIndex])
      const newClip: Clip = {
        player,
        fileName: item.fileName,
        isPlaying: false,
        buffer: item.buffer,
        startPosition: 0,
        offsetSeconds: place.offsetSeconds,
        id: `clip-${Date.now()}-${i}-${Math.random()}`,
        sourceStart: item.sourceStart,
        duration: item.duration
      }
      newTrackStates[place.trackIndex].clips.push(newClip)
      newIds.add(newClip.id)
    })

    setTrackStates(newTrackStates)
    setSelectedClipIds(newIds)
    showClipToast(clipboard.length > 1 ? `${clipboard.length} clips pegados` : 'Clip pegado')
  }

  const handlePasteClip = async (trackIndex: number) => {
    await pasteClipAt(trackIndex, playheadPositionRef.current)
  }

  const deleteClipById = (clipId: string) => {
    saveUndo()
    const newTrackStates = trackStates.map(track => ({
      ...track,
      clips: track.clips.filter(clip => {
        if (clip.id === clipId) {
          clip.player.dispose()
          return false
        }
        return true
      })
    }))
    setTrackStates(newTrackStates)
    setSelectedClipIds(prev => {
      const next = new Set(prev)
      next.delete(clipId)
      return next
    })
  }

  const cutClip = (clip: Clip) => {
    copyClipToClipboard(clip)
    deleteClipById(clip.id)
    showClipToast('Clip cortado')
  }

  const duplicateClipOnTrack = (trackIndex: number, clip: Clip) => {
    saveUndo()
    const player = makeClipPlayer()
    player.buffer = clip.player.buffer
    player.loop = false
    player.connect(trackGainsRef.current[trackIndex])
    
    const newClip: Clip = {
      player,
      fileName: clip.fileName,
      isPlaying: false,
      buffer: clip.buffer,
      startPosition: clip.startPosition,
      offsetSeconds: clip.offsetSeconds + clip.duration,
      id: `clip-${Date.now()}-${Math.random()}`,
      sourceStart: clip.sourceStart,
      duration: clip.duration
    }
    
    const newTrackStates = [...trackStates]
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: [...newTrackStates[trackIndex].clips, newClip]
    }
    setTrackStates(newTrackStates)
    setSelectedClipIds(new Set([newClip.id]))
    showClipToast('Clip duplicado')
  }

  const closeContextMenu = () => setContextMenu(null)

  const openContextMenu = (e: React.MouseEvent, trackIndex: number, clipId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    const trackEl = (e.currentTarget.closest('.track-content') as HTMLElement) || (e.currentTarget as HTMLElement)
    const rect = trackEl.getBoundingClientRect()
    const percentage = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
    const maxDur = getMaxDuration() || 100
    const time = Math.max(0, percentage * maxDur)
    if (clipId && !selectedClipIds.has(clipId)) {
      setSelectedClipIds(new Set([clipId]))
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      trackIndex,
      clipId,
      time,
      kind: 'timeline'
    })
  }

  const runContextMenuAction = async (action: string) => {
    if (!contextMenu) return
    const { trackIndex, clipId, time } = contextMenu
    closeContextMenu()
    const clip = clipId
      ? trackStates[trackIndex]?.clips.find(c => c.id === clipId)
      : undefined

    if (action === 'paste') {
      await pasteClipAt(trackIndex, time)
      return
    }
    if (action === 'cut') {
      const n = selectedClipIds.size || (clip ? 1 : 0)
      if (selectedClipIds.size > 0) {
        copySelectedClips()
        handleDeleteSelected(`${n > 1 ? n + ' clips cortados' : 'Clip cortado'}`)
      } else if (clip) {
        cutClip(clip)
      }
      return
    }
    if (action === 'copy') {
      const n = selectedClipIds.size > 0 ? copySelectedClips() : 0
      if (n === 0 && clip) {
        copyClipToClipboard(clip, trackIndex)
        showClipToast('Clip copiado')
      } else if (n > 0) {
        showClipToast(n > 1 ? `${n} clips copiados` : 'Clip copiado')
      }
      return
    }
    if (action === 'duplicate') {
      if (selectedClipIds.size > 0) handleDuplicateSelected()
      else if (clip) duplicateClipOnTrack(trackIndex, clip)
      return
    }
    if (action === 'delete') {
      if (selectedClipIds.size > 0) handleDeleteSelected()
      else if (clip) {
        deleteClipById(clip.id)
        showClipToast('Clip eliminado')
      }
      return
    }
    if (!clip) return

    if (action === 'split') {
      const splitTime = snapEnabled ? snapToGrid(time) : time
      if (splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration) {
        await splitClipAt(trackIndex, splitTime)
      }
    }
  }

  const handleClipClick = (e: React.MouseEvent, trackIndex: number, clipId: string) => {
    e.stopPropagation()
    if (!isClickGesture(dragLiveRef.current.distance)) return
    
    const clip = trackStates[trackIndex].clips.find(c => c.id === clipId)
    if (!clip) return
    
    if (e.altKey && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const percentage = clickX / rect.width
      const clipTime = clip.offsetSeconds + (percentage * clip.duration)
      const splitTime = snapEnabled && !e.shiftKey ? snapToGrid(clipTime) : clipTime
      
      if (splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration) {
        splitClipAt(trackIndex, splitTime)
      }
      return
    }

    const cmd = e.ctrlKey || e.metaKey
    if (cmd) {
      setSelectedClipIds(prev => mergeSelection(prev, [clipId], 'toggle'))
    } else if (e.shiftKey) {
      setSelectedClipIds(prev => mergeSelection(prev, [clipId], 'add'))
    } else {
      setSelectedClipIds(new Set([clipId]))
      if (!(e.target as HTMLElement).closest('.clip-trim-handle')) {
        const lane = (e.currentTarget as HTMLElement).closest('.track-content') as HTMLElement | null
        if (lane) {
          const rect = lane.getBoundingClientRect()
          const raw = clickTimeFromX(e.clientX, rect.left, rect.width, timelineMaxRef.current || 100)
          seekToPositionRef.current(raw, false)
        }
      }
    }
    isDraggingClipRef.current = false
  }

  const handleClipDragStart = (e: React.MouseEvent, trackIndex: number, clipId: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    if (trimLiveRef.current?.active) return

    const tracks = trackStatesRef.current
    const clip = tracks[trackIndex]?.clips.find(c => c.id === clipId)
    if (!clip) return

    let selected = selectedClipIdsRef.current
    if (!selected.has(clipId)) {
      const cmd = e.ctrlKey || e.metaKey
      selected = (e.shiftKey || cmd) ? new Set(selected).add(clipId) : new Set([clipId])
      setSelectedClipIds(selected)
    }

    const startX = e.clientX
    const startY = e.clientY
    const startOffset = clip.offsetSeconds
    const startTrack = trackIndex
    const startedWithAlt = e.altKey
    const zoom = verticalZoom
    const snapOn = snapEnabled

    let minOffset = Infinity
    let minTrack = Infinity
    let maxTrack = -Infinity
    tracks.forEach((track, ti) => {
      track.clips.forEach(c => {
        if (!selected.has(c.id)) return
        minOffset = Math.min(minOffset, c.offsetSeconds)
        minTrack = Math.min(minTrack, ti)
        maxTrack = Math.max(maxTrack, ti)
      })
    })
    if (minOffset === Infinity) minOffset = startOffset
    if (minTrack === Infinity) minTrack = startTrack
    if (maxTrack === -Infinity) maxTrack = startTrack

    isDraggingClipRef.current = true
    dragLiveRef.current = {
      tempOffset: startOffset,
      tempTrack: startTrack,
      threshold: startedWithAlt,
      distance: 0,
      timeDelta: 0,
      trackDelta: 0,
      minOffset,
      minTrack,
      maxTrack
    }

    const clearGroupDragPreview = () => {
      document.querySelectorAll('.clip-wrapper[data-clip-id]').forEach(node => {
        const el = node as HTMLElement
        el.style.transform = ''
        el.style.zIndex = ''
        el.style.willChange = ''
      })
      document.querySelectorAll('.track-content').forEach(node => {
        const el = node as HTMLElement
        el.style.zIndex = ''
        el.style.overflow = ''
      })
    }

    const applyGroupDragPreview = (timeDelta: number, trackDelta: number) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      const laneWidth = (lanes[0] as HTMLElement).getBoundingClientRect().width
      const layoutMax = timelineMaxRef.current || 100
      const trackHeight = 88 * zoom
      const dx = (timeDelta / layoutMax) * laneWidth
      const dy = trackDelta * trackHeight
      const selectedTracks = new Set<number>()
      document.querySelectorAll('.clip-wrapper[data-clip-id]').forEach(node => {
        const el = node as HTMLElement
        const id = el.dataset.clipId
        if (!id || !selected.has(id)) return
        el.style.willChange = 'transform'
        el.style.transform = `translate(${dx}px, ${dy}px)`
        el.style.zIndex = '20'
        const lane = el.closest('.track-content')
        if (lane) {
          const idx = Array.prototype.indexOf.call(lanes, lane)
          if (idx >= 0) selectedTracks.add(idx)
        }
      })
      lanes.forEach((node, i) => {
        const el = node as HTMLElement
        el.style.overflow = 'visible'
        el.style.zIndex = selectedTracks.has(i) ? String(25 + i) : '1'
      })
    }

    const onMove = (ev: MouseEvent) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      const deltaX = ev.clientX - startX
      const deltaY = ev.clientY - startY
      const distance = Math.hypot(deltaX, deltaY)
      const live = dragLiveRef.current
      live.distance = distance
      if (isClickGesture(distance)) return
      if (live.threshold && distance < 5) return

      const firstLane = lanes[0] as HTMLElement
      const rect = firstLane.getBoundingClientRect()
      const deltaTime = deltaTimeFromLanePx(deltaX, rect.width, timelineMaxRef.current || 100)
      const rawOffset = startOffset + deltaTime
      const newOffset = snapActiveDuringDrag(snapOn, ev.shiftKey) ? snapToGrid(rawOffset) : rawOffset
      let timeDelta = clampGroupTimeDelta(live.minOffset, newOffset - startOffset)
      const trackHeight = 88 * zoom
      const rawTrackDelta = Math.round(deltaY / trackHeight)
      const trackDelta = clampGroupTrackDelta(live.minTrack, live.maxTrack, rawTrackDelta, trackStatesRef.current.length)
      live.tempOffset = startOffset + timeDelta
      live.tempTrack = startTrack + trackDelta
      live.timeDelta = timeDelta
      live.trackDelta = trackDelta

      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null
          applyGroupDragPreview(dragLiveRef.current.timeDelta, dragLiveRef.current.trackDelta)
        })
      }
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      const live = dragLiveRef.current
      isDraggingClipRef.current = false
      if (isClickGesture(live.distance) || (live.threshold && live.distance < 5)) {
        clearGroupDragPreview()
        const lane = (ev.target as HTMLElement | null)?.closest?.('.track-content') as HTMLElement | null
          ?? (document.querySelector('.track-content') as HTMLElement | null)
        if (lane && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && isClickGesture(live.distance)) {
          const rect = lane.getBoundingClientRect()
          const raw = clickTimeFromX(ev.clientX, rect.left, rect.width, timelineMaxRef.current || 100)
          seekToPositionRef.current(raw, false)
        }
        return
      }

      const timeDelta = live.timeDelta
      const trackDelta = live.trackDelta
      const currentTracks = trackStatesRef.current
      saveUndo()

      let working = currentTracks
      let workingSelected = selected
      if (startedWithAlt && live.distance >= 5) {
        working = currentTracks.map(track => ({ ...track, clips: [...track.clips] }))
        workingSelected = new Set(selected)
        selected.forEach(id => {
          for (let ti = 0; ti < currentTracks.length; ti++) {
            const sourceClip = currentTracks[ti].clips.find(c => c.id === id)
            if (!sourceClip) continue
            const player = makeClipPlayer()
            player.buffer = sourceClip.player.buffer
            player.loop = false
            player.connect(trackGainsRef.current[ti])
            const newClip: Clip = {
              player,
              fileName: sourceClip.fileName,
              isPlaying: false,
              buffer: sourceClip.buffer,
              startPosition: sourceClip.startPosition,
              offsetSeconds: sourceClip.offsetSeconds + 0.001,
              id: `clip-${Date.now()}-${Math.random()}`,
              sourceStart: sourceClip.sourceStart,
              duration: sourceClip.duration,
              selected: true
            }
            working[ti].clips.push(newClip)
            workingSelected.add(newClip.id)
          }
        })
        setSelectedClipIds(workingSelected)
      }

      const moved: { to: number; clip: Clip }[] = []
      working.forEach((track, ti) => {
        track.clips.forEach(c => {
          if (!workingSelected.has(c.id)) return
          moved.push({
            to: ti + trackDelta,
            clip: { ...c, offsetSeconds: Math.max(0, c.offsetSeconds + timeDelta) }
          })
        })
      })
      const nextTracks = working.map(track => ({
        ...track,
        clips: track.clips.filter(c => !workingSelected.has(c.id))
      }))
      moved.forEach(({ to, clip }) => {
        nextTracks[to].clips.push(clip)
      })
      clearGroupDragPreview()
      setTrackStates(nextTracks)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'move'
  }

  const handleResizeStart = (e: React.MouseEvent, trackIndex: number, clipId: string, edge: ClipTrimEdge) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return

    const clip = trackStatesRef.current[trackIndex]?.clips.find(c => c.id === clipId)
    if (!clip) return

    const wrapper = (e.currentTarget as HTMLElement).closest('.clip-wrapper') as HTMLElement | null
    const waveform = wrapper?.querySelector('[data-waveform-full]') as HTMLElement | null
    const orig: ClipTrimState & { bufferDuration: number } = {
      sourceStart: clip.sourceStart,
      duration: clip.duration,
      offsetSeconds: clip.offsetSeconds,
      bufferDuration: clip.buffer.duration
    }
    trimLiveRef.current = {
      active: true,
      trackIndex,
      clipId,
      edge,
      startX: e.clientX,
      orig,
      next: { sourceStart: orig.sourceStart, duration: orig.duration, offsetSeconds: orig.offsetSeconds },
      wrapper,
      waveform
    }
    dragLiveRef.current.distance = 0

    const onMove = (ev: MouseEvent) => {
      const live = trimLiveRef.current
      if (!live?.active) return
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      const laneWidth = (lanes[0] as HTMLElement).getBoundingClientRect().width
      const deltaTime = deltaTimeFromLanePx(ev.clientX - live.startX, laneWidth, timelineMaxRef.current || 100)
      dragLiveRef.current.distance = Math.max(dragLiveRef.current.distance, Math.abs(ev.clientX - live.startX))
      const next = applyClipTrim(live.edge, deltaTime, live.orig)
      live.next = next
      if (resizeRafRef.current == null) {
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null
          const current = trimLiveRef.current
          if (!current?.active || !current.wrapper) return
          applyTrimPreviewStyles(
            current.wrapper,
            current.waveform,
            current.next,
            current.orig.bufferDuration,
            timelineMaxRef.current || 100
          )
        })
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      const live = trimLiveRef.current
      trimLiveRef.current = null
      if (!live) return
      if (trimStatesEqual(live.orig, live.next)) return
      saveUndo()
      const { trackIndex: ti, clipId: id, next } = live
      setTrackStates(prev => prev.map((track, i) => {
        if (i !== ti) return track
        return {
          ...track,
          clips: track.clips.map(c => c.id !== id ? c : { ...c, ...next })
        }
      }))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
  }

  const handleDeleteSelected = (toast?: string) => {
    if (selectedClipIds.size === 0) return
    const n = selectedClipIds.size
    
    saveUndo()
    const newTrackStates = trackStates.map(track => ({
      ...track,
      clips: track.clips.filter(clip => {
        if (selectedClipIds.has(clip.id)) {
          clip.player.dispose()
          return false
        }
        return true
      })
    }))
    setTrackStates(newTrackStates)
    setSelectedClipIds(new Set())
    showClipToast(toast ?? (n > 1 ? `${n} clips eliminados` : 'Clip eliminado'))
  }

  const handleDuplicateSelected = () => {
    if (selectedClipIds.size === 0) return
    
    saveUndo()
    const newTrackStates = [...trackStates]
    const newSelectedIds = new Set<string>()
    
    selectedClipIds.forEach(id => {
      for (let ti = 0; ti < trackStates.length; ti++) {
        const sourceClip = trackStates[ti].clips.find(c => c.id === id)
        if (sourceClip) {
          const player = makeClipPlayer()
          player.buffer = sourceClip.player.buffer
          player.loop = false
          player.connect(trackGainsRef.current[ti])
          
          const newClip: Clip = {
            player,
            fileName: sourceClip.fileName,
            isPlaying: false,
            buffer: sourceClip.buffer,
            startPosition: sourceClip.startPosition,
            offsetSeconds: sourceClip.offsetSeconds + sourceClip.duration,
            id: `clip-${Date.now()}-${Math.random()}`,
            sourceStart: sourceClip.sourceStart,
            duration: sourceClip.duration
          }
          newTrackStates[ti].clips.push(newClip)
          newSelectedIds.add(newClip.id)
        }
      }
    })
    
    setTrackStates(newTrackStates)
    setSelectedClipIds(newSelectedIds)
    showClipToast(newSelectedIds.size > 1 ? `${newSelectedIds.size} clips duplicados` : 'Clip duplicado')
  }



  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
      
      if (e.key === 'Escape') {
        e.preventDefault()
        if (trackDeleteConfirm) {
          setTrackDeleteConfirm(null)
        } else if (contextMenu) {
          closeContextMenu()
        } else if (selectedClipIds.size > 0) {
          setSelectedClipIds(new Set())
        } else if (selectedAutoPoint) {
          setSelectedAutoPoint(null)
        }
        return
      }
      if (e.key === 's' && cmdOrCtrl && e.shiftKey) {
        e.preventDefault()
        handleSaveToLocal(true)
      } else if (e.key === 's' && cmdOrCtrl) {
        e.preventDefault()
        handleSaveToLocal(false)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAutoPoint) {
        e.preventDefault()
        const { trackIndex, paramId, index } = selectedAutoPoint
        const track = trackStatesRef.current[trackIndex]
        const lane = laneForParam(track?.automation, paramId)
        if (track && lane && index >= 0 && index < lane.points.length) {
          saveUndo()
          const nextPoints = lane.points.filter((_, i) => i !== index)
          writeTrackAutomation(trackIndex, paramId, nextPoints, true)
          setSelectedAutoPoint(null)
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.size > 0) {
        e.preventDefault()
        handleDeleteSelected()
      } else if (e.key === 's' && !cmdOrCtrl && !e.shiftKey) {
        e.preventDefault()
        const head = playheadPositionRef.current
        const trackWithClip = trackStates.findIndex(t => t.clips.some(c => 
          head >= c.offsetSeconds && head < c.offsetSeconds + c.duration
        ))
        if (trackWithClip !== -1) {
          handleSplitClip(trackWithClip)
        }
      } else if (e.key === 'e' && cmdOrCtrl && selectedClipIds.size === 0) {
        e.preventDefault()
        const head = playheadPositionRef.current
        const trackWithClip = trackStates.findIndex(t => t.clips.some(c => 
          head >= c.offsetSeconds && head < c.offsetSeconds + c.duration
        ))
        if (trackWithClip !== -1) {
          handleSplitClip(trackWithClip)
        }
      } else if (e.key === 'x' && cmdOrCtrl && selectedClipIds.size > 0) {
        e.preventDefault()
        const n = selectedClipIds.size
        copySelectedClips()
        handleDeleteSelected(n > 1 ? `${n} clips cortados` : 'Clip cortado')
      } else if (e.key === 'c' && cmdOrCtrl && selectedClipIds.size > 0) {
        e.preventDefault()
        const n = copySelectedClips()
        showClipToast(n > 1 ? `${n} clips copiados` : 'Clip copiado')
      } else if (e.key === 'v' && cmdOrCtrl && clipboard && clipboard.length > 0) {
        e.preventDefault()
        const targetTrack = trackStates.findIndex(t => t.clips.some(c => selectedClipIds.has(c.id)))
        if (targetTrack !== -1) {
          handlePasteClip(targetTrack)
        } else {
          handlePasteClip(0)
        }
      } else if (e.key === 'd' && cmdOrCtrl && selectedClipIds.size > 0) {
        e.preventDefault()
        handleDuplicateSelected()
      } else if (e.key === 'z' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.key === 'z' && cmdOrCtrl && e.shiftKey) || (e.key === 'y' && cmdOrCtrl)) {
        e.preventDefault()
        handleRedo()
      } else if (e.key === 'a' && cmdOrCtrl) {
        e.preventDefault()
        const allClipIds = new Set(trackStates.flatMap(t => t.clips.map(c => c.id)))
        setSelectedClipIds(allClipIds)
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedClipIds, trackStates, clipboard, undoStack, redoStack, contextMenu, trackDeleteConfirm, selectedAutoPoint])

  useEffect(() => {
    const mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    clearMediaSessionHandlers(mediaSession)
    const onSpace = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return
      const decision = spacePlaybackDecision(e, {
        modalHasTextField: modalHasTextField(document),
        pageHasFocus: pageHasPlaybackFocus(document)
      })
      if (decision === 'ignore') return
      e.preventDefault()
      if (typeof e.stopPropagation === 'function') e.stopPropagation()
      if (e.type !== 'keydown' || decision !== 'toggle') return
      const action = spaceToggleAction(
        isRecordingRef.current,
        Tone.getTransport().state === 'started'
      )
      if (action === 'stop-record') void stopRecordingRef.current({ then: 'stop' })
      else if (action === 'pause') handlePauseRef.current()
      else void handlePlayRef.current()
    }
    const blurButtons = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      const button = target.closest('button')
      if (button instanceof HTMLButtonElement) button.blur()
    }
    document.addEventListener('keydown', onSpace, true)
    document.addEventListener('keyup', onSpace, true)
    document.addEventListener('mouseup', blurButtons, true)
    return () => {
      document.removeEventListener('keydown', onSpace, true)
      document.removeEventListener('keyup', onSpace, true)
      document.removeEventListener('mouseup', blurButtons, true)
    }
  }, [])

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value) || 120
    setBpm(newBpm)
    Tone.getTransport().bpm.value = effectiveBpm(newBpm, tempoRateRef.current)
  }

  const handleLaneClick = async (trackIndex: number) => {
    const track = trackStates[trackIndex]

    if (track.clips.length > 0) {
      // If track has clips, do nothing on empty space click
      return
    } else {
      setSelectedTrack(trackIndex)
      fileInputRef.current?.click()
    }
  }

  const highlightDropTrack = (index: number | null) => {
    if (highlightedDropTrackRef.current === index) return
    document.querySelectorAll('.track-content.drop-target').forEach((el) => {
      el.classList.remove('drop-target')
    })
    if (index != null) {
      document.querySelector(`.track-content[data-track-index="${index}"]`)?.classList.add('drop-target')
    }
    highlightedDropTrackRef.current = index
  }

  const clearFileDrag = () => {
    fileDragDepthRef.current = 0
    setFileDragActive(false)
    highlightDropTrack(null)
  }

  const beginImportUndo = () => {
    if (importUndoSavedRef.current) return
    saveUndo()
    importUndoSavedRef.current = true
  }

  const finishImportBatchIfIdle = () => {
    if (importQueueRef.current.length === 0 && !pendingFileRef.current) {
      importUndoSavedRef.current = false
    }
  }

  const appendTracksForImport = (count: number) => {
    if (count <= 0) return
    beginImportUndo()
    const next = [...trackStatesRef.current]
    for (let i = 0; i < count; i++) {
      next.push({
        ...createEmptyTrack(nextPistaName(next.map(t => t.name), next.length)),
        clips: [] as Clip[]
      })
    }
    ensureTrackGains(next.length)
    trackStatesRef.current = next
    setTrackStates(next)
  }

  const processNextImport = async () => {
    if (pendingFileRef.current) return
    const next = importQueueRef.current.shift()
    if (!next) {
      finishImportBatchIfIdle()
      return
    }
    beginImportUndo()
    let trackIndex = next.trackIndex
    if (next.createNew) {
      appendTracksForImport(1)
      trackIndex = trackStatesRef.current.length - 1
    }
    setSelectedTrack(trackIndex)
    pendingOffsetRef.current = next.offsetSeconds
    const { supported, reason } = isStemSeparationSupported()
    if (!supported) {
      console.warn('Stem separation not supported:', reason)
      await loadSingleTrack(next.file, trackIndex, next.offsetSeconds)
      setSelectedTrack(null)
      void processNextImport()
      return
    }
    pendingFileRef.current = next.file
    setShowStemDialog(true)
  }

  const enqueueAudioImports = (
    files: File[],
    hoverTrackIndex: number | null,
    offsetSeconds: number
  ) => {
    if (files.length === 0) return
    const placements = resolveDropPlacement(files.length, hoverTrackIndex, trackStatesRef.current.length)
    importQueueRef.current.push(...files.map((file, i) => ({
      file,
      trackIndex: placements[i].trackIndex,
      createNew: placements[i].createNew,
      offsetSeconds
    })))
    void processNextImport()
  }

  const toastIgnoredFiles = (count: number) => {
    const message = ignoredAudioToast(count)
    if (!message) return
    setErrorMessage(message)
    setTimeout(() => setErrorMessage(null), 4000)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    const { audio, ignored } = partitionDroppedFiles(Array.from(list))
    toastIgnoredFiles(ignored.length)
    if (audio.length > 0) {
      enqueueAudioImports(audio, selectedTrack, getCountInSeconds())
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleStemDialogConfirm = async () => {
    setShowStemDialog(false)
    if (!pendingFileRef.current || selectedTrack === null) return

    setIsProcessingStems(true)
    setStemProgress(0)

    const file = pendingFileRef.current
    const track = selectedTrack
    const offset = pendingOffsetRef.current

    try {
      await processStemSeparation(file, track, offset)
    } catch (error) {
      console.error('Stem separation failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      setErrorMessage(`⚠️ Separación de stems no disponible: ${errorMessage}`)
      setTimeout(() => setErrorMessage(null), 5000)
      try {
        await loadSingleTrack(file, track, offset)
        setToastMessage('Audio cargado como pista única')
        setShowToast(true)
        setTimeout(() => setShowToast(false), 3000)
      } catch (loadError) {
        console.error('Failed to load single track:', loadError)
        setErrorMessage('Error al cargar el archivo de audio.')
        setTimeout(() => setErrorMessage(null), 5000)
      }
    } finally {
      setIsProcessingStems(false)
      stemAbortControllerRef.current = null
      pendingFileRef.current = null
      setSelectedTrack(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      void processNextImport()
    }
  }

  const handleCancelStemSeparation = () => {
    if (stemAbortControllerRef.current) {
      stemAbortControllerRef.current.abort()
    }
    setShowStemDialog(false)
    setIsProcessingStems(false)
    setStemProgress(0)
    if (pendingFileRef.current && selectedTrack !== null) {
      loadSingleTrack(pendingFileRef.current, selectedTrack, pendingOffsetRef.current).catch(console.error)
    }
    pendingFileRef.current = null
    setSelectedTrack(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    void processNextImport()
  }

  const handleStemDialogCancel = async () => {
    setShowStemDialog(false)
    if (!pendingFileRef.current || selectedTrack === null) return
    await loadSingleTrack(pendingFileRef.current, selectedTrack, pendingOffsetRef.current)
    pendingFileRef.current = null
    setSelectedTrack(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    void processNextImport()
  }

  const handleAppDragEnter = (e: React.DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    fileDragDepthRef.current++
    setFileDragActive(true)
  }

  const handleAppDragOver = (e: React.DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    highlightDropTrack(trackIndexFromPoint(e.clientX, e.clientY))
  }

  const handleAppDragLeave = (e: React.DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer.types)) return
    fileDragDepthRef.current--
    if (fileDragDepthRef.current <= 0) clearFileDrag()
  }

  const handleAppDrop = (e: React.DragEvent) => {
    if (!dataTransferHasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    e.stopPropagation()
    const hover = trackIndexFromPoint(e.clientX, e.clientY)
    clearFileDrag()
    const { audio, ignored } = partitionDroppedFiles(Array.from(e.dataTransfer.files || []))
    toastIgnoredFiles(ignored.length)
    if (audio.length === 0) return
    let offset = getCountInSeconds()
    if (hover != null) {
      const lane = document.querySelector(`.track-content[data-track-index="${hover}"]`) as HTMLElement | null
      if (lane) {
        const rect = lane.getBoundingClientRect()
        offset = dropTimeOnLane(
          e.clientX,
          rect.left,
          rect.width,
          timelineMaxRef.current || 100,
          snapEnabled,
          snapToGrid
        )
      }
    }
    enqueueAudioImports(audio, hover, offset)
  }

  const loadSingleTrack = async (file: File, trackIndex: number, offsetSeconds?: number) => {
    await ensureAudio()
    beginImportUndo()
    console.log('[DEBUG] loadSingleTrack: trackIndex=', trackIndex, 'gain exists=', !!trackGainsRef.current[trackIndex])

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[trackIndex]
    if (!trackGain) return
    
    const loader = new Tone.Player()
    console.log('[DEBUG] Before load')
    await loader.load(url)
    console.log('[DEBUG] After load: player.loaded=', loader.loaded, 'duration=', loader.buffer.duration)
    const buffer = loader.buffer.get() as AudioBuffer
    const player = makeClipPlayer(loader.buffer)
    player.loop = false
    applyClipPlayback(player, tempoRateRef.current, pitchRef.current)
    player.connect(trackGain)
    loader.dispose()

    const bpmResult = await detectBPM(buffer)
    if (bpmResult.bpm) {
      console.log('[BPM] Detected:', bpmResult.bpm)
      setBpm(bpmResult.bpm)
      Tone.getTransport().bpm.value = effectiveBpm(bpmResult.bpm, tempoRateRef.current)
      setErrorMessage(`Tempo: ${bpmResult.bpm}`)
      setTimeout(() => setErrorMessage(null), 3000)
    } else {
      console.log('[BPM] Detection failed, keeping current BPM')
      setErrorMessage('No se pudo detectar el tempo')
      setTimeout(() => setErrorMessage(null), 3000)
    }

    const newClip: Clip = {
      player,
      fileName: file.name,
      isPlaying: false,
      buffer,
      startPosition: 0,
      offsetSeconds: offsetSeconds ?? getCountInSeconds(),
      id: `clip-${Date.now()}-${Math.random()}`,
      sourceStart: 0,
      duration: buffer.duration
    }

    const newTrackStates = [...trackStatesRef.current]
    if (!newTrackStates[trackIndex]) return
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: [...newTrackStates[trackIndex].clips, newClip]
    }
    trackStatesRef.current = newTrackStates
    setTrackStates(newTrackStates)
  }

  const processStemSeparation = async (file: File, startTrackIndex: number, offsetSeconds?: number) => {
    await ensureAudio()
    beginImportUndo()

    const abortController = new AbortController()
    stemAbortControllerRef.current = abortController

    const url = URL.createObjectURL(file)
    const tempPlayer = new Tone.Player()
    await tempPlayer.load(url)
    const originalBuffer = tempPlayer.buffer.get() as AudioBuffer
    tempPlayer.dispose()

    const bpmResult = await detectBPM(originalBuffer)
    if (bpmResult.bpm) {
      console.log('[BPM] Detected:', bpmResult.bpm)
      setBpm(bpmResult.bpm)
      Tone.getTransport().bpm.value = effectiveBpm(bpmResult.bpm, tempoRateRef.current)
      setErrorMessage(`Tempo: ${bpmResult.bpm}`)
      setTimeout(() => setErrorMessage(null), 3000)
    } else {
      console.log('[BPM] Detection failed, keeping current BPM')
      setErrorMessage('No se pudo detectar el tempo')
      setTimeout(() => setErrorMessage(null), 3000)
    }

    const stems = await separateStems(originalBuffer, (progress) => {
      setStemProgress(progress.progress)
    }, abortController.signal)

    const stemNames = ['Vocals', 'Drums', 'Bass', 'Other']
    const stemBuffers = [stems.vocals, stems.drums, stems.bass, stems.other]
    
    console.log('Stem amplitude check:')
    stemBuffers.forEach((buffer, i) => {
      const data = buffer.getChannelData(0)
      let peak = 0
      let rms = 0
      for (let j = 0; j < data.length; j++) {
        peak = Math.max(peak, Math.abs(data[j]))
        rms += data[j] * data[j]
      }
      rms = Math.sqrt(rms / data.length)
      console.log(`  ${stemNames[i]}: peak=${peak.toFixed(4)}, rms=${rms.toFixed(4)}, rms_dB=${(20 * Math.log10(rms)).toFixed(1)}`)
    })
    
    const newTrackStates = [...trackStatesRef.current]
    const needed = startTrackIndex + stemBuffers.length
    while (newTrackStates.length < needed) {
      newTrackStates.push({
        ...createEmptyTrack(nextPistaName(newTrackStates.map(t => t.name), newTrackStates.length)),
        clips: []
      })
    }
    ensureTrackGains(newTrackStates.length)
    const stemOffset = offsetSeconds ?? getCountInSeconds()

    for (let i = 0; i < stemBuffers.length; i++) {
      const targetTrackIndex = startTrackIndex + i

      const player = makeClipPlayer()
      player.loop = false
      
      const toneBuffer = new Tone.ToneAudioBuffer(stemBuffers[i])
      player.buffer = toneBuffer
      
      player.connect(trackGainsRef.current[targetTrackIndex])

      const newClip: Clip = {
        player,
        fileName: `${file.name} - ${stemNames[i]}`,
        isPlaying: false,
        buffer: stemBuffers[i],
        startPosition: 0,
        offsetSeconds: stemOffset,
        id: `clip-${Date.now()}-${i}-${Math.random()}`,
        sourceStart: 0,
        duration: stemBuffers[i].duration
      }

      newTrackStates[targetTrackIndex] = {
        ...newTrackStates[targetTrackIndex],
        name: stemNames[i],
        clips: [...newTrackStates[targetTrackIndex].clips, newClip]
      }
    }

    trackStatesRef.current = newTrackStates
    setTrackStates(newTrackStates)
  }

  const handleMuteToggle = useCallback((trackIndex: number) => {
    setTrackStates(prev => {
      const newStates = [...prev]
      newStates[trackIndex] = {
        ...newStates[trackIndex],
        mute: !newStates[trackIndex].mute
      }
      return newStates
    })
  }, [])

  const handleSoloToggle = useCallback((trackIndex: number) => {
    setTrackStates(prev => {
      const newStates = [...prev]
      newStates[trackIndex] = {
        ...newStates[trackIndex],
        solo: !newStates[trackIndex].solo
      }
      return newStates
    })
  }, [])

  const handlePractice = (trackIndex: number) => {
    const next = togglePractice(trackStatesRef.current, trackIndex, practiceIndexRef.current)
    practiceIndexRef.current = next.practiceIndex
    setPracticeIndex(next.practiceIndex)
    setTrackStates(next.tracks)
    const name = resolveTrackName(next.tracks[trackIndex]?.name, trackIndex)
    showClipToast(next.practiceIndex === trackIndex ? `Practicar encima de ${name}` : 'Práctica desactivada')
  }

  const handleAislar = (trackIndex: number) => {
    const next = toggleAislar(trackStatesRef.current, trackIndex)
    practiceIndexRef.current = next.practiceIndex
    setPracticeIndex(next.practiceIndex)
    setTrackStates(next.tracks)
    const name = resolveTrackName(next.tracks[trackIndex]?.name, trackIndex)
    showClipToast(next.tracks[trackIndex]?.solo ? `Aislar ${name}` : 'Aislar desactivado')
  }

  const handlePracticeFromTransport = () => {
    const idx = resolvePracticeTrack(selectedTrack, recordArmedIndex, trackStatesRef.current.length)
    if (idx == null) {
      showClipToast('Elegí una pista para practicar')
      return
    }
    setSelectedTrack(idx)
    handlePractice(idx)
  }

  const handleAislarFromTransport = () => {
    const idx = resolvePracticeTrack(selectedTrack, recordArmedIndex, trackStatesRef.current.length)
    if (idx == null) {
      showClipToast('Elegí una pista para aislar')
      return
    }
    setSelectedTrack(idx)
    handleAislar(idx)
  }

  const liveRetempo = (nextRate: number, nextPitch: number) => {
    tempoRateRef.current = clampTempoRate(nextRate)
    pitchRef.current = clampPitchSemitones(nextPitch)
    Tone.getTransport().bpm.value = effectiveBpm(bpm, tempoRateRef.current)
    applyAllClipPlayback()
    if (isPlayingRef.current) {
      const song = getSongTime()
      playOriginSongRef.current = song
      playOriginWallRef.current = Tone.now()
      retargetPlayingClips(song)
    }
  }

  const handleTempoRate = (raw: number) => {
    const next = clampTempoRate(raw)
    liveRetempo(next, pitchRef.current)
    setTempoRate(next)
  }

  const handlePitch = (raw: number) => {
    const next = clampPitchSemitones(raw)
    liveRetempo(tempoRateRef.current, next)
    setPitchSemitones(next)
  }

  const handleDetectHarmony = () => {
    const tracks = trackStatesRef.current
    const clips = tracks.flatMap((track, i) => {
      if (harmonySource !== 'mix' && i !== harmonySource) return []
      return track.clips.map((clip) => ({
        buffer: clip.buffer,
        offsetSeconds: clip.offsetSeconds,
        sourceStart: clip.sourceStart,
        duration: clip.duration
      }))
    })
    if (!clips.length) {
      showClipToast('No hay audio para analizar')
      return
    }
    setHarmonyBusy(true)
    window.setTimeout(() => {
      try {
        const result = analyzeHarmony(clips, harmonySource)
        setHarmony(result)
        showClipToast(result ? `Tonalidad: ${result.key.label}` : 'No se detectó tonalidad')
      } catch (err) {
        console.error(err)
        setErrorMessage('No se pudieron detectar acordes')
        setTimeout(() => setErrorMessage(null), 4000)
      } finally {
        setHarmonyBusy(false)
      }
    }, 20)
  }

  const handleVolumeLive = useCallback((trackIndex: number, volume: number) => {
    applyTrackAudioNow(trackIndex, { volume })
  }, [])

  const handleVolumeCommit = useCallback((trackIndex: number, volume: number) => {
    applyTrackAudioNow(trackIndex, { volume })
    setTrackStates(prev => {
      if (!prev[trackIndex] || Math.abs(prev[trackIndex].volume - volume) < 1e-4) return prev
      return prev.map((t, i) => i === trackIndex ? { ...t, volume } : t)
    })
  }, [])

  const handlePanLive = (trackIndex: number, pan: number) => {
    applyTrackAudioNow(trackIndex, { pan })
  }

  const handlePanCommit = (trackIndex: number, pan: number) => {
    applyTrackAudioNow(trackIndex, { pan })
    const track = trackStatesRef.current[trackIndex]
    if (!track || Math.abs((track.pan ?? DEFAULT_PAN) - pan) < 1e-4) return
    saveUndo()
    setTrackStates(prev => prev.map((t, i) => i === trackIndex ? { ...t, pan } : t))
  }

  const handleFxLive = (trackIndex: number, paramId: string, value: number) => {
    const track = trackStatesRef.current[trackIndex]
    if (!track) return
    applyTrackAudioNow(trackIndex, setTrackParam(track, paramId, value))
  }

  const handleFxCommit = (trackIndex: number, paramId: string, value: number) => {
    const current = trackStatesRef.current[trackIndex]
    if (!current) return
    applyTrackAudioNow(trackIndex, setTrackParam(current, paramId, value))
    if (Math.abs(getTrackParam(current, paramId) - value) < 1e-4) return
    saveUndo()
    setTrackStates(prev => prev.map((t, i) => i === trackIndex ? setTrackParam(t, paramId, value) : t))
  }

  const handleFxBypass = (trackIndex: number, section: keyof TrackFxState) => {
    saveUndo()
    setTrackStates(prev => prev.map((track, i) => {
      if (i !== trackIndex) return track
      const fx = hydrateTrackFx(track.fx)
      return {
        ...track,
        fx: {
          ...fx,
          [section]: { ...fx[section], bypass: !fx[section].bypass }
        }
      }
    }))
  }

  const handleFilterType = (trackIndex: number, type: FilterType) => {
    const current = trackStatesRef.current[trackIndex]
    if (!current) return
    const fx = hydrateTrackFx(current.fx)
    if (fx.filter.type === type) return
    saveUndo()
    setTrackStates(prev => prev.map((track, i) => {
      if (i !== trackIndex) return track
      const nextFx = hydrateTrackFx(track.fx)
      return { ...track, fx: { ...nextFx, filter: { ...nextFx.filter, type } } }
    }))
  }

  const toggleFxPanel = useCallback((trackIndex: number) => {
    setFxOpenTracks(prev => prev.includes(trackIndex) ? prev.filter(i => i !== trackIndex) : [...prev, trackIndex])
  }, [])

  const toggleAutoPanel = useCallback((trackIndex: number) => {
    setAutoOpenTracks(prev => {
      const open = prev.includes(trackIndex)
      if (open) {
        setSelectedAutoPoint((sel) => sel?.trackIndex === trackIndex ? null : sel)
        return prev.filter(i => i !== trackIndex)
      }
      setAutoParamByTrack((params) => params[trackIndex] ? params : { ...params, [trackIndex]: 'volume' })
      return [...prev, trackIndex]
    })
  }, [])

  const requestDeleteTrack = (trackIndex: number) => {
    closeContextMenu()
    if (trackIndex < 0 || trackIndex >= trackStates.length) return
    if (trackStates.length <= 1) {
      showClipToast('Debe quedar al menos una pista')
      return
    }
    const track = trackStates[trackIndex]
    const name = resolveTrackName(track.name, trackIndex)
    if (track.clips.length > 0) {
      setTrackDeleteConfirm({ trackIndex, name, clipCount: track.clips.length })
      return
    }
    deleteTrackAt(trackIndex)
  }

  const deleteTrackAt = (trackIndex: number) => {
    const planned = deleteTrackFromList(trackStates, trackIndex, selectedClipIds)
    if (!planned) {
      showClipToast('Debe quedar al menos una pista')
      setTrackDeleteConfirm(null)
      return
    }
    saveUndo()
    const recordingThis = recordLiveRef.current?.trackIndex === trackIndex
    if (recordingThis) {
      void stopRecordingRef.current({ then: 'keep', commit: false })
    } else if (recordLiveRef.current && recordLiveRef.current.trackIndex > trackIndex) {
      recordLiveRef.current.trackIndex -= 1
    }
    const removed = trackStates[trackIndex]
    removed.clips.forEach(clip => {
      if (clip.isPlaying || clip.player.state === 'started') {
        try { clip.player.stop() } catch { /* already stopped */ }
      }
      clip.player.dispose()
    })
    reconnectAllClips(planned.tracks)
    setTrackStates(planned.tracks)
    setPracticeIndex((prev) => {
      const next = prev == null ? prev : prev === trackIndex ? null : prev > trackIndex ? prev - 1 : prev
      practiceIndexRef.current = next
      return next
    })
    setFxOpenTracks(prev => shiftOpenIndices(prev, trackIndex))
    setAutoOpenTracks(prev => shiftOpenIndices(prev, trackIndex))
    setAutoParamByTrack(prev => {
      const next: Record<number, string> = {}
      for (const [key, value] of Object.entries(prev)) {
        const i = Number(key)
        if (i === trackIndex) continue
        next[i > trackIndex ? i - 1 : i] = value
      }
      return next
    })
    setSelectedAutoPoint((sel) => {
      if (!sel) return sel
      if (sel.trackIndex === trackIndex) return null
      if (sel.trackIndex > trackIndex) return { ...sel, trackIndex: sel.trackIndex - 1 }
      return sel
    })
    setSelectedClipIds(planned.selectedIds)
    if (selectedTrack === trackIndex) setSelectedTrack(null)
    else if (selectedTrack !== null && selectedTrack > trackIndex) setSelectedTrack(selectedTrack - 1)
    setRecordArmedIndex((prev) => armedIndexAfterDelete(prev, trackIndex))
    if (recordingTrackIndex != null) {
      if (recordingThis) setRecordingTrackIndex(null)
      else if (recordingTrackIndex > trackIndex) setRecordingTrackIndex(recordingTrackIndex - 1)
    }
    setTrackDeleteConfirm(null)
    showClipToast('Pista eliminada')
  }

  const addEmptyTrack = () => {
    closeContextMenu()
    saveUndo()
    const next = appendEmptyTrack(trackStatesRef.current, (name) => ({
      ...createEmptyTrack(name),
      clips: [] as Clip[]
    }))
    ensureTrackGains(next.length)
    setTrackStates(next)
    showClipToast('Pista agregada')
    return next.length - 1
  }

  const syncVerticalScroll = (source: 'sidebar' | 'lanes') => {
    if (syncingVerticalScroll.current) return
    const from = source === 'sidebar' ? sidebarScrollRef.current : lanesScrollRef.current
    const to = source === 'sidebar' ? lanesScrollRef.current : sidebarScrollRef.current
    if (!from || !to || to.scrollTop === from.scrollTop) return
    syncingVerticalScroll.current = true
    to.scrollTop = from.scrollTop
    requestAnimationFrame(() => {
      syncingVerticalScroll.current = false
    })
  }

  const openTrackHeaderMenu = (e: React.MouseEvent, trackIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      trackIndex,
      clipId: null,
      time: 0,
      kind: 'header'
    })
  }

  const startRenameTrack = (trackIndex: number) => {
    closeContextMenu()
    renamingTrackRef.current = trackIndex
    setRenamingTrack(trackIndex)
    setRenameDraft(resolveTrackName(trackStates[trackIndex]?.name, trackIndex))
  }

  const cancelRenameTrack = () => {
    renamingTrackRef.current = null
    setRenamingTrack(null)
    setRenameDraft('')
  }

  const commitRenameTrack = (trackIndex: number, raw: string) => {
    if (renamingTrackRef.current !== trackIndex) return
    renamingTrackRef.current = null
    const previous = resolveTrackName(trackStates[trackIndex]?.name, trackIndex)
    const next = commitEditedTrackName(raw, previous)
    setRenamingTrack(null)
    setRenameDraft('')
    if (next === (trackStates[trackIndex]?.name ?? previous)) return
    saveUndo()
    setTrackStates(prev => prev.map((track, i) => (
      i === trackIndex ? { ...track, name: next } : track
    )))
  }

  const timeFromClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return clickTimeFromX(clientX, rect.left, rect.width, timelineMaxRef.current || 100)
  }

  const seekToPosition = (seconds: number, shiftKey = false) => {
    const layoutMax = timelineMaxRef.current || 100
    const clampedSeconds = applySeekSnap(seconds, layoutMax, snapEnabled, shiftKey, snapToGrid)
    commitPlayhead(clampedSeconds)
    Tone.getTransport().seconds = clampedSeconds
    playOriginSongRef.current = clampedSeconds
    playOriginWallRef.current = Tone.now()
    if (isPlayingRef.current) retargetPlayingClips(clampedSeconds)
  }
  seekToPositionRef.current = seekToPosition

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('.clip-wrapper, .clip-trim-handle, .loop-marker')) return
    if (isDraggingLoop || isDraggingLoopEdge || isDraggingClipRef.current) return
    if (marqueeLiveRef.current.didDrag) return
    seekToPosition(timeFromClientX(e.clientX, e.currentTarget), e.shiftKey)
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedClipIds(new Set())
    }
  }

  const handleLaneDoubleClick = (trackIndex: number) => {
    if (trackStates[trackIndex].clips.length === 0) {
      void handleLaneClick(trackIndex)
    }
  }

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    seekToPosition(timeFromClientX(e.clientX, e.currentTarget), e.shiftKey)
  }

  const handleTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.clip-wrapper, .clip-trim-handle, .loop-marker')) return
    if (isLoopEnabled && target.closest('.clip-region')) return

    const scroller = lanesColumnRef.current?.querySelector('.lanes-scroll-content') as HTMLElement | null
    const startX = e.clientX
    const startY = e.clientY
    marqueeLiveRef.current = {
      active: true,
      didDrag: false,
      x0: startX,
      y0: startY,
      x1: startX,
      y1: startY,
      additive: e.shiftKey,
      toggle: e.ctrlKey || e.metaKey
    }

    const updateBox = () => {
      const live = marqueeLiveRef.current
      if (!scroller || !live.active || isClickGesture(Math.hypot(live.x1 - live.x0, live.y1 - live.y0))) {
        setMarqueeBox(null)
        return
      }
      const sr = scroller.getBoundingClientRect()
      const left = Math.min(live.x0, live.x1) - sr.left
      const top = Math.min(live.y0, live.y1) - sr.top
      setMarqueeBox({
        left,
        top,
        width: Math.abs(live.x1 - live.x0),
        height: Math.abs(live.y1 - live.y0)
      })
    }

    const onMove = (ev: MouseEvent) => {
      marqueeLiveRef.current.x1 = ev.clientX
      marqueeLiveRef.current.y1 = ev.clientY
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null
          updateBox()
        })
      }
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      const live = marqueeLiveRef.current
      live.x1 = ev.clientX
      live.y1 = ev.clientY
      live.active = false
      setMarqueeBox(null)
      const distance = Math.hypot(live.x1 - live.x0, live.y1 - live.y0)
      const lane = (ev.target as HTMLElement | null)?.closest?.('.track-content') as HTMLElement | null
        ?? (e.currentTarget as HTMLElement)

      if (isClickGesture(distance)) {
        live.didDrag = false
        if (lane) {
          const rect = lane.getBoundingClientRect()
          const raw = clickTimeFromX(ev.clientX, rect.left, rect.width, timelineMaxRef.current || 100)
          seekToPositionRef.current(raw, ev.shiftKey)
        }
        if (!live.additive && !live.toggle) {
          setSelectedClipIds(new Set())
        }
        return
      }

      live.didDrag = true
      const band = marqueeClientRect(live.x0, live.y0, live.x1, live.y1)
      const hit: string[] = []
      document.querySelectorAll('.clip-wrapper[data-clip-id]').forEach(node => {
        const el = node as HTMLElement
        const id = el.dataset.clipId
        if (!id) return
        const r = el.getBoundingClientRect()
        if (clientRectsIntersect(r, band)) hit.push(id)
      })
      const mode = live.toggle ? 'toggle' : live.additive ? 'add' : 'replace'
      setSelectedClipIds(prev => mergeSelection(prev, hit, mode))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
  }

  const clearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
    setIsLoopEnabled(false)
    setIsDraggingLoop(false)
    setIsDraggingLoopEdge(null)
    setLoopDragStart(null)
    setTempLoopStart(null)
    setTempLoopEnd(null)
    
    // If currently playing, disable Transport loop immediately
    if (isPlaying) {
      Tone.getTransport().loop = false
    }
  }

  const handleLoopToggle = () => {
    if (isLoopEnabled) {
      // Turning loop off - clear the region
      setLoopStart(null)
      setLoopEnd(null)
      setTempLoopStart(null)
      setTempLoopEnd(null)
    }
    setIsLoopEnabled(!isLoopEnabled)
  }

  const handleLoopMouseDown = (e: React.MouseEvent<HTMLDivElement>, edge?: 'start' | 'end') => {
    if (!isLoopEnabled) return

    loopGestureRef.current = { x: e.clientX, y: e.clientY, distance: 0 }
    
    if (edge) {
      e.stopPropagation()
      setIsDraggingLoopEdge(edge)
      setTempLoopStart(loopStart)
      setTempLoopEnd(loopEnd)
    } else {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const percentage = clickX / rect.width
      const clickTime = percentage * (timelineMaxRef.current || 100)
      
      setIsDraggingLoop(true)
      setLoopDragStart(clickTime)
      setTempLoopStart(clickTime)
      setTempLoopEnd(clickTime)
    }
  }

  const handleLoopMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLoopEnabled) return
    if (!isDraggingLoop && !isDraggingLoopEdge) return
    
    const dx = e.clientX - loopGestureRef.current.x
    const dy = e.clientY - loopGestureRef.current.y
    loopGestureRef.current.distance = Math.hypot(dx, dy)

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const currentTime = percentage * (timelineMaxRef.current || 100)
    
    if (isDraggingLoop && loopDragStart !== null) {
      if (currentTime < loopDragStart) {
        setTempLoopStart(currentTime)
        setTempLoopEnd(loopDragStart)
      } else {
        setTempLoopStart(loopDragStart)
        setTempLoopEnd(currentTime)
      }
    } else if (isDraggingLoopEdge === 'start') {
      const currentEnd = tempLoopEnd ?? loopEnd
      if (currentEnd === null || currentTime < currentEnd) {
        setTempLoopStart(currentTime)
      }
    } else if (isDraggingLoopEdge === 'end') {
      const currentStart = tempLoopStart ?? loopStart
      if (currentStart === null || currentTime > currentStart) {
        setTempLoopEnd(currentTime)
      }
    }
  }

  const handleLoopMouseUp = (e?: MouseEvent | React.MouseEvent) => {
    if (e) {
      const dx = e.clientX - loopGestureRef.current.x
      const dy = e.clientY - loopGestureRef.current.y
      loopGestureRef.current.distance = Math.hypot(dx, dy)
    }
    if ((isDraggingLoop || isDraggingLoopEdge) && isClickGesture(loopGestureRef.current.distance)) {
      if (e) {
        const lane = (e.target as HTMLElement | null)?.closest?.('.track-content') as HTMLElement | null
          ?? (document.querySelector('.track-content') as HTMLElement | null)
        if (lane) {
          const rect = lane.getBoundingClientRect()
          const raw = clickTimeFromX(e.clientX, rect.left, rect.width, timelineMaxRef.current || 100)
          seekToPositionRef.current(raw, e.shiftKey)
        }
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          setSelectedClipIds(new Set())
        }
      }
      setTempLoopStart(null)
      setTempLoopEnd(null)
      setIsDraggingLoop(false)
      setIsDraggingLoopEdge(null)
      setLoopDragStart(null)
      loopGestureRef.current.distance = 0
      return
    }
    if (isDraggingLoop || isDraggingLoopEdge) {
      // Commit temporary values to actual state
      if (tempLoopStart !== null) setLoopStart(tempLoopStart)
      if (tempLoopEnd !== null) setLoopEnd(tempLoopEnd)
      setTempLoopStart(null)
      setTempLoopEnd(null)
    }
    setIsDraggingLoop(false)
    setIsDraggingLoopEdge(null)
    setLoopDragStart(null)
    loopGestureRef.current.distance = 0
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      e.preventDefault()
      const newWidth = Math.min(420, Math.max(160, e.clientX))
      setSidebarWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    
    if (isResizing) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const menu = contextMenuRef.current
    const rect = menu.getBoundingClientRect()
    let x = contextMenu.x
    let y = contextMenu.y
    if (x + rect.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - rect.width - 8)
    if (y + rect.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - rect.height - 8)
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => closeContextMenu()
    const onScroll = () => close()
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('wheel', onScroll)
    }
  }, [contextMenu])

  const rulerBars = useMemo(() => {
    const maxDuration = getMaxDuration()
    if (maxDuration === 0) return null
    
    const secondsPerBeat = 60 / bpm
    const beatsPerBar = 4
    const secondsPerBar = secondsPerBeat * beatsPerBar
    const totalBars = Math.ceil(maxDuration / secondsPerBar)
    const bars = []
    
    for (let bar = 0; bar <= totalBars; bar++) {
      const barTime = bar * secondsPerBar
      const position = (barTime / maxDuration) * 100
      
      if (position <= 100) {
        bars.push(
          <div key={bar} className="bar-marker" style={{ left: `${position}%` }}>
            <span className="bar-number">{bar + 1}</span>
          </div>
        )
        
        for (let beat = 1; beat < beatsPerBar; beat++) {
          const beatTime = barTime + beat * secondsPerBeat
          const beatPosition = (beatTime / maxDuration) * 100
          if (beatPosition <= 100) {
            bars.push(
              <div key={`${bar}-${beat}`} className="beat-marker" style={{ left: `${beatPosition}%` }} />
            )
          }
        }
      }
    }
    
    return bars
  }, [bpm, trackStates])

  return (
    <div
      className={`app${fileDragActive ? ' file-drag' : ''}`}
      data-app-commits={appCommitCountRef.current}
      onDragEnter={handleAppDragEnter}
      onDragOver={handleAppDragOver}
      onDragLeave={handleAppDragLeave}
      onDrop={handleAppDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mpeg,audio/mp3,audio/ogg,audio/webm,audio/flac,audio/aac,audio/x-m4a,.mp3,.wav,.ogg,.m4a,.flac,.aac"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <input
        ref={localFileInputRef}
        type="file"
        accept=".musicalia"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleOpenFromLocal(file)
          }
          if (localFileInputRef.current) {
            localFileInputRef.current.value = ''
          }
        }}
      />
      
      <div className="transport-bar">
        <div className="transport-controls">
          <button className="header-btn icon-only" onClick={handleNewProject} title="Nuevo proyecto" aria-label="Nuevo proyecto">
            <IconFilePlus />
          </button>
          {currentUser ? (
            <button
              className="header-btn"
              onClick={handleLogout}
              title={`Sesión: ${currentUser.username}`}
            >
              <IconLogOut />
              <span className="btn-label">{currentUser.username}</span>
            </button>
          ) : (
            <button
              className="header-btn"
              onClick={() => { setShowAuth(true); setAuthMode('login') }}
              title="Iniciar sesión"
            >
              <IconLogIn />
              <span className="btn-label">Sesión</span>
            </button>
          )}
          <button
            className="header-btn"
            onClick={() => handleSaveToLocal(false)}
            title="Guardar proyecto (Cmd/Ctrl+S, Shift+Cmd/Ctrl+S para guardar como...)"
          >
            <IconSave />
            <span className="btn-label">Guardar</span>
          </button>
          <button
            className="header-btn"
            onClick={() => localFileInputRef.current?.click()}
            title="Abrir proyecto"
          >
            <IconFolderOpen />
            <span className="btn-label">Abrir</span>
          </button>
          <button
            className="header-btn"
            onClick={handleOpenExportDialog}
            title="Exportar pistas seleccionadas"
          >
            <IconDownload />
            <span className="btn-label">Exportar</span>
          </button>
          <button
            className={`header-btn toggle-btn ${snapEnabled ? 'active' : ''}`}
            aria-pressed={snapEnabled}
            onClick={() => {
              setSnapEnabled(prev => {
                const next = !prev
                persistSnapEnabled(next)
                return next
              })
            }}
            title={`Snap ${snapEnabled ? 'ON' : 'OFF'}. Ajuste a cuadrícula (por defecto OFF). Shift invierte el snap mientras arrastras`}
          >
            <IconMagnet />
            <span className="btn-label">Snap {snapEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <button
            className="header-btn"
            onClick={() => setShowHelp(true)}
            title="Atajos de teclado"
          >
            <IconCircleHelp />
            <span className="btn-label">Ayuda</span>
          </button>
        </div>
        <div className="transport-playback" role="group" aria-label="Transporte">
          <button
            className="transport-button icon-btn"
            onClick={handleJumpToStart}
            title="Ir al inicio"
            aria-label="Ir al inicio"
          >
            <IconSkipBack size={15} />
          </button>
          <button
            className={`transport-button icon-btn play-btn ${isPlaying ? 'active' : ''}`}
            onClick={handlePlay}
            disabled={isPlaying || isRecording}
            title="Reproducir"
            aria-label="Reproducir"
          >
            <IconPlay size={14} />
          </button>
          <button
            className="transport-button icon-btn"
            onClick={handlePause}
            disabled={!isPlaying && !isRecording}
            title="Pausar"
            aria-label="Pausar"
          >
            <IconPause size={14} />
          </button>
          <button
            className="transport-button icon-btn"
            onClick={handleStop}
            disabled={!isPlaying && !isPaused && !isRecording}
            title="Detener"
            aria-label="Detener"
          >
            <IconStop size={13} />
          </button>
          <button
            className={`transport-button icon-btn record-btn ${isRecording ? 'active' : ''}`}
            data-testid="record-button"
            data-recording-track={recordingTrackIndex ?? ''}
            onClick={() => { void handleRecord() }}
            title={isRecording ? 'Detener grabación' : 'Grabar'}
            aria-label="Grabar"
            aria-pressed={isRecording}
          >
            <IconRecord size={14} />
          </button>
          {audioInputs.length > 1 && (
            <select
              className="mic-select"
              data-testid="mic-select"
              value={
                audioInputs.some((device) => device.deviceId === micDeviceId)
                  ? micDeviceId ?? ''
                  : (audioInputs[0]?.deviceId ?? '')
              }
              onChange={(e) => handleMicDeviceChange(e.target.value)}
              title="Entrada de audio"
              aria-label="Entrada de audio"
              disabled={isRecording}
            >
              {audioInputs.map((device, index) => (
                <option key={device.deviceId || String(index)} value={device.deviceId}>
                  {device.label || `Micrófono ${index + 1}`}
                </option>
              ))}
            </select>
          )}
          <span className="record-elapsed" ref={recordElapsedRef} data-testid="record-elapsed" />
          <button
            className={`transport-button toggle-btn ${metronomeEnabled ? 'active' : ''}`}
            onClick={() => setMetronomeEnabled(!metronomeEnabled)}
            title="Metrónomo (cuenta 2 compases antes)"
            aria-label="Metrónomo"
            aria-pressed={metronomeEnabled}
          >
            <IconMetronome size={15} />
          </button>
          <button
            className={`transport-button toggle-btn ${isLoopEnabled ? 'active' : ''}`}
            onClick={handleLoopToggle}
            title="Activar loop — arrastra en el timeline para marcar zona"
            aria-label="Loop"
            aria-pressed={isLoopEnabled}
          >
            <IconRepeat size={15} />
          </button>
        </div>
        <div className="transport-meta">
          <div className="time-display">
            <span className="time-label">Time</span>
            <span className="time-value" ref={timeDisplayRef}>
              {formatTime(playheadPosition)} / {formatTime(getMaxDuration())}
            </span>
          </div>
          {isLoopEnabled && (loopStart !== null || loopEnd !== null) && (
            <div className="loop-indicator">
              <span className="loop-label">Loop: {loopStart !== null ? formatTime(loopStart) : '--'} → {loopEnd !== null ? formatTime(loopEnd) : '--'}</span>
              <button className="transport-button clear-loop" onClick={clearLoop} title="Limpiar loop">Limpiar</button>
            </div>
          )}
          <div className="zoom-controls">
            <span className="zoom-label" title="Zoom horizontal (Ctrl+Rueda)"><IconMoveHorizontal size={14} /></span>
            <input
              type="range"
              className="zoom-slider"
              min="0.5"
              max="4"
              step="0.1"
              value={horizontalZoom}
              onChange={(e) => setHorizontalZoom(parseFloat(e.target.value))}
              title={`Zoom horizontal: ${(horizontalZoom * 100).toFixed(0)}%`}
            />
            <span className="zoom-label" title="Zoom vertical (Shift+Rueda)"><IconMoveVertical size={14} /></span>
            <input
              type="range"
              className="zoom-slider"
              min="0.5"
              max="3"
              step="0.1"
              value={verticalZoom}
              onChange={(e) => setVerticalZoom(parseFloat(e.target.value))}
              title={`Zoom vertical: ${(verticalZoom * 100).toFixed(0)}%`}
            />
          </div>
          <div className="practice-transport">
            <button
              type="button"
              className={`header-btn has-label ${practiceIndex != null ? 'active' : ''}`}
              data-testid="practice-transport"
              onClick={handlePracticeFromTransport}
              title="Practicar encima de la pista seleccionada (silencia ese stem)"
            >
              Practicar encima
            </button>
            <button
              type="button"
              className={`header-btn has-label ${
                trackStates.filter((t) => t.solo).length === 1 ? 'active' : ''
              }`}
              data-testid="aislar-transport"
              onClick={handleAislarFromTransport}
              title="Aislar la pista seleccionada"
            >
              Aislar
            </button>
          </div>
          <div className="pitch-tempo-controls">
            <label className="pt-field" title="Tono global, ±12 semitonos">
              <span>Tono</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={pitchSemitones}
                onChange={(e) => handlePitch(parseInt(e.target.value, 10))}
                aria-label="Tono en semitonos"
              />
              <span className="pt-value">{pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones}</span>
            </label>
            <label className="pt-field" title="Velocidad 0.5x–1.5x (GrainPlayer)">
              <span>Vel.</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={tempoRate}
                onChange={(e) => handleTempoRate(parseFloat(e.target.value))}
                aria-label="Velocidad de reproducción"
              />
              <span className="pt-value">{tempoRate.toFixed(2)}x</span>
            </label>
          </div>
          <div className="bpm-control">
            <span className="bpm-label">BPM</span>
            <input
              type="number"
              className="bpm-input"
              value={bpm}
              onChange={handleBpmChange}
              min="20"
              max="300"
            />
            {Math.abs(tempoRate - 1) > 0.001 && (
              <span className="bpm-effective" title="BPM que suena con la velocidad actual">
                → {effectiveBpm(bpm, tempoRate)}
              </span>
            )}
          </div>
          <div className="harmony-controls">
            {harmony?.key.label && (
              <span className="key-badge" title="Tonalidad detectada">{harmony.key.label}</span>
            )}
            <select
              className="harmony-source"
              value={harmonySource === 'mix' ? 'mix' : String(harmonySource)}
              onChange={(e) => {
                const v = e.target.value
                setHarmonySource(v === 'mix' ? 'mix' : parseInt(v, 10))
              }}
              aria-label="Fuente de análisis de acordes"
            >
              <option value="mix">Mezcla</option>
              {trackStates.map((track, i) => (
                <option key={i} value={i}>{resolveTrackName(track.name, i)}</option>
              ))}
            </select>
            <button
              type="button"
              className="header-btn has-label"
              data-testid="detect-harmony"
              disabled={harmonyBusy}
              onClick={handleDetectHarmony}
              title="Detectar tonalidad y acordes (chroma, en el navegador)"
            >
              {harmonyBusy ? 'Analizando…' : 'Detectar acordes'}
            </button>
          </div>
        </div>
        <div className="header-info">
          <div className="audio-diagnostics">
            <span title="Context State">{Tone.getContext().state}</span>
            <span title="Sample Rate">{Tone.getContext().sampleRate}Hz</span>
            <span ref={meterDisplayRef} title="Output Level" className="level-inactive">
              -∞
            </span>
            <button className="test-tone-btn" onClick={playTestTone} title="Test Tone (440Hz)" aria-label="Tono de prueba">
              <IconVolume2 size={13} />
            </button>
          </div>
          <div className="version-badge">
            <span className="version-label">v{APP_VERSION}</span>
          </div>
        </div>
      </div>

      {fileDragActive && (
        <div className="drop-overlay" data-testid="drop-overlay">
          <span>Soltá archivos de audio</span>
        </div>
      )}

      {showStemDialog && (
        <StemSplitDialog
          onConfirm={handleStemDialogConfirm}
          onCancel={handleStemDialogCancel}
        />
      )}

      {isProcessingStems && (
        <StemSplitProgress progress={stemProgress} onCancel={handleCancelStemSeparation} />
      )}
      
      {showToast && toastMessage && (
        <div className="toast">✓ {toastMessage}</div>
      )}
      
      {errorMessage && (
        <div className="error-toast">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}
      
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="upload-progress">
          <div className="upload-bar" style={{ width: `${uploadProgress}%` }}></div>
          <span>{uploadProgress}% subiendo...</span>
        </div>
      )}
      
      {showExportDialog && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Exportar proyecto</h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '16px' }}>
              Configura las opciones de exportación
            </p>
            
            <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2a', borderRadius: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportMixed}
                  onChange={(e) => setExportMixed(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span>Mezclar todo en un archivo (en vez de pistas separadas)</span>
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportIncludeCountIn}
                  onChange={(e) => setExportIncludeCountIn(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span>Incluir metrónomo de entrada (2 compases)</span>
              </label>
            </div>
            
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '12px' }}>
              Selecciona las pistas a incluir
            </p>
            <div className="export-tracks-list">
              {trackStates.map((track, i) => (
                track.clips.length > 0 && (
                  <label key={i} className="export-track-item">
                    <input
                      type="checkbox"
                      checked={exportTracks[i] || false}
                      onChange={(e) => {
                        const newTracks = [...exportTracks]
                        newTracks[i] = e.target.checked
                        setExportTracks(newTracks)
                      }}
                    />
                    <span className="track-name">{track.name}</span>
                    {track.solo && <span className="track-badge solo">S</span>}
                    {track.mute && <span className="track-badge mute">M</span>}
                  </label>
                )
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowExportDialog(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleExport}>Exportar</button>
            </div>
          </div>
        </div>
      )}

      {showAuth && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
            {authMode === 'login' ? (
              <form onSubmit={(e) => {
                e.preventDefault()
                if (authLoading) return
                const formData = new FormData(e.currentTarget)
                handleLogin(
                  formData.get('email') as string,
                  formData.get('password') as string
                )
              }}>
                <div className="modal-stack">
                  <input
                    type="email"
                    name="email"
                    className="field-input"
                    placeholder="Email"
                    required
                    disabled={authLoading}
                  />
                  <input
                    type="password"
                    name="password"
                    className="field-input"
                    placeholder="Contraseña"
                    required
                    disabled={authLoading}
                  />
                  <button type="submit" className="btn btn-primary" disabled={authLoading}>
                    {authLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => { setAuthMode('register'); setErrorMessage(null) }}
                    disabled={authLoading}
                  >
                    ¿No tienes cuenta? Crear una
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={(e) => {
                e.preventDefault()
                if (authLoading) return
                const formData = new FormData(e.currentTarget)
                handleRegister(
                  formData.get('username') as string,
                  formData.get('email') as string,
                  formData.get('password') as string
                )
              }}>
                <div className="modal-stack">
                  <input
                    type="text"
                    name="username"
                    className="field-input"
                    placeholder="Usuario"
                    required
                    minLength={3}
                    disabled={authLoading}
                  />
                  <input
                    type="email"
                    name="email"
                    className="field-input"
                    placeholder="Email"
                    required
                    disabled={authLoading}
                  />
                  <input
                    type="password"
                    name="password"
                    className="field-input"
                    placeholder="Contraseña (mínimo 6 caracteres)"
                    required
                    minLength={6}
                    disabled={authLoading}
                  />
                  <button type="submit" className="btn btn-primary" disabled={authLoading}>
                    {authLoading ? 'Creando cuenta...' : 'Crear cuenta'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => { setAuthMode('login'); setErrorMessage(null) }}
                    disabled={authLoading}
                  >
                    ¿Ya tienes cuenta? Iniciar sesión
                  </button>
                </div>
              </form>
            )}
            <button className="btn btn-ghost" onClick={() => { setShowAuth(false); setErrorMessage(null); setAuthLoading(false) }}>Cerrar</button>
          </div>
        </div>
      )}

      {isExporting && exportProgress && (
        <div className="export-progress-toast">
          {exportProgress}
        </div>
      )}

      <div className="arrangement-view">
        <div className="sidebar-column" style={{ width: `${sidebarWidth}px` }}>
          <div
            className="sidebar-scroll"
            ref={sidebarScrollRef}
            onScroll={() => syncVerticalScroll('sidebar')}
          >
            <div className="ruler-spacer" style={{ height: harmony ? 54 : 32 }}>
              {harmony && <span className="chord-key">{harmony.key.label}</span>}
            </div>
            {trackStates.map((trackState, trackIndex) => (
              <div className="track-stack" key={trackIndex}>
                <TrackHeader
                  trackIndex={trackIndex}
                  name={trackState.name}
                  mute={trackState.mute}
                  solo={trackState.solo}
                  volume={trackState.volume}
                  height={88 * verticalZoom}
                  canDelete={trackStates.length > 1}
                  isRenaming={renamingTrack === trackIndex}
                  renameDraft={renamingTrack === trackIndex ? renameDraft : ''}
                  onContextMenu={openTrackHeaderMenu}
                  onStartRename={startRenameTrack}
                  onRenameDraftChange={setRenameDraft}
                  onCommitRename={commitRenameTrack}
                  onCancelRename={cancelRenameTrack}
                  onDelete={requestDeleteTrack}
                  onMute={handleMuteToggle}
                  onSolo={handleSoloToggle}
                  onVolumeLive={handleVolumeLive}
                  onVolumeCommit={handleVolumeCommit}
                  recordArmed={recordArmedIndex === trackIndex}
                  onRecordArm={handleRecordArm}
                  fxOpen={fxOpenTracks.includes(trackIndex)}
                  autoOpen={autoOpenTracks.includes(trackIndex)}
                  onToggleFx={toggleFxPanel}
                  onToggleAuto={toggleAutoPanel}
                  practiceActive={practiceIndex === trackIndex}
                  isolated={trackState.solo && trackStates.every((t, i) => i === trackIndex ? t.solo : !t.solo)}
                  onPractice={handlePractice}
                  onAislar={handleAislar}
                />
                {fxOpenTracks.includes(trackIndex) && (
                  <div className="fx-side" style={{ height: `${FX_RACK_HEIGHT}px` }}>
                    <IconSliders size={13} />
                    <span className="fx-side-label">FX</span>
                  </div>
                )}
                {autoOpenTracks.includes(trackIndex) && (
                  <div className="auto-side" style={{ height: `${AUTO_LANE_HEIGHT}px` }}>
                    <IconSpline size={13} />
                    <span className="auto-side-label">Auto</span>
                    <select
                      className="auto-param-select"
                      value={autoParamByTrack[trackIndex] ?? 'volume'}
                      aria-label="Parámetro de automatización"
                      onChange={(e) => {
                        const paramId = e.target.value
                        setAutoParamByTrack((prev) => ({ ...prev, [trackIndex]: paramId }))
                        setSelectedAutoPoint((sel) => sel?.trackIndex === trackIndex ? null : sel)
                      }}
                    >
                      {AUTOMATION_PARAMS.map((param) => (
                        <option key={param.id} value={param.id}>{param.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="add-track-button"
            data-testid="add-track-button"
            title="Agregar pista"
            onClick={addEmptyTrack}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                trackIndex: trackStates.length - 1,
                clipId: null,
                time: 0,
                kind: 'empty'
              })
            }}
          >
            <IconPlus size={14} />
            Agregar pista
          </button>
        </div>
        <div 
          className="resize-handle"
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize sidebar"
        />
        <div
          className="lanes-column"
          ref={lanesColumnRef}
          onContextMenu={(e) => {
            e.preventDefault()
            const target = e.target as HTMLElement
            if (target.closest('.track-content, .clip-wrapper, .bar-ruler')) return
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              trackIndex: trackStates.length - 1,
              clipId: null,
              time: 0,
              kind: 'empty'
            })
          }}
        >
          <div
            className="lanes-scroll-content"
            ref={lanesScrollRef}
            onScroll={() => syncVerticalScroll('lanes')}
          >
          {marqueeBox && (
            <div
              className="marquee-rect"
              style={{
                left: marqueeBox.left,
                top: marqueeBox.top,
                width: marqueeBox.width,
                height: marqueeBox.height
              }}
            />
          )}
          <div className="lanes-scroll-inner" style={{ minWidth: `${100 * horizontalZoom}%` }}>
          {harmony && (
            <div className="chord-ruler" aria-label="Acordes">
              {harmony.chords.map((chord, i) => (
                <span
                  key={`${chord.t}-${i}`}
                  className="chord-label"
                  style={{ left: `${(chord.t / Math.max(getLayoutMax(), 0.001)) * 100}%` }}
                >
                  {chord.label}
                </span>
              ))}
            </div>
          )}
          <div className="bar-ruler" onMouseDown={handleRulerMouseDown}>
            {rulerBars}
          </div>
          {(() => {
            const maxDur = getLayoutMax()
            return trackStates.map((trackState, trackIndex) => {
            const autoParam = autoParamByTrack[trackIndex] ?? 'volume'
            const autoMeta = paramMeta(autoParam)
            const autoLane = laneForParam(trackState.automation, autoParam)
            return (
            <div className="track-stack" key={trackIndex}>
            <TrackLane
              trackIndex={trackIndex}
              hasClips={trackState.clips.length > 0}
              isAnyClipPlaying={trackState.clips.some(c => c.isPlaying)}
              height={88 * verticalZoom}
              maxDur={maxDur}
              clips={trackState.clips}
              selectedClipIds={selectedClipIds}
              isLoopEnabled={isLoopEnabled}
              isDraggingLoopEdge={!!isDraggingLoopEdge}
              loopStart={loopStart}
              loopEnd={loopEnd}
              tempLoopStart={tempLoopStart}
              tempLoopEnd={tempLoopEnd}
              onWaveformClick={handleWaveformClick}
              onDoubleClick={handleLaneDoubleClick}
              onMouseDown={handleTrackMouseDown}
              onContextMenuTrack={openContextMenu}
              onLoopMouseDown={handleLoopMouseDown}
              onLoopMouseMove={handleLoopMouseMove}
              onLoopMouseUp={handleLoopMouseUp}
              onClipClick={handleClipClick}
              onResizeStart={handleResizeStart}
              onClipDragStart={handleClipDragStart}
              isRecordingLane={isRecording && recordingTrackIndex === trackIndex}
              recordingStartOffset={
                recordingTrackIndex === trackIndex
                  ? (recordLiveRef.current?.startOffset ?? playheadPositionRef.current)
                  : 0
              }
            />
            {fxOpenTracks.includes(trackIndex) && (
              <FxRack
                fx={trackState.fx ?? defaultTrackFx()}
                pan={trackState.pan ?? DEFAULT_PAN}
                onPanLive={(v) => handlePanLive(trackIndex, v)}
                onPanCommit={(v) => handlePanCommit(trackIndex, v)}
                onFxLive={(id, v) => handleFxLive(trackIndex, id, v)}
                onFxCommit={(id, v) => handleFxCommit(trackIndex, id, v)}
                onBypass={(section) => handleFxBypass(trackIndex, section)}
                onFilterType={(type) => handleFilterType(trackIndex, type)}
              />
            )}
            {autoOpenTracks.includes(trackIndex) && (
              <AutomationLaneView
                points={autoLane?.points ?? []}
                min={autoMeta.min}
                max={autoMeta.max}
                maxDur={maxDur}
                staticValue={getTrackParam(trackState, autoParam)}
                selectedIndex={
                  selectedAutoPoint?.trackIndex === trackIndex && selectedAutoPoint.paramId === autoParam
                    ? selectedAutoPoint.index
                    : -1
                }
                onGestureStart={saveUndo}
                onSelect={(index) => setSelectedAutoPoint({ trackIndex, paramId: autoParam, index })}
                onLive={(pts) => writeTrackAutomation(trackIndex, autoParam, pts, false)}
                onCommit={(pts, index) => {
                  writeTrackAutomation(trackIndex, autoParam, pts, true)
                  setSelectedAutoPoint(index >= 0 ? { trackIndex, paramId: autoParam, index } : null)
                }}
              />
            )}
            </div>
            )
            })
          })()}
            <div className="playhead" ref={playheadElRef} aria-hidden="true">
              <span className="playhead-cap" />
            </div>
          </div>
          </div>
        </div>
      </div>

      {contextMenu && (
        <>
          <div
            className="context-menu-backdrop"
            onMouseDown={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }}
          />
          <div
            ref={contextMenuRef}
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.kind === 'header' ? (
              <>
                <ContextMenuItem icon={<IconPencil />} label="Renombrar pista" onClick={() => startRenameTrack(contextMenu.trackIndex)} />
                <ContextMenuItem icon={<IconPlus />} label="Agregar pista" onClick={addEmptyTrack} />
                <div className="context-menu-sep" />
                <ContextMenuItem
                  icon={<IconTrash />}
                  label="Eliminar pista"
                  danger
                  disabled={trackStates.length <= 1}
                  onClick={() => requestDeleteTrack(contextMenu.trackIndex)}
                />
              </>
            ) : contextMenu.kind === 'empty' ? (
              <ContextMenuItem icon={<IconPlus />} label="Agregar pista" onClick={addEmptyTrack} />
            ) : contextMenu.clipId ? (
              <>
                <ContextMenuItem icon={<IconScissors />} label="Cortar" shortcut="Ctrl+X" onClick={() => runContextMenuAction('cut')} />
                <ContextMenuItem icon={<IconCopy />} label="Copiar" shortcut="Ctrl+C" onClick={() => runContextMenuAction('copy')} />
                <ContextMenuItem
                  icon={<IconClipboardPaste />}
                  label="Pegar"
                  shortcut="Ctrl+V"
                  disabled={!clipboard || clipboard.length === 0}
                  onClick={() => runContextMenuAction('paste')}
                />
                <div className="context-menu-sep" />
                <ContextMenuItem icon={<IconSplit />} label="Dividir aquí" shortcut="S" onClick={() => runContextMenuAction('split')} />
                <ContextMenuItem icon={<IconCopyPlus />} label="Duplicar" shortcut="Ctrl+D" onClick={() => runContextMenuAction('duplicate')} />
                <ContextMenuItem icon={<IconTrash />} label="Eliminar" shortcut="Del" danger onClick={() => runContextMenuAction('delete')} />
              </>
            ) : (
              <>
                <ContextMenuItem
                  icon={<IconClipboardPaste />}
                  label="Pegar aquí"
                  shortcut="Ctrl+V"
                  disabled={!clipboard || clipboard.length === 0}
                  onClick={() => runContextMenuAction('paste')}
                />
                <div className="context-menu-sep" />
                <ContextMenuItem icon={<IconPlus />} label="Agregar pista" onClick={addEmptyTrack} />
              </>
            )}
          </div>
        </>
      )}

      {trackDeleteConfirm && (
        <div
          className="confirm-modal"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTrackDeleteConfirm(null)
          }}
        >
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="track-delete-title">
            <h2 id="track-delete-title">Eliminar pista</h2>
            <p>
              ¿Eliminar la pista «{trackDeleteConfirm.name}» y {trackDeleteConfirm.clipCount === 1
                ? 'su clip'
                : `sus ${trackDeleteConfirm.clipCount} clips`}? Esta acción se puede deshacer.
            </p>
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={() => setTrackDeleteConfirm(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="confirm-danger"
                onClick={() => deleteTrackAt(trackDeleteConfirm.trackIndex)}
              >
                Eliminar pista
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="drive-projects-modal">
          <div className="modal-content help-modal" style={{ maxWidth: '600px' }}>
            <h2>Atajos de teclado y gestos</h2>
            <div>
              <h3>Edición de clips</h3>
              <ul>
                <li>• <strong>Click derecho en un clip</strong> - Menú: Cortar, Copiar, Pegar, Dividir aquí, Duplicar, Eliminar</li>
                <li>• <strong>Click derecho en una pista vacía</strong> - Pegar aquí (en la posición del cursor, con snap si está activo)</li>
                <li>• <strong>Click</strong> - Seleccionar clip y mover playhead</li>
                <li>• <strong>Cmd/Ctrl+Click</strong> - Añadir o quitar un clip de la selección</li>
                <li>• <strong>Shift+Click</strong> - Añadir clip a la selección</li>
                <li>• <strong>Arrastrar en área vacía</strong> - Selección rectangular (varios tracks). Shift añade, Ctrl/Cmd alterna. Con Loop activo, arrastrar marca el loop</li>
                <li>• <strong>Arrastrar clip</strong> - Mover la selección junta (tiempo y pista)</li>
                <li>• <strong>Alt+Click en clip</strong> - Dividir en el punto clickeado</li>
                <li>• <strong>Alt+Arrastrar</strong> - Duplicar clip (después de mover 5px)</li>
                <li>• <strong>Arrastrar borde izquierdo</strong> - Recortar desde el inicio</li>
                <li>• <strong>Arrastrar borde derecho</strong> - Recortar desde el final</li>
                <li>• <strong>Arrastrar archivos de audio</strong> - Soltalos en una pista para colocarlos ahí (con snap si está activo). Fuera de una pista se crea una pista nueva. Varios archivos: una pista por archivo</li>
                <li>• <strong>Botón Snap</strong> - Empieza en OFF. Activa/desactiva el ajuste a cuadrícula (se recuerda)</li>
                <li>• <strong>Shift al arrastrar</strong> - Invierte el snap mientras arrastras (lo enciende si está OFF, lo apaga si está ON)</li>
              </ul>

              <h3>Pistas</h3>
              <ul>
                <li>• <strong>Doble clic en el nombre</strong> - Renombrar pista (Enter o clic fuera guarda, Escape cancela)</li>
                <li>• <strong>Icono de papelera en la cabecera</strong> - Eliminar la pista entera (pide confirmación si tiene clips)</li>
                <li>• <strong>Click derecho en la cabecera de pista</strong> - Menú: Renombrar pista, Agregar pista, Eliminar pista</li>
                <li>• <strong>+ Agregar pista</strong> - Añade una pista vacía al final (Pista 9, 10, …). También en una pista vacía o zona vacía (clic derecho). Se puede deshacer</li>
                <li>• <strong>Cmd/Ctrl+Z</strong> - Deshacer (incluye nombre, clips, volumen, mute y solo)</li>
                <li>• <strong>Volumen de pista</strong> - El audio cambia al arrastrar; el valor se guarda al soltar</li>
                <li>• <strong>Zoom vertical</strong> - La forma de onda queda centrada en el clip a cualquier altura (también al mínimo del slider)</li>
                <li>• <strong>Círculo en la cabecera</strong> - Armar la pista para grabar (rojo = armada). Solo una a la vez</li>
                <li>• <strong>P (Practicar encima)</strong> - Silencia ese stem y deja el resto sonando para tocar o cantar encima. El botón del transporte usa la pista seleccionada</li>
                <li>• <strong>Ais (Aislar)</strong> - Solo ese stem (exclusivo). Volvé a pulsar para salir</li>
                <li>• <strong>Botón FX</strong> - Abre el rack de efectos de esa pista (EQ, compresor, filtro, delay, reverb y pan). Cada módulo tiene knobs y bypass On/Off</li>
                <li>• <strong>Botón A (curva)</strong> - Muestra la pista de automatización. Elegí el parámetro (volumen, pan o un knob de efecto) y dibujá la curva</li>
              </ul>

              <h3>Tono, tempo y práctica</h3>
              <ul>
                <li>• <strong>Tono</strong> - ±12 semitonos en todo el proyecto (GrainPlayer, independiente de la velocidad)</li>
                <li>• <strong>Velocidad</strong> - 0.5x a 1.5x. El BPM que suena aparece al lado del BPM del proyecto (p. ej. 120 → 90)</li>
                <li>• <strong>Detectar acordes</strong> - Analiza la mezcla o una pista con chroma espectral en el navegador. Muestra la tonalidad (p. ej. La menor) y etiquetas sobre la regla. Pulsá de nuevo para recalcular. Es una heurística: en temas densos o con distorsión puede equivocarse</li>
              </ul>

              <h3>Efectos y automatización</h3>
              <ul>
                <li>• <strong>Knobs</strong> - Arrastrá verticalmente para cambiar; Shift = ajuste fino. El audio se actualiza al instante</li>
                <li>• <strong>Bypass</strong> - On/Off por efecto. EQ parte activo (plano); compresor, filtro, delay y reverb empiezan en bypass</li>
                <li>• <strong>Filtro LP/HP</strong> - Tipo pasa-bajos o pasa-altos, con corte y resonancia</li>
                <li>• <strong>Click en la curva</strong> - Añade un punto. Arrastrar mueve. Doble clic o Delete/Backspace borra el punto seleccionado</li>
                <li>• <strong>Durante el play</strong> - La curva maneja el parámetro de Tone.js en tiempo real (interpolación lineal) sin re-renderizar la app cada frame</li>
                <li>• <strong>Guardar</strong> - FX, pan y automatización van en project.json y en el autosave de IndexedDB. Un gesto de puntos = un deshacer</li>
              </ul>

              <h3>Grabación</h3>
              <ul>
                <li>• <strong>Grabar</strong> (punto rojo) - Graba el micrófono desde el playhead. Si no hay pista armada, usa la seleccionada o crea «Grabación N»</li>
                <li>• <strong>Overdub</strong> - Mientras grabás se reproducen las demás pistas. La cuenta del metrónomo se respeta si está activa y el playhead está en esos compases</li>
                <li>• <strong>Grabar de nuevo, Stop o Espacio</strong> - Termina la toma y deja un clip (un deshacer la saca)</li>
                <li>• <strong>Entrada de audio</strong> - Si hay más de un micrófono, elige cuál usar (se recuerda)</li>
              </ul>
              
              <h3>Teclado</h3>
              <ul>
                <li>• <strong>Cmd/Ctrl+S</strong> - Guardar proyecto localmente</li>
                <li>• <strong>Shift+Cmd/Ctrl+S</strong> - Guardar como... (nueva ubicación)</li>
                <li>• <strong>S</strong> o <strong>Cmd/Ctrl+E</strong> - Dividir clip en playhead</li>
                <li>• <strong>Cmd/Ctrl+X</strong> - Cortar clips seleccionados</li>
                <li>• <strong>Cmd/Ctrl+C</strong> - Copiar clips seleccionados</li>
                <li>• <strong>Cmd/Ctrl+V</strong> - Pegar selección en playhead (posiciones relativas)</li>
                <li>• <strong>Cmd/Ctrl+D</strong> - Duplicar clips seleccionados</li>
                <li>• <strong>Delete/Backspace</strong> - Eliminar clips seleccionados, o el punto de automatización seleccionado</li>
                <li>• <strong>Escape</strong> - Cerrar menú o limpiar selección</li>
                <li>• <strong>Cmd/Ctrl+A</strong> - Seleccionar todos los clips</li>
                <li>• <strong>Cmd/Ctrl+Z</strong> - Deshacer</li>
                <li>• <strong>Cmd/Ctrl+Shift+Z</strong> o <strong>Cmd/Ctrl+Y</strong> - Rehacer</li>
                <li>• <strong>Espacio</strong> - Play/Pausa solo con esta pestaña enfocada. No hace nada si estás escribiendo en un campo</li>
              </ul>
              
              <h3>Guardar y Abrir</h3>
              <ul>
                <li>• <strong>Guardar</strong> - Guardar proyecto en tu computadora (primera vez elige ubicación, después sobrescribe)</li>
                <li>• <strong>Abrir</strong> - Abrir proyecto .musicalia desde tu computadora</li>
                <li>• Los proyectos incluyen todo el audio y stems sin rehacer separación</li>
              </ul>
              
              <h3>Transporte</h3>
              <ul>
                <li>• <strong>Espacio</strong> - Play/Pausa solo mientras Musicalia está enfocada y visible (no desde otras pestañas, apps ni teclas de media). El playhead se queda donde paró; la próxima vez sigue desde ahí o desde donde hiciste click. Si hay una grabación en curso, la detiene. No desplaza la página ni activa el botón enfocado</li>
                <li>• <strong>Click en timeline, regla o clip</strong> - Mover playhead (siempre visible, también en pausa)</li>
                <li>• <strong>Arrastrar en ruler</strong> - Marcar región de loop</li>
                <li>• <strong>Shift+Click en ruler</strong> - Marcar loop desde playhead</li>
              </ul>
            </div>
            <button className="btn btn-primary" onClick={() => setShowHelp(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
