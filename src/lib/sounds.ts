import type { BrushId } from './brush-types'

/**
 * Procedural brush sounds — every brush gets its own little voice, synthesized live with the
 * Web Audio API (no samples). A voice is looping noise (plus per-brush extras) whose loudness
 * and brightness follow the pointer's speed; a decay timer fades the voice out whenever the
 * pointer stops moving, even mid-press. Everything is deliberately soft: gentle attacks, a low
 * master volume, low-passed timbres.
 *
 * Distinctness comes from more than filter frequency:
 * - `noiseRate` changes the noise TEXTURE — 1.0 is smooth hiss, ~0.12 plays the buffer so
 *   slowly it turns into gravelly crackle (the crayon's scratch).
 * - `hum` adds a wobbling sine — the wiggly brush is more theremin than hiss.
 * - `sweep` slowly swings the filter — watery sloshing / creamy swishing.
 * - `bubbles` schedules soft pitched plops — the wet brushes burble while they paint.
 */

interface VoiceProfile {
  /** Base loudness of the noise layer (pre-master). */
  gain: number
  filterType: BiquadFilterType
  /** Filter frequency at rest; speed brightens it up to ~1.6x. */
  frequency: number
  q?: number
  /** Playback rate of the noise loop — low values turn hiss into crackle. */
  noiseRate?: number
  /** Amplitude flutter (scratchiness): LFO rate/depth. */
  flutter?: { rate: number; depth: number }
  /** Slow LFO on the filter frequency: sloshy/swishy movement. */
  sweep?: { rate: number; depth: number }
  /** A pitched hum with vibrato — the wiggly brush's giggle. */
  hum?: { frequency: number; gain: number; vibratoRate: number; vibratoDepth: number }
  /** Soft random sine plops. */
  bubbles?: { minMs: number; maxMs: number; gain: number; freqLo: number; freqHi: number }
}

const PROFILES: Record<BrushId, VoiceProfile> = {
  /** Clean felt-tip glide: smooth, bright-ish, unadorned. */
  round: { gain: 0.45, filterType: 'lowpass', frequency: 1400 },
  /** More theremin than hiss: a cheerful wobbling tone over a whisper of noise. */
  wobble: {
    gain: 0.1,
    filterType: 'lowpass',
    frequency: 800,
    hum: { frequency: 300, gain: 0.22, vibratoRate: 6, vibratoDepth: 60 },
  },
  /** Watery swish, gently sloshing, with sparse small bubbles. */
  wetsharp: {
    gain: 0.5,
    filterType: 'lowpass',
    frequency: 430,
    sweep: { rate: 0.8, depth: 140 },
    bubbles: { minMs: 150, maxMs: 400, gain: 0.06, freqLo: 200, freqHi: 430 },
  },
  /** Deeper wash with fatter, more frequent burbling. */
  wetround: {
    gain: 0.6,
    filterType: 'lowpass',
    frequency: 340,
    sweep: { rate: 0.6, depth: 120 },
    bubbles: { minMs: 90, maxMs: 260, gain: 0.1, freqLo: 110, freqHi: 340 },
  },
  /** Gravelly wax scratch: the noise buffer crawls (rate 0.12), turning hiss into crackle. */
  crayon: {
    gain: 0.75,
    filterType: 'bandpass',
    frequency: 900,
    q: 1,
    noiseRate: 0.12,
    flutter: { rate: 11, depth: 0.45 },
  },
  /** Muffled dark chalk shhh — halved noise rate softens the texture too. */
  pastel: { gain: 0.5, filterType: 'lowpass', frequency: 380, noiseRate: 0.5 },
  /** Creamy broad swish with a slow, wide filter sweep. */
  gouache: { gain: 0.5, filterType: 'lowpass', frequency: 750, sweep: { rate: 0.45, depth: 260 } },
}

const MASTER_VOLUME = 0.14
const INTENSITY_SMOOTHING = 0.08
/** Without fresh movement, intensity halves roughly every 100ms — a held-still pen goes
 * quiet in about a third of a second instead of droning forever. */
const DECAY_INTERVAL_MS = 100
const DECAY_FACTOR = 0.55

interface ActiveVoice {
  setIntensity(value: number): void
  stop(): void
}

export class BrushSounds {
  enabled = true

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private voice: ActiveVoice | null = null
  private intensity = 0
  private decayTimer: ReturnType<typeof setInterval> | null = null

  /** Must be called from a user-gesture handler (pointerdown qualifies) so the AudioContext
   * is allowed to start. */
  start(brush: BrushId) {
    if (!this.enabled) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') void ctx.resume()
    this.voice?.stop()
    this.voice = this.buildVoice(PROFILES[brush])
    this.intensity = 0
    if (this.decayTimer) clearInterval(this.decayTimer)
    this.decayTimer = setInterval(() => {
      this.intensity = this.intensity < 0.02 ? 0 : this.intensity * DECAY_FACTOR
      this.voice?.setIntensity(this.intensity)
    }, DECAY_INTERVAL_MS)
  }

  /** Pointer speed in px per ms — mapped to loudness/brightness. */
  move(speed: number) {
    this.intensity = Math.min(1, speed / 1.4)
    this.voice?.setIntensity(this.intensity)
  }

  stop() {
    if (this.decayTimer) {
      clearInterval(this.decayTimer)
      this.decayTimer = null
    }
    this.voice?.stop()
    this.voice = null
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) {
      this.stop()
      void this.ctx?.suspend()
    } else {
      void this.ctx?.resume()
    }
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = MASTER_VOLUME
      this.master.connect(this.ctx.destination)
      // 2s of looping white noise — the raw material every voice filters into its own hiss.
      const length = this.ctx.sampleRate * 2
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
      const data = this.noiseBuffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    }
    return this.ctx
  }

  private buildVoice(profile: VoiceProfile): ActiveVoice {
    const ctx = this.ctx!
    const master = this.master!
    const now = ctx.currentTime

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.loop = true
    noise.playbackRate.value = profile.noiseRate ?? 0.9 + Math.random() * 0.2

    const filter = ctx.createBiquadFilter()
    filter.type = profile.filterType
    filter.frequency.value = profile.frequency
    if (profile.q) filter.Q.value = profile.q

    // Voice gain carries the speed envelope; starts silent and eases in (no clicks).
    const voiceGain = ctx.createGain()
    voiceGain.gain.value = 0

    noise.connect(filter)
    filter.connect(voiceGain)
    voiceGain.connect(master)
    noise.start(now)

    const stoppables: { stop(when?: number): void }[] = [noise]
    const timers: ReturnType<typeof setTimeout>[] = []

    if (profile.flutter) {
      const lfo = ctx.createOscillator()
      lfo.type = 'triangle'
      lfo.frequency.value = profile.flutter.rate
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = profile.gain * profile.flutter.depth * 0.5
      lfo.connect(lfoGain)
      lfoGain.connect(voiceGain.gain)
      lfo.start(now)
      stoppables.push(lfo)
    }

    if (profile.sweep) {
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = profile.sweep.rate
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = profile.sweep.depth
      lfo.connect(lfoGain)
      lfoGain.connect(filter.frequency)
      lfo.start(now)
      stoppables.push(lfo)
    }

    let humGain: GainNode | null = null
    if (profile.hum) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = profile.hum.frequency
      const vibrato = ctx.createOscillator()
      vibrato.frequency.value = profile.hum.vibratoRate
      const vibratoGain = ctx.createGain()
      vibratoGain.gain.value = profile.hum.vibratoDepth
      vibrato.connect(vibratoGain)
      vibratoGain.connect(osc.frequency)
      humGain = ctx.createGain()
      humGain.gain.value = 0
      osc.connect(humGain)
      humGain.connect(master)
      osc.start(now)
      vibrato.start(now)
      stoppables.push(osc, vibrato)
    }

    let intensity = 0
    let alive = true

    if (profile.bubbles) {
      const config = profile.bubbles
      const scheduleBubble = () => {
        if (!alive) return
        timers.push(
          setTimeout(() => {
            if (!alive) return
            if (intensity > 0.08) {
              const t = ctx.currentTime
              const osc = ctx.createOscillator()
              osc.type = 'sine'
              osc.frequency.setValueAtTime(config.freqLo + Math.random() * (config.freqHi - config.freqLo), t)
              osc.frequency.exponentialRampToValueAtTime(Math.max(60, config.freqLo * 0.6), t + 0.09)
              const g = ctx.createGain()
              g.gain.setValueAtTime(0.0001, t)
              g.gain.exponentialRampToValueAtTime(config.gain * intensity, t + 0.02)
              g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
              osc.connect(g)
              g.connect(master)
              osc.start(t)
              osc.stop(t + 0.12)
            }
            scheduleBubble()
          }, config.minMs + Math.random() * (config.maxMs - config.minMs)),
        )
      }
      scheduleBubble()
    }

    return {
      setIntensity: (value: number) => {
        intensity = value
        const t = ctx.currentTime
        // No idle floor: a pen holding still fades to silence (the decay timer walks the
        // intensity down); movement brings loudness and brightness back together.
        voiceGain.gain.setTargetAtTime(profile.gain * value, t, INTENSITY_SMOOTHING)
        filter.frequency.setTargetAtTime(profile.frequency * (0.7 + 0.9 * value), t, INTENSITY_SMOOTHING)
        if (humGain && profile.hum) {
          humGain.gain.setTargetAtTime(profile.hum.gain * value, t, INTENSITY_SMOOTHING)
        }
      },
      stop: () => {
        alive = false
        for (const timer of timers) clearTimeout(timer)
        const t = ctx.currentTime
        voiceGain.gain.setTargetAtTime(0, t, 0.05)
        humGain?.gain.setTargetAtTime(0, t, 0.05)
        for (const node of stoppables) node.stop(t + 0.4)
        setTimeout(() => voiceGain.disconnect(), 500)
      },
    }
  }
}
