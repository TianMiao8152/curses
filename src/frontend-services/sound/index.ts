import { invoke } from "@tauri-apps/api/tauri";
import { proxy } from "valtio";
import { IServiceInterface } from "../../types";

type SoundEffects = {
  volume?: number;
  playbackMin?: number;
  playbackMax?: number;
  detuneMin?: number;
  detuneMax?: number;
};

type VoiceClipOptions = {
  device_name: string;
  volume: number; // 1 - base
  rate: number; // 1 - base
};

class Service_Sound implements IServiceInterface {
  constructor() {}
  private audioContext!: AudioContext;

  async init() {
    this.audioContext = new AudioContext();
  }
  public serviceState = proxy({
    muted: false,
  });


  #voiceClipQueue: { data: ArrayBuffer; options: VoiceClipOptions }[] = [];

  #isVoiceClipPlaying = false;
  async #tryDequeueVoiceClip() {
    if (this.#isVoiceClipPlaying) return;

    const clip = this.#voiceClipQueue.shift();
    // empty queue
    if (!clip) return;

    this.#isVoiceClipPlaying = true;

    await invoke<any>("plugin:audio|play_async", {
      data: {
        data: Array.from(new Uint8Array(clip.data)),
        ...clip.options,
        speed: 1
      },
    });

    // play sound
    this.#isVoiceClipPlaying = false;
    this.#tryDequeueVoiceClip();
  }
  enqueueVoiceClip(buffer: ArrayBuffer, options: VoiceClipOptions) {
    this.#voiceClipQueue.push({ data: buffer, options });
    this.#tryDequeueVoiceClip();
  }

  async playSoundAsync(
    buffer: ArrayBuffer,
    device_name: string,
    options?: { volume: number }
  ) {
    if (!device_name || window.mode !== "host") return;
    await invoke<any>("plugin:audio|play_async", {
      data: {
        device_name,
        data: Array.from(new Uint8Array(buffer)),
      },
    });
    return;
  }

  #audioFiles: { [fileId: string]: AudioBuffer } = {};

  private random = (min: number, max: number) =>
    Math.random() * (max - min) + min;
  async playFile(fileId: string, effects?: SoundEffects) {
    if (this.serviceState.muted) return;

    if (!this.#audioFiles[fileId])
      try {
        const buffer = window.APIFrontend.files.getFileBuffer(fileId);
        if (!buffer) return;
        this.#audioFiles[fileId] = await this.audioContext.decodeAudioData(
          buffer.buffer.slice(0)
        );
      } catch (error) {
        return;
      }

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = effects?.volume || 1; // 10 %
    const conn = gainNode.connect(this.audioContext.destination);

    const source = this.audioContext.createBufferSource();
    source.buffer = this.#audioFiles[fileId];
    source.connect(gainNode);

    // region effects
    // -1200 1200
    if (effects?.detuneMin || effects?.detuneMax) {
      source.detune.value = this.random(
        Math.max(-1200, effects.detuneMin ?? 0),
        Math.min(1200, effects.detuneMax ?? 0)
      );
    }
    if (effects?.playbackMin || effects?.playbackMax) {
      source.playbackRate.value = this.random(
        Math.max(0.1, effects.playbackMin ?? 1),
        Math.min(3, effects.playbackMax ?? 1)
      );
    }
    source.onended = () => {
      conn.disconnect();
    };
    // endregion

    source.start();
  }
}

export default Service_Sound;
