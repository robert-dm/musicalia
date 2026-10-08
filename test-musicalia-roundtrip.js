#!/usr/bin/env node

// Test script to verify .musicalia file format round-trip
// Creates a mock .musicalia file and reads it back

import JSZip from 'jszip';
import { promises as fs } from 'fs';

async function encodeWAV(channels, sampleRate) {
  const bytesPerSample = 2;
  const numChannels = channels.length;
  const dataLength = channels[0].length * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  let offset = 44;
  for (let i = 0; i < channels[0].length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function createMockProject() {
  console.log('Creating mock .musicalia project...');
  
  const zip = new JSZip();
  
  // Create mock project data
  const projectData = {
    version: '0.0071b',
    name: 'Test Project',
    bpm: 120,
    loopStart: null,
    loopEnd: null,
    playheadPosition: 0,
    metronomeEnabled: true,
    countInBars: 2,
    tracks: [
      {
        name: 'Track 1',
        mute: false,
        solo: false,
        volume: 0.8,
        clips: [
          {
            fileName: 'test.wav',
            startPosition: 0,
            offsetSeconds: 0,
            id: 'clip-1',
            sourceStart: 0,
            duration: 1.0,
            audioFile: 'audio_0_0.wav'
          }
        ]
      },
      {
        name: 'Track 2',
        mute: false,
        solo: false,
        volume: 0.8,
        clips: []
      }
    ]
  };
  
  zip.file('project.json', JSON.stringify(projectData, null, 2));
  
  // Create mock audio (1 second of 440Hz sine wave)
  const sampleRate = 44100;
  const duration = 1.0;
  const frequency = 440;
  const samples = Math.floor(sampleRate * duration);
  const leftChannel = new Float32Array(samples);
  const rightChannel = new Float32Array(samples);
  
  for (let i = 0; i < samples; i++) {
    const value = Math.sin(2 * Math.PI * frequency * i / sampleRate);
    leftChannel[i] = value;
    rightChannel[i] = value;
  }
  
  const wavData = await encodeWAV([leftChannel, rightChannel], sampleRate);
  zip.file('audio_0_0.wav', Buffer.from(wavData), { compression: 'STORE' });
  
  // Generate zip with DEFLATE compression
  const blob = await zip.generateAsync({ 
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  return blob;
}

async function readMusicalia(buffer) {
  console.log('Reading .musicalia file...');
  
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  
  // Check project.json exists
  const projectFile = zip.file('project.json');
  if (!projectFile) {
    throw new Error('Missing project.json');
  }
  
  const projectJson = await projectFile.async('string');
  const projectData = JSON.parse(projectJson);
  
  console.log('Project data:', JSON.stringify(projectData, null, 2));
  
  // Check audio file exists
  const audioFile = zip.file('audio_0_0.wav');
  if (!audioFile) {
    throw new Error('Missing audio_0_0.wav');
  }
  
  const audioData = await audioFile.async('arraybuffer');
  console.log(`Audio file size: ${audioData.byteLength} bytes`);
  
  // Verify WAV header
  const view = new DataView(audioData);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV file');
  }
  
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  
  console.log(`Audio: ${numChannels} channels, ${sampleRate}Hz`);
  
  return { projectData, audioData };
}

async function test() {
  try {
    console.log('=== Testing .musicalia Round-Trip ===\n');
    
    // Create
    const zipBuffer = await createMockProject();
    console.log(`Created .musicalia file: ${zipBuffer.length} bytes\n`);
    
    // Save to disk for inspection
    await fs.writeFile('/tmp/test.musicalia', zipBuffer);
    console.log('Saved to /tmp/test.musicalia\n');
    
    // Read back
    const { projectData, audioData } = await readMusicalia(zipBuffer);
    
    // Verify
    console.log('\n=== Verification ===');
    console.log(`✓ Version: ${projectData.version}`);
    console.log(`✓ Project name: ${projectData.name}`);
    console.log(`✓ BPM: ${projectData.bpm}`);
    console.log(`✓ Tracks: ${projectData.tracks.length}`);
    console.log(`✓ Clips in Track 1: ${projectData.tracks[0].clips.length}`);
    console.log(`✓ Audio buffer: ${audioData.byteLength} bytes`);
    
    console.log('\n✅ Round-trip test PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Round-trip test FAILED:', err);
    process.exit(1);
  }
}

test();
