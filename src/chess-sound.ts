type Cue = 'move' | 'capture' | 'castle' | 'check' | 'promotion' | 'mate'

// Each sound is a short sequence of original, synthesized piece taps.
type Tap = { time: number; pitch: number; decay: number; volume: number }
const move: Tap = { time: 0, pitch: 410, decay: .019, volume: .27 }
const cues: Record<Cue, Tap[]> = {
  move: [move],
  capture: [{ time: 0, pitch: 250, decay: .025, volume: .32 }, { ...move, time: .027, volume: .14 }],
  castle: [move, { ...move, time: .065, pitch: 310 }],
  check: [move, { time: .046, pitch: 720, decay: .032, volume: .18 }],
  promotion: [move, { time: .045, pitch: 540, decay: .026, volume: .18 }, { time: .094, pitch: 810, decay: .04, volume: .19 }],
  mate: [{ time: 0, pitch: 540, decay: .04, volume: .24 }, { time: .09, pitch: 270, decay: .06, volume: .23 }],
}

let audio: AudioContext | undefined
const buffers = new Map<Cue, AudioBuffer>()

export async function prepareChessAudio(): Promise<boolean> {
  try {
    audio ??= new AudioContext()
    if (audio.state !== 'running') await audio.resume()
    return audio.state === 'running'
  } catch {
    return false
  }
}

function cueFor(san: string): Cue {
  if (san.endsWith('#')) return 'mate'
  if (san.includes('=')) return 'promotion'
  if (san.endsWith('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

export function playChessSound(san = '') {
  if (!audio || audio.state !== 'running') return
  const cue = cueFor(san)
  let buffer = buffers.get(cue)
  if (!buffer) {
    const taps = cues[cue]
    const sampleRate = audio.sampleRate
    const duration = Math.max(...taps.map(tap => tap.time + tap.decay * 6))
    buffer = audio.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate)
    const samples = buffer.getChannelData(0)
    for (const { time, pitch, decay, volume } of taps) {
      const start = Math.round(time * sampleRate)
      let noise = 0
      for (let i = 0; i < Math.min(samples.length - start, decay * 6 * sampleRate); i++) {
        const elapsed = i / sampleRate
        const phase = 2 * Math.PI * pitch * elapsed
        noise += .32 * (Math.random() * 2 - 1 - noise)
        const impact = noise * Math.exp(-elapsed / .006)
        const body = (.58 * Math.sin(phase) + .26 * Math.sin(phase * 2.45)) * Math.exp(-elapsed / decay)
        samples[start + i] += volume * Math.min(1, elapsed / .001) * (impact + body)
      }
    }
    buffers.set(cue, buffer)
  }
  const source = audio.createBufferSource()
  source.buffer = buffer
  source.connect(audio.destination)
  source.onended = () => source.disconnect()
  source.start()
}
