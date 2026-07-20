import type { BrushId } from './brush-types'

/**
 * Procedural brush sounds — every brush gets its own little voice, synthesized live with the
 * Web Audio API (no samples). A voice is filtered looping noise (plus per-brush extras) whose
 * loudness and brightness follow the pointer's speed, so resting the pen is near-silent and a
 * confident stroke swishes. Everything is deliberately soft: gentle attacks (no clicks), a low
 * master volume, and low-passed timbres.
 */

interface VoiceProfile {
  /** Base loudness of the voice (pre-master). */
  gain: number
  filterType: BiquadFilterType
  /** Filter frequency at rest; speed brightens it up to ~1.6x. */
  frequency: number
  q?: number
  /** Amplitude flutter (scratchiness): LFO rate/depth. */
  flutter?: { rate: number; depth: number }
  /** A quiet pitched hum with vibrato — the wiggly brush's giggle. */
  hum?: { frequency: number; gain: number; vibratoRate: number; vibratoDepth: number }
  /** Occasional soft sine plops — watery brushes bubble now and then. */
  bubbles?: boolean
}

const PROFILES: Record<BrushId, VoiceProfile> = {
  round: { gain: 0.5, filterType: 'lowpass', frequency: 1100 },
  wobble: {
    gain: 0.35,
    filterType: 'lowpass',
    frequency: 900,
    hum: { frequency: 240, gain: 0.16, vibratoRate: 5, vibratoDepth: 28 },
  },
  wetsharp: { gain: 0.55, filterType: 'lowpass', frequency: 520, bubbles: true },
  wetround: { gain: 0.65, filterType: 'lowpass', frequency: 420, bubbles: true },
  crayon: { gain: 0.6, filterType: 'bandpass', frequency: 1700, q: 1.4, flutter: { rate: 12, depth: 0.4 } },
  pastel: { gain: 0.5, filterType: 'lowpass', frequency: 800, flutter: { rate: 7, depth: 0.18 } },
  gouache: { gain: 0.5, filterType: 'lowpass', frequency: 600 },
}

const MASTER_VOLUME = 0.14
const INTENSITY_SMOOTHING = 0.08

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

  /** Must be called from a user-gesture handler (pointerdown qualifies) so the AudioContext
   * is allowed to start. */
  start(brush: BrushId) {
    if (!this.enabled) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') void ctx.resume()
    this.voice?.stop()
    this.voice = this.buildVoice(PROFILES[brush])
  }

  /** Pointer speed in canvas px per ms — mapped to loudness/brightness. */
  move(speed: number) {
    this.voice?.setIntensity(Math.min(1, speed / 1.4))
  }

  stop() {
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
    noise.playbackRate.value = 0.9 + Math.random() * 0.2 // tiny variation stroke-to-stroke

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
      // Scratchy amplitude jitter: LFO wobbling the voice gain around its envelope value.
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
      // Soft random plops while the brush moves — little sine blips with a fast decay.
      const scheduleBubble = () => {
        if (!alive) return
        timers.push(
          setTimeout(() => {
            if (!alive) return
            if (intensity > 0.12) {
              const t = ctx.currentTime
              const osc = ctx.createOscillator()
              osc.type = 'sine'
              osc.frequency.setValueAtTime(140 + Math.random() * 260, t)
              osc.frequency.exponentialRampToValueAtTime(90, t + 0.09)
              const g = ctx.createGain()
              g.gain.setValueAtTime(0.0001, t)
              g.gain.exponentialRampToValueAtTime(0.09 * intensity, t + 0.02)
              g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
              osc.connect(g)
              g.connect(master)
              osc.start(t)
              osc.stop(t + 0.12)
            }
            scheduleBubble()
          }, 160 + Math.random() * 340),
        )
      }
      scheduleBubble()
    }

    return {
      setIntensity: (value: number) => {
        intensity = value
        const t = ctx.currentTime
        // Even a still pen whispers a little while down (0.15 floor) — total silence mid-stroke
        // feels broken; loudness and brightness both ride the speed.
        const level = profile.gain * (0.15 + 0.85 * value)
        voiceGain.gain.setTargetAtTime(level, t, INTENSITY_SMOOTHING)
        filter.frequency.setTargetAtTime(profile.frequency * (0.7 + 0.9 * value), t, INTENSITY_SMOOTHING)
        if (humGain && profile.hum) {
          humGain.gain.setTargetAtTime(profile.hum.gain * (0.2 + 0.8 * value), t, INTENSITY_SMOOTHING)
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
