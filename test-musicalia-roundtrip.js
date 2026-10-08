#!/usr/bin/env node

// Test script to verify .musicalia file format round-trip
// Covers mono and stereo AudioBuffers (the save-path encoder must never
// call getChannelData on a channel that does not exist).

import JSZip from 'jszip';
import { promises as fs } from 'fs';

class MockAudioBuffer {
  constructor(options) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this._channels = options.channels ?? Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length)
    );
  }

  getChannelData(channel) {
    if (channel < 0 || channel >= this.numberOfChannels) {
      throw new Error(
        `Failed to execute 'getChannelData' on 'AudioBuffer': channel index (${channel}) exceeds number of channels (${this.numberOfChannels})`
      );
    }
    return this._channels[channel];
  }
}

globalThis.AudioBuffer = MockAudioBuffer;

const {
  encodeWAV,
  decodeWAV,
  getAudioBufferChannels,
  encodeAudioBufferWAV,
  serializeAudioBuffer,
  audioBufferFromSerialized
} = await import('./src/wav.ts');

function createSineBuffer(numberOfChannels, sampleRate, duration, frequency) {
  const samples = Math.floor(sampleRate * duration);
  const channels = [];
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = new Float32Array(samples);
    const amplitude = ch === 0 ? 0.5 : 0.25;
    for (let i = 0; i < samples; i++) {
      data[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
    }
    channels.push(data);
  }
  return new MockAudioBuffer({
    numberOfChannels,
    length: samples,
    sampleRate,
    channels
  });
}

function readWavHeader(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('Invalid WAV file');
  }
  return {
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true)
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testEncoderHandlesChannelCounts() {
  console.log('Testing WAV encoder channel handling...');
  const sampleRate = 44100;

  const mono = createSineBuffer(1, sampleRate, 0.25, 440);
  let stereoAssumptionThrew = false;
  try {
    encodeWAV([mono.getChannelData(0), mono.getChannelData(1)], sampleRate);
  } catch (err) {
    stereoAssumptionThrew = /channel index \(1\) exceeds number of channels \(1\)/.test(err.message);
  }
  assert(stereoAssumptionThrew, 'Old stereo assumption should throw on mono buffers');

  const monoWav = encodeAudioBufferWAV(mono);
  const monoHeader = readWavHeader(monoWav.buffer);
  assert(monoHeader.numChannels === 1, `Expected mono WAV channels=1, got ${monoHeader.numChannels}`);
  assert(monoHeader.sampleRate === sampleRate, 'Mono sample rate mismatch');
  assert(monoHeader.bitsPerSample === 16, 'Mono bitsPerSample should be 16');
  assert(monoHeader.blockAlign === 2, 'Mono blockAlign should be 2');
  assert(monoHeader.byteRate === sampleRate * 2, 'Mono byteRate should be sampleRate * 1 * 2');
  assert(monoHeader.dataSize === mono.length * 1 * 2, 'Mono data size mismatch');

  const decodedMono = decodeWAV(monoWav);
  assert(decodedMono.channelData.length === 1, 'Decoded mono should have 1 channel');
  assert(decodedMono.channelData[0].length === mono.length, 'Decoded mono length mismatch');
  assert(Math.abs(decodedMono.channelData[0][0] - mono.getChannelData(0)[0]) < 0.01, 'Decoded mono sample mismatch');

  const stereo = createSineBuffer(2, sampleRate, 0.25, 220);
  const stereoWav = encodeAudioBufferWAV(stereo);
  const stereoHeader = readWavHeader(stereoWav.buffer);
  assert(stereoHeader.numChannels === 2, `Expected stereo WAV channels=2, got ${stereoHeader.numChannels}`);
  assert(stereoHeader.blockAlign === 4, 'Stereo blockAlign should be 4');
  assert(stereoHeader.byteRate === sampleRate * 4, 'Stereo byteRate should be sampleRate * 2 * 2');
  assert(stereoHeader.dataSize === stereo.length * 2 * 2, 'Stereo data size mismatch');

  const decodedStereo = decodeWAV(stereoWav);
  assert(decodedStereo.channelData.length === 2, 'Decoded stereo should have 2 channels');
  assert(
    Math.abs(decodedStereo.channelData[1][10] - stereo.getChannelData(1)[10]) < 0.01,
    'Decoded stereo right-channel sample mismatch'
  );

  const serializedMono = serializeAudioBuffer(mono);
  assert(serializedMono.numberOfChannels === 1, 'Serialized mono numberOfChannels');
  assert(serializedMono.right === undefined, 'Serialized mono should omit right');
  const restoredMono = audioBufferFromSerialized(serializedMono);
  assert(restoredMono.numberOfChannels === 1, 'Restored mono AudioBuffer should be 1 channel');
  restoredMono.getChannelData(0);
  let restoredMonoThrew = false;
  try {
    restoredMono.getChannelData(1);
  } catch {
    restoredMonoThrew = true;
  }
  assert(restoredMonoThrew, 'Restored mono buffer must not expose channel 1');

  const legacyStereo = audioBufferFromSerialized({
    left: Array.from(stereo.getChannelData(0)),
    right: Array.from(stereo.getChannelData(1)),
    sampleRate
  });
  assert(legacyStereo.numberOfChannels === 2, 'Legacy left/right payload should restore as stereo');

  const channels = getAudioBufferChannels(mono);
  assert(channels.length === 1, 'getAudioBufferChannels must follow numberOfChannels');

  console.log('✓ Encoder handles mono (1ch) and stereo (2ch) with correct headers\n');
}

async function createMockProject() {
  console.log('Creating mock .musicalia project with mono + stereo clips...');

  const zip = new JSZip();
  const sampleRate = 44100;

  const projectData = {
    version: '0.0072b',
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
            fileName: 'mono.wav',
            startPosition: 0,
            offsetSeconds: 0,
            id: 'clip-mono',
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
        clips: [
          {
            fileName: 'stereo.wav',
            startPosition: 0,
            offsetSeconds: 0,
            id: 'clip-stereo',
            sourceStart: 0,
            duration: 1.0,
            audioFile: 'audio_1_0.wav'
          }
        ]
      }
    ]
  };

  zip.file('project.json', JSON.stringify(projectData, null, 2));

  const monoBuffer = createSineBuffer(1, sampleRate, 1.0, 440);
  const stereoBuffer = createSineBuffer(2, sampleRate, 1.0, 440);

  zip.file('audio_0_0.wav', Buffer.from(encodeAudioBufferWAV(monoBuffer).buffer), { compression: 'STORE' });
  zip.file('audio_1_0.wav', Buffer.from(encodeAudioBufferWAV(stereoBuffer).buffer), { compression: 'STORE' });

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

  const projectFile = zip.file('project.json');
  if (!projectFile) {
    throw new Error('Missing project.json');
  }

  const projectJson = await projectFile.async('string');
  const projectData = JSON.parse(projectJson);

  console.log('Project data:', JSON.stringify(projectData, null, 2));

  const expected = [
    { name: 'audio_0_0.wav', channels: 1 },
    { name: 'audio_1_0.wav', channels: 2 }
  ];

  const audioFiles = {};
  for (const { name, channels } of expected) {
    const audioFile = zip.file(name);
    if (!audioFile) {
      throw new Error(`Missing ${name}`);
    }
    const audioData = await audioFile.async('arraybuffer');
    const header = readWavHeader(audioData);
    const decoded = decodeWAV(new Uint8Array(audioData));
    console.log(`${name}: ${header.numChannels} channels, ${header.sampleRate}Hz, ${audioData.byteLength} bytes`);
    assert(header.numChannels === channels, `${name} expected ${channels} channels, got ${header.numChannels}`);
    assert(decoded.channelData.length === channels, `${name} decode channel count mismatch`);
    audioFiles[name] = { audioData, header, decoded };
  }

  return { projectData, audioFiles };
}

async function test() {
  try {
    console.log('=== Testing .musicalia Round-Trip ===\n');

    testEncoderHandlesChannelCounts();

    const zipBuffer = await createMockProject();
    console.log(`Created .musicalia file: ${zipBuffer.length} bytes\n`);

    await fs.writeFile('/tmp/test.musicalia', zipBuffer);
    console.log('Saved to /tmp/test.musicalia\n');

    const { projectData, audioFiles } = await readMusicalia(zipBuffer);

    console.log('\n=== Verification ===');
    console.log(`✓ Version: ${projectData.version}`);
    console.log(`✓ Project name: ${projectData.name}`);
    console.log(`✓ BPM: ${projectData.bpm}`);
    console.log(`✓ Tracks: ${projectData.tracks.length}`);
    console.log(`✓ Clips in Track 1: ${projectData.tracks[0].clips.length}`);
    console.log(`✓ Clips in Track 2: ${projectData.tracks[1].clips.length}`);
    console.log(`✓ Mono WAV: ${audioFiles['audio_0_0.wav'].header.numChannels} channel, ${audioFiles['audio_0_0.wav'].audioData.byteLength} bytes`);
    console.log(`✓ Stereo WAV: ${audioFiles['audio_1_0.wav'].header.numChannels} channels, ${audioFiles['audio_1_0.wav'].audioData.byteLength} bytes`);

    console.log('\n✅ Round-trip test PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Round-trip test FAILED:', err);
    process.exit(1);
  }
}

test();
