# Musicalia v0.0012b - Stem Separation Implementation Notes

## Overview
This document describes the browser-local stem separation feature added in PR #12.

## Changes Summary

### Version Update
- **APP_VERSION**: Updated from `0.0011b` to `0.0012b`
- Version badge displayed in transport bar with green styling

### New Files Created

#### 1. `src/StemSplitDialog.tsx`
Modal components for stem separation workflow:
- **StemSplitDialog**: Initial prompt asking user if audio has multiple instruments
- **StemSplitProgress**: Progress indicator during stem processing
- Both components follow Musicalia's dark DAW UI design

#### 2. `src/StemSplitDialog.css`
Styling for dialog components:
- Modal overlay with backdrop blur
- Dark theme consistent with main app
- Progress bar with gradient green fill
- Responsive button styling

#### 3. `src/stemSeparator.ts`
Core stem separation logic:
- **separateStems()**: Main function that splits audio into 4 stems
- **Stems produced**: Vocals, Drums, Bass, Other
- **Current implementation**: Frequency-based separation (fallback)
- **Architecture**: Ready for ML model integration (Demucs ONNX/WebGPU)
- WebGPU detection with fallback
- Progress callback support

### Modified Files

#### `src/App.tsx`
Major changes to audio import workflow:
- Added `APP_VERSION` constant
- Added dialog state management (`showStemDialog`, `isProcessingStems`, `stemProgress`)
- Added `name` property to `TrackState` interface
- Modified `handleFileSelect()`: Now shows dialog instead of direct import
- New functions:
  - `handleStemDialogConfirm()`: Processes stem separation
  - `handleStemDialogCancel()`: Falls back to single track import
  - `loadSingleTrack()`: Original single-track import logic
  - `processStemSeparation()`: Creates 4 tracks from separated stems
- Track names now use custom names when stems are created

#### `src/App.css`
Added version badge styling:
- Badge positioned in transport bar (margin-left: auto)
- Green theme matching Musicalia's accent color
- Monospace font for version display

## User Experience Flow

### Single Track Import (Original Behavior)
1. Click track lane
2. Select audio file
3. Dialog appears: "¿Este audio tiene varios instrumentos?"
4. Click **"No, una sola pista"**
5. Audio loads onto selected track (same as before)

### Stem Separation (New Feature)
1. Click track lane
2. Select audio file
3. Dialog appears with explanation
4. Click **"Sí, separar en pistas"**
5. Progress modal shows percentage and stage
6. 4 tracks created with stems:
   - Track N: Vocals
   - Track N+1: Drums
   - Track N+2: Bass
   - Track N+3: Other
7. Each track has waveform visualization
8. All stems synchronized and ready to play

## Technical Architecture

### Stem Separation Process
```
Audio File
    ↓
Load into AudioBuffer
    ↓
separateStems() with progress callback
    ├─→ extractVocals() → Vocals stem
    ├─→ extractDrums() → Drums stem
    ├─→ extractBass() → Bass stem
    └─→ extractOther() → Other stem (residual)
    ↓
Create Tone.Player for each stem
    ↓
Connect to track gain nodes
    ↓
Draw waveforms on canvas
    ↓
Ready for playback
```

### Current Separation Algorithm
The current implementation uses frequency-based filtering as a fallback:
- **Vocals**: Bandpass ~200Hz-3kHz (mid-range emphasis)
- **Drums**: Wide range with transient emphasis
- **Bass**: Lowpass ~250Hz
- **Other**: Residual calculation

### Future ML Integration
The architecture is designed to easily integrate with:

1. **ONNX Runtime Web + Demucs Model**
   - Replace `separateStems()` internals with ONNX inference
   - Keep same interface (AudioBuffer in, stems out)
   - Progress tracking remains compatible

2. **WebGPU Acceleration**
   - Already detects WebGPU availability
   - Can route to GPU-accelerated inference path
   - Falls back gracefully if unavailable

3. **WebAssembly Demucs**
   - Can replace separation logic with WASM module
   - Maintains same async interface

## Dependencies
- **@xenova/transformers**: Installed (382kB in bundle)
  - Currently included for future ML model support
  - Not actively used in current frequency-based approach

## Build & Performance
- ✅ Build passes: `npm run build`
- Bundle size: 382.05 kB (108.29 kB gzipped)
- No runtime errors
- Backward compatible with existing features

## Browser Compatibility
- **Minimum**: Modern browsers with Web Audio API
- **Recommended**: Chrome/Edge with WebGPU for future ML models
- **Tested**: Chrome 120+, Firefox 120+

## Known Limitations
1. Current frequency-based separation is simplified
2. Full Demucs quality requires ML model integration
3. First-time model download (when integrated) will be ~80MB
4. Processing time depends on audio length and device

## Next Steps for Production
To achieve Demucs-quality separation:

1. **Obtain Demucs Model**
   - Convert Demucs to ONNX format
   - Host model files or bundle them
   - Implement lazy loading on first use

2. **Integrate ONNX Runtime Web**
   ```bash
   npm install onnxruntime-web
   ```

3. **Replace Separation Logic**
   - Update `stemSeparator.ts` to use ONNX inference
   - Keep progress callback mechanism
   - Maintain error handling

4. **Test & Optimize**
   - Verify WebGPU acceleration works
   - Test with various audio lengths
   - Add cancel functionality during processing

## Testing Checklist
- ✅ Build passes without errors
- ✅ Version badge displays correctly
- ✅ Dialog appears on audio import
- ✅ "No" button loads single track (original behavior)
- ✅ "Sí" button shows progress and creates 4 tracks
- ✅ Track names update to stem names
- ✅ Waveforms render for all stems
- ✅ All stems can play simultaneously
- ✅ Mute/Solo/Volume controls work per stem
- ✅ Global transport controls affect all stems
- ✅ No console errors during operation

## PR Information
- **PR Number**: #12
- **Branch**: `cursor/stem-split-import-041c`
- **Base Branch**: `main`
- **Status**: Draft (ready for review)
- **GitHub URL**: https://github.com/robert-dm/musicalia/pull/12
