import { useSettingsStore } from '@/lib/store/settings'
import { isMac } from '@/lib/utils/env'

let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let processor: ScriptProcessorNode | null = null

/** Who started the current capture — decides who may stop it */
let captureOwner: 'user' | 'assistant' | null = null

export function getAudioCaptureOwner(): 'user' | 'assistant' | null {
  return captureOwner
}

function downsampleAndSend(float32: Float32Array): void {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  window.api.sendTranscriptionAudioChunk(int16.buffer)
}

async function openMicrophoneStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false
  })
}

async function openSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  })
  stream.getVideoTracks().forEach((t) => t.stop())
  return stream
}

/**
 * Start capturing microphone/system audio and stream 16 kHz PCM to main.
 * Returns the capture mode actually used: Electron's loopback system audio
 * is Windows-only, so macOS always falls back to the microphone.
 */
export async function startAudioCapture(
  owner: 'user' | 'assistant' = 'user'
): Promise<'system' | 'microphone'> {
  const { audioInputDeviceId, audioOutputDeviceId } = useSettingsStore.getState()

  let stream: MediaStream
  let mode: 'system' | 'microphone'
  if (isMac) {
    // macOS: getDisplayMedia loopback yields a silent track — use microphone
    stream = await openMicrophoneStream(audioInputDeviceId || undefined)
    mode = 'microphone'
  } else if (audioInputDeviceId) {
    try {
      stream = await openMicrophoneStream(audioInputDeviceId)
      mode = 'microphone'
    } catch (err) {
      console.warn('Failed to open selected microphone, falling back to system audio:', err)
      stream = await openSystemAudioStream()
      mode = 'system'
    }
  } else {
    stream = await openSystemAudioStream()
    mode = 'system'
  }

  mediaStream = stream

  audioContext = new AudioContext({ sampleRate: 16000 })

  if (audioOutputDeviceId && 'setSinkId' in audioContext) {
    try {
      await (audioContext as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(
        audioOutputDeviceId
      )
    } catch (err) {
      console.warn('Failed to set audio output device:', err)
    }
  }

  const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))

  processor = audioContext.createScriptProcessor(2048, 1, 1)
  processor.onaudioprocess = (e) => {
    downsampleAndSend(e.inputBuffer.getChannelData(0))
  }
  source.connect(processor)
  processor.connect(audioContext.destination)
  captureOwner = owner
  return mode
}

export function stopAudioCapture(): void {
  captureOwner = null
  if (processor) {
    processor.disconnect()
    processor = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}
