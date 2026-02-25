# 🔁 Loop Machine

A fully client-side browser-based loop station for recording, layering, and mixing audio loops — no server, no sign-up, no installs.

**🔗 Live at [loop.z3r0c1ph3r.com](https://loop.z3r0c1ph3r.com)**

![Smoky Black & Mantis](https://img.shields.io/badge/theme-Smoky%20Black%20%26%20Mantis-82d173?style=flat-square&labelColor=0f0a0a)
![License](https://img.shields.io/badge/license-MIT-82d173?style=flat-square&labelColor=0f0a0a)
![No Dependencies](https://img.shields.io/badge/dependencies-zero-82d173?style=flat-square&labelColor=0f0a0a)

---

## Features

- 🎙️ **Record** — Capture audio from your mic with optional count-in
- 📁 **Upload** — Load any audio file (drag & drop supported)
- 🔁 **Loop** — Set BPM, bars, and time signature — audio loops seamlessly
- 🎚️ **Multi-track** — Unlimited tracks with per-track volume, mute, and solo
- ✂️ **Trim & Place** — Visual trim modal with draggable handles and live preview
- ↔️ **Drag Clips** — Freely reposition clips on the timeline (can overflow edges)
- 🖥️ **Waveforms** — Real-time canvas waveform rendering with animated playhead
- 🔊 **Metronome** — Toggleable click track synced to your BPM
- 💾 **Export** — Render & download your mix as WAV (16/24/32-bit), with options for sample rate, channels, loop count, normalization, and optional metronome bake-in
- ⌨️ **Keyboard shortcuts** — `Space` play/stop · `R` record · `M` metronome

## Tech

Zero dependencies. Pure vanilla:

- **Web Audio API** — AudioContext, OfflineAudioContext, BufferSourceNode, GainNode, OscillatorNode
- **MediaRecorder API** — Mic capture
- **Canvas 2D** — Waveform visualization with devicePixelRatio support
- **CSS Variables** — Themed with Smoky Black `#0f0a0a` and Mantis `#82d173`

## Usage

It's just static HTML/CSS/JS. Open `index.html` in any modern browser, or:

```bash
# Quick local server
python3 -m http.server 8080
# → http://localhost:8080
```

### Keyboard Shortcuts

| Key | Action |
|-------|---------------|
| Space | Play / Stop |
| R | Open Record |
| M | Toggle Metronome |

## License

[MIT](LICENSE) — Built by **Z3R0C1PH3R**
