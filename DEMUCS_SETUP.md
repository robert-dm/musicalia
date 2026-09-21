# Demucs Model Setup for Musicalia

This document explains how the browser-local Demucs stem separation works and how to configure it.

## Overview

Musicalia uses **real ML-based stem separation** via ONNX Runtime Web with the HTDemucs model. This produces genuinely separate audio stems, not frequency-filtered copies of the original mix.

## How It Works

1. **Model Loading**: On first use, downloads the HTDemucs ONNX model (~80-250MB depending on variant)
2. **WebGPU Acceleration**: Uses WebGPU when available for faster processing
3. **Real Separation**: Produces 4 distinct stems:
   - **Vocals**: Isolated vocal tracks
   - **Drums**: Drum kit and percussion
   - **Bass**: Bass guitar and low-frequency instruments
   - **Other**: Remaining instruments (guitar, piano, synths, etc.)

## Model Configuration

The current model URL is configured in `src/stemSeparator.ts`:

```typescript
const DEMUCS_MODEL_URL = 'https://huggingface.co/TRvlvr/model_repo/resolve/main/demucs/htdemucs_6s.onnx'
```

### Model Sources

**Option 1: Use Pre-converted Models**
- TRvlvr's repository: https://github.com/TRvlvr/model_repo
- Available on Hugging Face: https://huggingface.co/TRvlvr/model_repo

**Option 2: Convert Your Own**
1. Clone official Demucs: https://github.com/facebookresearch/demucs
2. Convert PyTorch model to ONNX:
   ```bash
   pip install demucs onnx torch
   python convert_demucs_to_onnx.py
   ```
3. Host on your CDN/S3

**Option 3: Local Development**
For development without model download:
1. Download model locally
2. Place in `public/models/demucs.onnx`
3. Update URL to `/models/demucs.onnx`

## Model Variants

### 4-Stem Model (htdemucs)
- Outputs: Drums, Bass, Other, Vocals
- Size: ~80MB
- Faster processing
- Good quality

### 6-Stem Model (htdemucs_6s)
- Outputs: Drums, Bass, Other, Vocals, Guitar, Piano
- Size: ~250MB
- Slower processing
- Best quality
- Note: Musicalia merges Guitar+Piano into "Other" for consistent 4-track output

## Browser Requirements

### Minimum Requirements
- WebAssembly support (all modern browsers)
- 2GB+ available RAM
- Modern browser (Chrome 90+, Firefox 90+, Edge 90+)

### Recommended for Best Performance
- **WebGPU support**: Chrome/Edge 113+
- 4GB+ RAM
- Hardware GPU acceleration enabled
- Fast internet connection (for first-time model download)

## Performance Expectations

| Audio Length | Device      | WebGPU | Processing Time |
|--------------|-------------|--------|-----------------|
| 3 minutes    | Desktop GPU | Yes    | ~30-60 seconds  |
| 3 minutes    | Desktop     | No     | ~2-4 minutes    |
| 3 minutes    | Laptop      | Yes    | ~1-2 minutes    |
| 3 minutes    | Laptop      | No     | ~4-8 minutes    |

First run includes model download time (~1-2 minutes on fast connection).

## Error Handling

The implementation handles several failure modes:

1. **WebAssembly Not Available**
   - Shows error message
   - Falls back to single-track import

2. **Insufficient Memory**
   - Detects < 2GB RAM if `navigator.deviceMemory` available
   - Warns user and falls back

3. **Model Load Failure**
   - Network error or CORS issue
   - Clear error message
   - Falls back to single-track import

4. **Inference Failure**
   - Out of memory during processing
   - Shows error with suggestion to use shorter file
   - Falls back to single-track import

## Testing Real Separation

To verify stems are actually separated (not just EQ'd):

1. Import an audio file with clear vocals and drums
2. Choose "Sí, separar en pistas"
3. Solo each track individually:
   - **Vocals track**: Should hear ONLY voice, no drums/instruments
   - **Drums track**: Should hear ONLY percussion, no melody
   - **Bass track**: Should hear ONLY low-frequency bass
   - **Other track**: Should hear ONLY melodic instruments, no vocals/drums

If all tracks sound like the full mix with different EQ, the separation failed.

## Architecture Notes

### Why ONNX Runtime Web?

- **Standardized**: ONNX is an industry standard
- **Performance**: WebGPU acceleration support
- **Portability**: Same model runs in browser and server
- **No API calls**: 100% client-side processing

### Why Not Alternatives?

**PyTorch.js / TensorFlow.js**
- Larger bundle size
- Less mature WebGPU support

**WebAssembly-only Demucs**
- Slower without GPU
- Limited by CPU performance

**Cloud API (Replicate/Moises)**
- Costs money
- Requires internet
- Privacy concerns
- Not "browser-local"

## Development

### Testing with Mock Model
For rapid development without downloading the full model:

```typescript
// In stemSeparator.ts, add development bypass:
if (import.meta.env.DEV) {
  console.warn('Development mode: skipping real inference')
  // Return test data
}
```

### Model Caching
The model is cached in memory after first load:
```typescript
let cachedSession: ort.InferenceSession | null = null
```

Browser also caches the downloaded file (via HTTP cache headers from Hugging Face).

## Troubleshooting

### "Failed to load model" Error
- **Check network**: Model URL must be accessible
- **Check CORS**: Model host must allow CORS
- **Check size**: Ensure browser allows large downloads

### "WebGPU required" Error
- Browser doesn't support WebGPU
- Falls back to WASM (slower but works)
- Consider using Chrome/Edge 113+

### Processing Takes Too Long
- First run includes download time
- Very long audio files (>10 min) can take a while
- Consider splitting long files

### Out of Memory
- Audio file too long for available RAM
- Close other tabs
- Use shorter audio files
- Use device with more RAM

## Future Improvements

1. **Chunking**: Process long files in segments
2. **Web Worker**: Run inference in background thread
3. **Progress Granularity**: More detailed progress updates
4. **Model Selection**: Let user choose 4-stem vs 6-stem
5. **Quality Settings**: Offer fast/balanced/quality modes
6. **Offline Mode**: Service worker to cache model permanently

## References

- **Demucs Paper**: https://arxiv.org/abs/2111.03600
- **Official Repo**: https://github.com/facebookresearch/demucs
- **ONNX Runtime**: https://onnxruntime.ai/docs/tutorials/web/
- **WebGPU**: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
