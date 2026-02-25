/* ==========================================================
   LOOP MACHINE — Web Audio Loop Station  (v2)
   ========================================================== */

class LoopMachine {
    constructor() {
        /* ---- Audio ---- */
        this.audioCtx = null;
        this.masterGain = null;
        this.metronomeGain = null;

        /* ---- Settings ---- */
        this.bpm = 120;
        this.beatsPerBar = 4;
        this.totalBars = 4;
        this.masterVolume = 0.8;
        this.metronomeOn = true;

        /* ---- Transport state ---- */
        this.isPlaying = false;
        this.isRecording = false;
        this.tracks = [];
        this.nextTrackId = 1;

        /* ---- Scheduling ---- */
        this.playOriginTime = 0;
        this.loopTimer = null;
        this.activeSources = [];
        this.animFrameId = null;

        /* ---- Recording ---- */
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.recordChunks = [];
        this.recStartTime = 0;

        /* ---- Trim modal state ---- */
        this.trimRawBuffer = null;      // AudioBuffer being trimmed
        this.trimEditTrackId = null;    // null → new track, number → editing existing
        this.trimStart = 0;             // seconds
        this.trimEnd = 0;               // seconds
        this._trimDragging = null;      // 'start' | 'end' | null
        this._trimMoveStart = 0;
        this._trimOrigVal = 0;

        /* ---- Trim preview playback ---- */
        this._trimPreviewSource = null;
        this._trimPreviewPlaying = false;
        this._trimPreviewStartTime = 0;
        this._trimPreviewAnimId = null;
        this._trimCanvasImageData = null;

        /* ---- Clip drag state ---- */
        this._clipDrag = null;          // { trackId, startMouseX, origOffset, containerW }

        /* ---- Waveform cache ---- */
        this.waveformCache = new Map();

        /* ---- Toast timer ---- */
        this.toastTimer = null;

        /* ---- Boot ---- */
        this.cacheDom();
        this.bindEvents();
        this.renderBeatMarkers();
        this.updateLoopDisplay();
    }

    /* ==========================================================
       Computed helpers
    ========================================================== */
    get barDuration()  { return (60 / this.bpm) * this.beatsPerBar; }
    get loopDuration() { return this.barDuration * this.totalBars; }
    get beatDuration() { return 60 / this.bpm; }

    /* ==========================================================
       Audio Context
    ========================================================== */
    async initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = this.masterVolume;
            this.masterGain.connect(this.audioCtx.destination);
            this.metronomeGain = this.audioCtx.createGain();
            this.metronomeGain.gain.value = 0.35;
            this.metronomeGain.connect(this.masterGain);
        }
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    }

    /* ==========================================================
       DOM refs
    ========================================================== */
    cacheDom() {
        const $ = id => document.getElementById(id);
        this.dom = {
            playBtn: $('playBtn'), stopBtn: $('stopBtn'), recordBtn: $('recordBtn'),
            metronomeBtn: $('metronomeBtn'), masterVolume: $('masterVolume'),
            bpmInput: $('bpmInput'), barsInput: $('barsInput'), timeSigSelect: $('timeSigSelect'),
            loopDuration: $('loopDurationDisplay'),
            progressFill: $('progressFill'), progressHead: $('progressHead'),
            beatMarkers: $('beatMarkers'), posBar: $('posBar'), posBeat: $('posBeat'),
            trackList: $('trackList'),
            recordTrackBtn: $('recordTrackBtn'), uploadBtn: $('uploadBtn'), fileInput: $('fileInput'),
            // Record modal
            recordModal: $('recordModal'), modalCloseBtn: $('modalCloseBtn'),
            recDot: $('recDot'), recStatusText: $('recStatusText'),
            recProgressFill: $('recProgressFill'),
            startRecordingBtn: $('startRecordingBtn'), cancelRecordBtn: $('cancelRecordBtn'), discardRecordBtn: $('discardRecordBtn'),
            // Trim modal
            trimModal: $('trimModal'), trimCloseBtn: $('trimCloseBtn'),
            trimTitle: $('trimTitle'),
            trimContainer: $('trimContainer'), trimCanvas: $('trimCanvas'),
            trimRegion: $('trimRegion'),
            trimShadeLeft: $('trimShadeLeft'), trimShadeRight: $('trimShadeRight'),
            trimHandleLeft: $('trimHandleLeft'), trimHandleRight: $('trimHandleRight'),
            trimPlayhead: $('trimPlayhead'),
            trimPlayBtn: $('trimPlayBtn'), trimPlaybackTime: $('trimPlaybackTime'),
            trimStartInput: $('trimStartInput'), trimEndInput: $('trimEndInput'),
            trimDurationDisplay: $('trimDurationDisplay'), trimBarsDisplay: $('trimBarsDisplay'),
            trimCancelBtn: $('trimCancelBtn'), trimApplyBtn: $('trimApplyBtn'),
            // Export modal
            exportBtn: $('exportBtn'),
            exportModal: $('exportModal'), exportCloseBtn: $('exportCloseBtn'),
            exportFormat: $('exportFormat'), exportSampleRate: $('exportSampleRate'),
            exportChannels: $('exportChannels'), exportLoops: $('exportLoops'),
            exportNormalize: $('exportNormalize'), exportMetronome: $('exportMetronome'),
            exportStatus: $('exportStatus'), exportProgressFill: $('exportProgressFill'),
            exportStatusText: $('exportStatusText'),
            exportCancelBtn: $('exportCancelBtn'), exportStartBtn: $('exportStartBtn'),
            // Toast
            toast: $('toast'),
        };
    }

    /* ==========================================================
       Event binding
    ========================================================== */
    bindEvents() {
        /* Transport */
        this.dom.playBtn.addEventListener('click', () => this.togglePlay());
        this.dom.stopBtn.addEventListener('click', () => this.stop());
        this.dom.recordBtn.addEventListener('click', () => this.openRecordModal());
        this.dom.metronomeBtn.addEventListener('click', () => this.toggleMetronome());
        this.dom.masterVolume.addEventListener('input', e => {
            this.masterVolume = +e.target.value;
            if (this.masterGain) this.masterGain.gain.setValueAtTime(this.masterVolume, this.audioCtx.currentTime);
        });

        /* Settings */
        this.dom.bpmInput.addEventListener('change', e => {
            this.bpm = Math.max(30, Math.min(300, parseInt(e.target.value) || 120));
            e.target.value = this.bpm; this.onSettingsChange();
        });
        this.dom.barsInput.addEventListener('change', e => {
            this.totalBars = Math.max(1, Math.min(64, parseInt(e.target.value) || 4));
            e.target.value = this.totalBars; this.onSettingsChange();
        });
        this.dom.timeSigSelect.addEventListener('change', e => {
            this.beatsPerBar = parseInt(e.target.value); this.onSettingsChange();
        });

        /* Actions */
        this.dom.recordTrackBtn.addEventListener('click', () => this.openRecordModal());
        this.dom.uploadBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', e => {
            if (e.target.files.length) this.handleFileUpload(e.target.files[0]);
            e.target.value = '';
        });

        /* Record modal */
        this.dom.modalCloseBtn.addEventListener('click', () => this.closeRecordModal());
        this.dom.cancelRecordBtn.addEventListener('click', () => {
            if (this.isRecording) this.stopRecording(); else this.closeRecordModal();
        });
        this.dom.discardRecordBtn.addEventListener('click', () => {
            if (this.isRecording) this.cancelRecording();
        });
        this.dom.startRecordingBtn.addEventListener('click', () => this.startRecording());
        this.dom.recordModal.addEventListener('click', e => {
            if (e.target === this.dom.recordModal && !this.isRecording) this.closeRecordModal();
        });

        /* Trim modal */
        this.dom.trimCloseBtn.addEventListener('click', () => this.closeTrimModal());
        this.dom.trimCancelBtn.addEventListener('click', () => this.closeTrimModal());
        this.dom.trimApplyBtn.addEventListener('click', () => this.applyTrim());
        this.dom.trimModal.addEventListener('click', e => {
            if (e.target === this.dom.trimModal) this.closeTrimModal();
        });
        this.dom.trimPlayBtn.addEventListener('click', () => this._toggleTrimPreview());

        /* Export modal */
        this.dom.exportBtn.addEventListener('click', () => this.openExportModal());
        this.dom.exportCloseBtn.addEventListener('click', () => this.closeExportModal());
        this.dom.exportCancelBtn.addEventListener('click', () => this.closeExportModal());
        this.dom.exportStartBtn.addEventListener('click', () => this.startExport());
        this.dom.exportModal.addEventListener('click', e => {
            if (e.target === this.dom.exportModal) this.closeExportModal();
        });
        this.dom.trimStartInput.addEventListener('change', e => {
            let v = parseFloat(e.target.value);
            if (isNaN(v) || !this.trimRawBuffer) return;
            v = Math.max(0, Math.min(v, this.trimEnd - 0.05));
            this.trimStart = v;
            e.target.value = v.toFixed(2);
            this._updateTrimUI();
        });
        this.dom.trimEndInput.addEventListener('change', e => {
            let v = parseFloat(e.target.value);
            if (isNaN(v) || !this.trimRawBuffer) return;
            v = Math.max(this.trimStart + 0.05, Math.min(v, this.trimRawBuffer.duration));
            this.trimEnd = v;
            e.target.value = v.toFixed(2);
            this._updateTrimUI();
        });
        this._bindTrimHandles();

        /* Keyboard */
        document.addEventListener('keydown', e => {
            if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
            if (e.code === 'Space')  { e.preventDefault(); this.togglePlay(); }
            if (e.code === 'KeyR')   { e.preventDefault(); this.openRecordModal(); }
            if (e.code === 'KeyM')   { e.preventDefault(); this.toggleMetronome(); }
        });

        /* Global mouse/touch for clip drag */
        window.addEventListener('mouseup', () => this._endClipDrag());
        window.addEventListener('mousemove', e => this._moveClipDrag(e));
        window.addEventListener('touchend', () => this._endClipDrag());
        window.addEventListener('touchcancel', () => this._endClipDrag());
        window.addEventListener('touchmove', e => {
            if (!this._clipDrag) return;
            e.preventDefault();
            const touch = e.touches[0];
            this._moveClipDrag(touch);
        }, { passive: false });

        /* Resize → redraw */
        let rt;
        window.addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => { this.waveformCache.clear(); this.drawAllWaveforms(); }, 200);
        });
    }

    /* ==========================================================
       Settings change
    ========================================================== */
    onSettingsChange() {
        this.renderBeatMarkers();
        this.updateLoopDisplay();
        this.waveformCache.clear();
        if (this.isPlaying) { this.stop(); this.showToast('Playback stopped — settings changed'); }
        this.drawAllWaveforms();
    }
    updateLoopDisplay() { this.dom.loopDuration.textContent = this.loopDuration.toFixed(2) + 's'; }
    renderBeatMarkers() {
        const n = this.totalBars * this.beatsPerBar;
        let h = '';
        for (let i = 0; i < n; i++) h += `<div class="beat-marker${i % this.beatsPerBar === 0 ? ' downbeat' : ''}"></div>`;
        this.dom.beatMarkers.innerHTML = h;
    }

    /* ==========================================================
       Transport
    ========================================================== */
    async togglePlay() { if (this.isPlaying) this.stop(); else await this.play(); }

    async play() {
        if (this.isPlaying) return;
        await this.initAudio();
        this.isPlaying = true;
        this.playOriginTime = this.audioCtx.currentTime;
        this.scheduleLoop(this.playOriginTime);
        this.startAnimLoop();
        this.updateTransportUI();
    }

    stop() {
        this.isPlaying = false;
        if (this.isRecording) this.cancelRecording();
        clearTimeout(this.loopTimer); this.loopTimer = null;
        this.stopAllSources();
        this.stopAnimLoop();
        this.resetPosition();
        this.updateTransportUI();
    }

    stopAllSources() {
        for (const s of this.activeSources) { try { s.stop(); } catch {} }
        this.activeSources = [];
    }

    updateTransportUI() { this.dom.playBtn.classList.toggle('playing', this.isPlaying); }

    /* ==========================================================
       Loop scheduling  (uses trimStart / trimEnd / clipOffset)
    ========================================================== */
    scheduleLoop(startTime) {
        if (!this.isPlaying) return;

        const loopDur = this.loopDuration;
        const barDur  = this.barDuration;
        const beatDur = this.beatDuration;
        const now     = this.audioCtx.currentTime;
        const loopEnd = startTime + loopDur;
        const anySolo = this.tracks.some(t => t.solo);

        /* ---- Metronome ---- */
        if (this.metronomeOn) {
            const totalBeats = this.totalBars * this.beatsPerBar;
            for (let i = 0; i < totalBeats; i++) {
                const t = startTime + Math.floor(i / this.beatsPerBar) * barDur + (i % this.beatsPerBar) * beatDur;
                if (t >= now - 0.01) this.scheduleClick(t, i % this.beatsPerBar === 0);
            }
        }

        /* ---- Tracks ---- */
        for (const track of this.tracks) {
            if (!track.rawBuffer) continue;

            const clipDur = track.trimEnd - track.trimStart;
            if (clipDur <= 0) continue;

            if (!track.gainNode || !track.gainNode.context || track.gainNode.context !== this.audioCtx) {
                track.gainNode = this.audioCtx.createGain();
                track.gainNode.connect(this.masterGain);
            }

            const audible = !track.muted && (!anySolo || track.solo);
            track.gainNode.gain.setValueAtTime(audible ? track.volume : 0, now);

            // Build list of clip instances to schedule
            const instances = [];
            if (track.loop) {
                // Tile the clip across the entire loop
                let pos = 0;
                while (pos < loopDur) {
                    instances.push(pos);
                    pos += clipDur;
                }
            } else {
                instances.push(track.clipOffset);
            }

            for (const offset of instances) {
                const absStart = startTime + offset;
                const absEnd = absStart + clipDur;
                const audibleStart = Math.max(absStart, startTime);
                const audibleEnd = Math.min(absEnd, loopEnd);
                if (audibleStart >= audibleEnd) continue;

                const source = this.audioCtx.createBufferSource();
                source.buffer = track.rawBuffer;
                source.connect(track.gainNode);

                const bufferOffset = track.trimStart + (audibleStart - absStart);
                const playDur = audibleEnd - audibleStart;
                const when = Math.max(audibleStart, now);
                if (when < audibleEnd) {
                    const skipIntoAudible = when - audibleStart;
                    source.start(when, bufferOffset + skipIntoAudible, playDur - skipIntoAudible);
                }
                this.activeSources.push(source);
            }
        }

        /* ---- Next loop ---- */
        const nextStart = startTime + loopDur;
        const msAhead   = (nextStart - now - 0.1) * 1000;
        this.loopTimer = setTimeout(() => {
            this.activeSources.forEach(s => { try { s.stop(); } catch {} });
            this.activeSources = [];
            if (this.isPlaying) this.scheduleLoop(nextStart);
        }, Math.max(0, msAhead));
    }

    /* ==========================================================
       Metronome
    ========================================================== */
    scheduleClick(time, downbeat) {
        if (!this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const env = this.audioCtx.createGain();
        osc.frequency.value = downbeat ? 1000 : 800;
        osc.type = 'sine';
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(0.6, time + 0.001);
        env.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
        osc.connect(env); env.connect(this.metronomeGain);
        osc.start(time); osc.stop(time + 0.065);
    }

    toggleMetronome() {
        this.metronomeOn = !this.metronomeOn;
        this.dom.metronomeBtn.classList.toggle('active', this.metronomeOn);
    }

    /* ==========================================================
       Recording
    ========================================================== */
    /* ---- Wait until the next bar boundary, showing beat countdown ---- */
    _waitForNextBar() {
        return new Promise(resolve => {
            const beatDur = this.beatDuration;
            const barDur = this.barDuration;

            this.dom.recDot.className = 'rec-dot countdown';

            const tick = () => {
                if (!this.isPlaying) { resolve(); return; }

                const elapsed = this.audioCtx.currentTime - this.playOriginTime;
                const loopPos = ((elapsed % this.loopDuration) + this.loopDuration) % this.loopDuration;
                const barPos = loopPos % barDur;

                // How many beats left in this bar
                const currentBeatInBar = Math.floor(barPos / beatDur);
                const beatsLeft = this.beatsPerBar - currentBeatInBar;
                const timeToNextBar = barDur - barPos;

                if (timeToNextBar < 0.03) {
                    // Close enough — go!
                    resolve();
                    return;
                }

                this.dom.recStatusText.textContent = `Starting in ${beatsLeft} beat${beatsLeft !== 1 ? 's' : ''}…`;
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    openRecordModal() {
        if (this.isRecording) return;
        this.resetRecordStatus();
        this.dom.recordModal.classList.remove('hidden');
        this.dom.startRecordingBtn.disabled = false;
    }

    closeRecordModal() {
        if (this.isRecording) return;
        this.dom.recordModal.classList.add('hidden');
    }

    resetRecordStatus() {
        this.dom.recDot.className = 'rec-dot';
        this.dom.recStatusText.textContent = 'Ready to record';
        this.dom.recProgressFill.style.width = '0%';
    }

    async startRecording() {
        await this.initAudio();

        // Request mic
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            });
        } catch {
            this.showToast('Microphone access denied', 'error');
            return;
        }

        this.dom.startRecordingBtn.disabled = true;
        this.dom.startRecordingBtn.classList.add('hidden');
        this.dom.cancelRecordBtn.textContent = '⏹ Stop';
        this.dom.discardRecordBtn.classList.remove('hidden');

        // If playing, count down beats until the next bar boundary
        if (this.isPlaying) {
            await this._waitForNextBar();
        }

        // Setup MediaRecorder
        this.recordChunks = [];
        const mimeType = this._pickMime();
        this.mediaRecorder = new MediaRecorder(this.mediaStream, mimeType ? { mimeType } : {});
        this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.recordChunks.push(e.data); };
        this.mediaRecorder.onstop = () => this._processRecording();

        // GO
        this.isRecording = true;
        this.mediaRecorder.start(100);
        this.dom.recDot.className = 'rec-dot active';
        this.dom.recStatusText.textContent = 'Recording…';
        this.dom.recordBtn.classList.add('recording');

        // NOTE: we do NOT auto-start playback. The user controls play separately.

        this.recStartTime = this.audioCtx.currentTime;
        this._animRecProgress();
    }

    _pickMime() {
        for (const t of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'])
            if (MediaRecorder.isTypeSupported(t)) return t;
        return null;
    }

    _animRecProgress() {
        if (!this.isRecording) return;
        const elapsed = this.audioCtx.currentTime - this.recStartTime;
        const barsElapsed = Math.floor(elapsed / this.barDuration);
        const secs = Math.floor(elapsed);
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const timeStr = `${mins}:${String(s).padStart(2, '0')}`;
        this.dom.recStatusText.textContent = `Recording… ${timeStr}  (${barsElapsed} bar${barsElapsed !== 1 ? 's' : ''})`;
        // Pulse the progress bar back and forth to show we're still recording
        const pulse = (Math.sin(elapsed * 2) + 1) / 2;
        this.dom.recProgressFill.style.width = (30 + pulse * 70) + '%';
        requestAnimationFrame(() => this._animRecProgress());
    }

    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder.stop();
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        this.dom.recordBtn.classList.remove('recording');
        this.dom.recDot.className = 'rec-dot';
        this.dom.recStatusText.textContent = 'Processing…';
        this.dom.recProgressFill.style.width = '100%';
    }

    cancelRecording() {
        this.isRecording = false;
        if (this.mediaRecorder?.state !== 'inactive') {
            this.mediaRecorder.onstop = null;
            this.mediaRecorder.stop();
        }
        this.mediaStream?.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        this.dom.recordBtn.classList.remove('recording');
        this._resetRecordUI();
        this.showToast('Recording discarded');
    }

    async _processRecording() {
        if (!this.recordChunks.length) {
            this.showToast('No audio recorded', 'error');
            this._resetRecordUI(); return;
        }
        try {
            const blob = new Blob(this.recordChunks, { type: this.recordChunks[0].type || 'audio/webm' });
            const ab   = await blob.arrayBuffer();
            const buf  = await this.audioCtx.decodeAudioData(ab);

            // Add directly to timeline
            this.dom.recordModal.classList.add('hidden');
            this._resetRecordUI();
            this.addTrack({
                rawBuffer: buf,
                name: `Recording ${this.nextTrackId}`,
                trimStart: 0,
                trimEnd: buf.duration,
                clipOffset: 0,
            });
            this.showToast('Recording added! 🎵');
        } catch (err) {
            console.error('Recording decode failed:', err);
            this.showToast('Failed to process recording', 'error');
            this._resetRecordUI();
        }
    }

    _resetRecordUI() {
        this.resetRecordStatus();
        this.dom.startRecordingBtn.disabled = false;
        this.dom.startRecordingBtn.classList.remove('hidden');
        this.dom.cancelRecordBtn.textContent = 'Cancel';
        this.dom.discardRecordBtn.classList.add('hidden');
    }

    /* ==========================================================
       File upload
    ========================================================== */
    async handleFileUpload(file) {
        await this.initAudio();
        try {
            this.showToast('Loading audio…');
            const ab  = await file.arrayBuffer();
            const buf = await this.audioCtx.decodeAudioData(ab);
            const name = file.name.replace(/\.[^/.]+$/, '').substring(0, 24);
            this.openTrimModal(buf, null, name);
        } catch (err) {
            console.error('File load failed:', err);
            this.showToast('Failed to load audio file', 'error');
        }
    }

    /* ==========================================================
       Trim Modal
    ========================================================== */
    openTrimModal(buffer, existingTrackId, defaultName) {
        this.trimRawBuffer    = buffer;
        this.trimEditTrackId  = existingTrackId;
        this.trimStart        = 0;
        this.trimEnd          = buffer.duration;

        if (existingTrackId !== null && existingTrackId !== undefined) {
            const t = this.tracks.find(tr => tr.id === existingTrackId);
            if (t) {
                this.trimStart = t.trimStart;
                this.trimEnd   = t.trimEnd;
                this.dom.trimApplyBtn.textContent = '✓ Update Track';
                this.dom.trimTitle.textContent = '✂️ Re-Trim';
            }
        } else {
            this.dom.trimApplyBtn.textContent = '✓ Add to Timeline';
            this.dom.trimTitle.textContent = '✂️ Trim & Place';
        }

        this._trimDefaultName = defaultName || `Track ${this.nextTrackId}`;
        this.dom.trimModal.classList.remove('hidden');
        // Wait a frame so container has layout
        requestAnimationFrame(() => {
            this._drawTrimWaveform();
            this._updateTrimUI();
        });
    }

    closeTrimModal() {
        this._stopTrimPreview();
        this.dom.trimModal.classList.add('hidden');
        this.trimRawBuffer = null;
    }

    /* ---- Trim preview playback ---- */
    _toggleTrimPreview() {
        if (this._trimPreviewPlaying) {
            this._stopTrimPreview();
        } else {
            this._startTrimPreview();
        }
    }

    async _startTrimPreview() {
        if (!this.trimRawBuffer) return;
        await this.initAudio();

        this._stopTrimPreview(); // clean up any existing

        const source = this.audioCtx.createBufferSource();
        source.buffer = this.trimRawBuffer;
        source.connect(this.masterGain);

        const dur = this.trimEnd - this.trimStart;
        source.start(0, this.trimStart, dur);
        source.onended = () => {
            if (this._trimPreviewPlaying) this._stopTrimPreview();
        };

        this._trimPreviewSource = source;
        this._trimPreviewPlaying = true;
        this._trimPreviewStartTime = this.audioCtx.currentTime;

        // Save canvas state for playhead overlay
        const canvas = this.dom.trimCanvas;
        const ctx = canvas.getContext('2d');
        this._trimCanvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        this.dom.trimPlayBtn.textContent = '⏹';
        this.dom.trimPlayBtn.classList.add('playing');
        this.dom.trimPlayhead.classList.add('visible');

        this._animTrimPlayhead();
    }

    _stopTrimPreview() {
        if (this._trimPreviewSource) {
            try { this._trimPreviewSource.onended = null; this._trimPreviewSource.stop(); } catch {}
            this._trimPreviewSource = null;
        }
        this._trimPreviewPlaying = false;
        if (this._trimPreviewAnimId) {
            cancelAnimationFrame(this._trimPreviewAnimId);
            this._trimPreviewAnimId = null;
        }

        // Restore canvas
        if (this._trimCanvasImageData) {
            const ctx = this.dom.trimCanvas.getContext('2d');
            ctx.putImageData(this._trimCanvasImageData, 0, 0);
            this._trimCanvasImageData = null;
        }

        this.dom.trimPlayBtn.textContent = '▶';
        this.dom.trimPlayBtn.classList.remove('playing');
        this.dom.trimPlayhead.classList.remove('visible');
        this.dom.trimPlaybackTime.textContent = '0:00';
    }

    _animTrimPlayhead() {
        if (!this._trimPreviewPlaying || !this.trimRawBuffer) return;

        const elapsed = this.audioCtx.currentTime - this._trimPreviewStartTime;
        const selDur = this.trimEnd - this.trimStart;
        const pos = Math.min(elapsed, selDur);

        // Position playhead — map pos within the full buffer duration
        const bufDur = this.trimRawBuffer.duration;
        const absPos = this.trimStart + pos;
        const contW = this.dom.trimContainer.clientWidth;
        const px = (absPos / bufDur) * contW;
        this.dom.trimPlayhead.style.left = px + 'px';

        // Time display
        const secs = Math.floor(pos);
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        const totalSecs = Math.floor(selDur);
        const totalMins = Math.floor(totalSecs / 60);
        const ts = totalSecs % 60;
        this.dom.trimPlaybackTime.textContent = `${mins}:${String(s).padStart(2, '0')} / ${totalMins}:${String(ts).padStart(2, '0')}`;

        this._trimPreviewAnimId = requestAnimationFrame(() => this._animTrimPlayhead());
    }

    /* ---- Draw the raw waveform on the trim canvas ---- */
    _drawTrimWaveform() {
        const canvas = this.dom.trimCanvas;
        const cont   = this.dom.trimContainer;
        const dpr    = window.devicePixelRatio || 1;
        const w = cont.clientWidth;
        const h = cont.clientHeight;
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#161010';
        ctx.fillRect(0, 0, w, h);

        if (!this.trimRawBuffer) return;

        // Beat grid (using bar duration)
        const bufDur = this.trimRawBuffer.duration;
        const barDur = this.barDuration;
        const beatDur = this.beatDuration;
        for (let t = 0; t < bufDur; t += beatDur) {
            const x = (t / bufDur) * w;
            const isDown = Math.abs(t % barDur) < 0.001 || Math.abs((t % barDur) - barDur) < 0.001;
            ctx.strokeStyle = isDown ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = isDown ? 1 : 0.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

        // Waveform
        const data = this.trimRawBuffer.getChannelData(0);
        this._drawWaveSegment(ctx, data, 0, w, w, h, 'rgba(130,209,115,0.8)');
    }

    /* ---- Update trim handle positions & info text ---- */
    _updateTrimUI() {
        if (!this.trimRawBuffer) return;
        const dur = this.trimRawBuffer.duration;
        const cont = this.dom.trimContainer;
        const w = cont.clientWidth;

        const leftPx  = (this.trimStart / dur) * w;
        const rightPx = (this.trimEnd / dur) * w;

        this.dom.trimHandleLeft.style.left   = leftPx + 'px';
        this.dom.trimHandleRight.style.left  = rightPx + 'px';
        this.dom.trimShadeLeft.style.width   = leftPx + 'px';
        this.dom.trimShadeRight.style.width  = (w - rightPx) + 'px';
        this.dom.trimRegion.style.left       = leftPx + 'px';
        this.dom.trimRegion.style.width      = (rightPx - leftPx) + 'px';

        const selDur = this.trimEnd - this.trimStart;
        this.dom.trimStartInput.value            = this.trimStart.toFixed(2);
        this.dom.trimEndInput.value              = this.trimEnd.toFixed(2);
        this.dom.trimDurationDisplay.textContent = selDur.toFixed(2) + 's';
        this.dom.trimBarsDisplay.textContent     = (selDur / this.barDuration).toFixed(1);
    }

    /* ---- Trim handle dragging ---- */
    _bindTrimHandles() {
        const start = (which, e) => {
            e.preventDefault();
            this._stopTrimPreview(); // stop preview while adjusting
            this._trimDragging = which;
            this._trimMoveStart = e.clientX;
            this._trimOrigVal = which === 'start' ? this.trimStart : this.trimEnd;
        };
        this.dom.trimHandleLeft.addEventListener('mousedown',  e => start('start', e));
        this.dom.trimHandleRight.addEventListener('mousedown', e => start('end', e));

        window.addEventListener('mousemove', e => {
            if (!this._trimDragging || !this.trimRawBuffer) return;
            const cont = this.dom.trimContainer;
            const w = cont.clientWidth;
            const dur = this.trimRawBuffer.duration;
            const dx = e.clientX - this._trimMoveStart;
            const dt = (dx / w) * dur;
            let newVal = this._trimOrigVal + dt;

            const minSel = 0.05; // minimum selection: 50ms
            if (this._trimDragging === 'start') {
                this.trimStart = Math.max(0, Math.min(newVal, this.trimEnd - minSel));
            } else {
                this.trimEnd = Math.max(this.trimStart + minSel, Math.min(newVal, dur));
            }
            this._updateTrimUI();
        });

        window.addEventListener('mouseup', () => { this._trimDragging = null; });
    }

    /* ---- Apply trim → create / update track ---- */
    applyTrim() {
        if (!this.trimRawBuffer) return;
        this._stopTrimPreview();

        if (this.trimEditTrackId !== null && this.trimEditTrackId !== undefined) {
            // Update existing track
            const t = this.tracks.find(tr => tr.id === this.trimEditTrackId);
            if (t) {
                t.trimStart = this.trimStart;
                t.trimEnd   = this.trimEnd;
                this.waveformCache.delete(t.id);
                this.renderTracks();
                this.showToast('Track updated ✂️');
            }
        } else {
            // New track
            this.addTrack({
                rawBuffer:  this.trimRawBuffer,
                name:       this._trimDefaultName,
                trimStart:  this.trimStart,
                trimEnd:    this.trimEnd,
                clipOffset: 0,
            });
            this.showToast('Track added! 🎵');
        }
        this.closeTrimModal();
    }

    /* ==========================================================
       Track management
    ========================================================== */
    addTrack({ rawBuffer, name, trimStart = 0, trimEnd, clipOffset = 0 }) {
        const id = this.nextTrackId++;
        let gainNode = null;
        if (this.audioCtx) {
            gainNode = this.audioCtx.createGain();
            gainNode.gain.value = 1;
            gainNode.connect(this.masterGain);
        }
        this.tracks.push({
            id, name, rawBuffer, gainNode,
            trimStart,
            trimEnd: trimEnd ?? rawBuffer.duration,
            clipOffset,
            muted: false, solo: false, volume: 1,
            loop: false,
        });
        this.renderTracks();
    }

    removeTrack(id) {
        const idx = this.tracks.findIndex(t => t.id === id);
        if (idx === -1) return;
        try { this.tracks[idx].gainNode?.disconnect(); } catch {}
        this.waveformCache.delete(id);
        this.tracks.splice(idx, 1);
        this.updateAllTrackGains();
        this.renderTracks();
    }

    toggleMute(id) {
        const t = this.tracks.find(tr => tr.id === id);
        if (t) { t.muted = !t.muted; this.updateAllTrackGains(); this.renderTracks(); }
    }

    toggleSolo(id) {
        const t = this.tracks.find(tr => tr.id === id);
        if (t) { t.solo = !t.solo; this.updateAllTrackGains(); this.renderTracks(); }
    }

    toggleLoop(id) {
        const t = this.tracks.find(tr => tr.id === id);
        if (t) { t.loop = !t.loop; this.waveformCache.delete(id); this.renderTracks(); }
    }

    setTrackVolume(id, vol) {
        const t = this.tracks.find(tr => tr.id === id);
        if (t) { t.volume = vol; this.updateAllTrackGains(); }
    }

    setTrackName(id, name) {
        const t = this.tracks.find(tr => tr.id === id);
        if (t) t.name = name || `Track ${id}`;
    }

    updateAllTrackGains() {
        if (!this.audioCtx) return;
        const anySolo = this.tracks.some(t => t.solo);
        for (const t of this.tracks) {
            if (!t.gainNode) continue;
            const audible = !t.muted && (!anySolo || t.solo);
            t.gainNode.gain.setTargetAtTime(audible ? t.volume : 0, this.audioCtx.currentTime, 0.02);
        }
    }

    /* ==========================================================
       Clip dragging on waveform  (reposition clipOffset)
    ========================================================== */
    _startClipDrag(trackId, e) {
        const cont = document.querySelector(`[data-waveform-id="${trackId}"]`);
        if (!cont) return;
        const t = this.tracks.find(tr => tr.id === trackId);
        if (!t) return;

        // Check if mouse is over the clip region
        const rect = cont.getBoundingClientRect();
        const mx   = e.clientX - rect.left;
        const w    = cont.clientWidth;
        const loopDur = this.loopDuration;
        const clipDur = t.trimEnd - t.trimStart;

        const clipStartPx = (t.clipOffset / loopDur) * w;
        const clipEndPx = clipStartPx + (clipDur / loopDur) * w;
        // Clamp visible bounds to canvas
        const visStart = Math.max(0, clipStartPx) - 4;
        const visEnd = Math.min(w, clipEndPx) + 4;

        if (mx < visStart || mx > visEnd) return; // not over visible clip

        this._clipDrag = { trackId, startMouseX: e.clientX, origOffset: t.clipOffset, containerW: w };
        cont.classList.add('dragging');
        e.preventDefault();
    }

    _moveClipDrag(e) {
        if (!this._clipDrag) return;
        const { trackId, startMouseX, origOffset, containerW } = this._clipDrag;
        const t = this.tracks.find(tr => tr.id === trackId);
        if (!t) { this._clipDrag = null; return; }

        const dx = e.clientX - startMouseX;
        const dt = (dx / containerW) * this.loopDuration;
        const clipDur = t.trimEnd - t.trimStart;
        // Allow dragging freely — clip can overflow both edges
        // Limit: at least a tiny sliver must remain visible
        const minVisible = 0.01; // seconds
        let newOffset = origOffset + dt;
        newOffset = Math.max(-clipDur + minVisible, Math.min(newOffset, this.loopDuration - minVisible));

        t.clipOffset = newOffset;
        this.waveformCache.delete(trackId);
        this._drawSingleTrackWaveform(t);
    }

    _endClipDrag() {
        if (!this._clipDrag) return;
        const cont = document.querySelector(`[data-waveform-id="${this._clipDrag.trackId}"]`);
        if (cont) cont.classList.remove('dragging');
        this._clipDrag = null;
    }

    /* ==========================================================
       Position & progress
    ========================================================== */
    getPosition() {
        if (!this.isPlaying) return { bar: 1, beat: 1, progress: 0 };
        const elapsed = this.audioCtx.currentTime - this.playOriginTime;
        const pos = ((elapsed % this.loopDuration) + this.loopDuration) % this.loopDuration;
        return {
            bar:  Math.min(Math.floor(pos / this.barDuration) + 1, this.totalBars),
            beat: Math.min(Math.floor((pos % this.barDuration) / this.beatDuration) + 1, this.beatsPerBar),
            progress: pos / this.loopDuration,
        };
    }

    resetPosition() {
        this.dom.posBar.textContent = '1'; this.dom.posBeat.textContent = '1';
        this.dom.progressFill.style.width = '0%'; this.dom.progressHead.style.left = '0%';
        this.drawAllWaveforms();
    }

    /* ==========================================================
       Animation loop
    ========================================================== */
    startAnimLoop() {
        const tick = () => {
            if (!this.isPlaying) return;
            const p = this.getPosition();
            this.dom.posBar.textContent  = p.bar;
            this.dom.posBeat.textContent = p.beat;
            const pct = (p.progress * 100).toFixed(2);
            this.dom.progressFill.style.width = pct + '%';
            this.dom.progressHead.style.left  = pct + '%';
            this._drawAllPlayheads(p.progress);
            this.animFrameId = requestAnimationFrame(tick);
        };
        this.animFrameId = requestAnimationFrame(tick);
    }

    stopAnimLoop() {
        if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = null; }
    }

    /* ==========================================================
       Track rendering
    ========================================================== */
    renderTracks() {
        const list = this.dom.trackList;
        if (!this.tracks.length) {
            list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎵</div><p>No tracks yet</p><p class="hint">Record or upload audio to get started</p></div>`;
            return;
        }
        list.innerHTML = this.tracks.map(t => this._buildTrackHTML(t)).join('');
        for (const t of this.tracks) {
            this._bindTrackEvents(t);
            this._drawSingleTrackWaveform(t);
        }
    }

    _buildTrackHTML(t) {
        const mc = t.muted ? ' muted' : '';
        const sc = t.solo ? ' solo' : '';
        return `
        <div class="track${mc}${sc}" data-track-id="${t.id}">
            <div class="track-header">
                <input class="track-name" type="text" value="${this._esc(t.name)}"
                       data-action="rename" data-id="${t.id}" spellcheck="false">
                <div class="track-header-btns">
                    <button class="track-icon-btn btn-trim" data-action="trim" data-id="${t.id}" title="Trim">✂</button>
                    <button class="track-icon-btn btn-delete" data-action="delete" data-id="${t.id}" title="Delete">✕</button>
                </div>
            </div>
            <div class="track-controls">
                <button class="track-btn btn-mute${t.muted?' active':''}" data-action="mute" data-id="${t.id}">M</button>
                <button class="track-btn btn-solo${t.solo?' active':''}" data-action="solo" data-id="${t.id}">S</button>
                <button class="track-btn btn-loop${t.loop?' active':''}" data-action="loop" data-id="${t.id}" title="Loop/Repeat">🔁</button>
                <div class="track-control-sep"></div>
                <div class="track-control-group">
                    <label>Vol</label>
                    <input type="range" min="0" max="1" step="0.01" value="${t.volume}" data-action="volume" data-id="${t.id}">
                </div>
            </div>
            <div class="track-waveform" data-waveform-id="${t.id}">
                <canvas id="waveform-${t.id}"></canvas>
            </div>
        </div>`;
    }

    _bindTrackEvents(track) {
        const el = document.querySelector(`[data-track-id="${track.id}"]`);
        if (!el) return;
        el.querySelector('[data-action="delete"]').addEventListener('click', () => this.removeTrack(track.id));
        el.querySelector('[data-action="trim"]').addEventListener('click',   () => this.openTrimModal(track.rawBuffer, track.id));
        el.querySelector('[data-action="mute"]').addEventListener('click',   () => this.toggleMute(track.id));
        el.querySelector('[data-action="solo"]').addEventListener('click',   () => this.toggleSolo(track.id));
        el.querySelector('[data-action="loop"]').addEventListener('click',   () => this.toggleLoop(track.id));
        el.querySelector('[data-action="volume"]').addEventListener('input', e => this.setTrackVolume(track.id, +e.target.value));
        el.querySelector('[data-action="rename"]').addEventListener('change', e => this.setTrackName(track.id, e.target.value));

        // Clip drag on waveform (mouse + touch)
        const wf = el.querySelector(`[data-waveform-id="${track.id}"]`);
        wf.addEventListener('mousedown', e => this._startClipDrag(track.id, e));
        wf.addEventListener('touchstart', e => {
            const touch = e.touches[0];
            this._startClipDrag(track.id, touch);
            if (this._clipDrag) e.preventDefault();
        }, { passive: false });
    }

    _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    /* ==========================================================
       Waveform drawing  (FIXED: proper CSS-pixel clipping)
    ========================================================== */
    _drawSingleTrackWaveform(track) {
        const canvas = document.getElementById(`waveform-${track.id}`);
        if (!canvas) return;

        const cont = canvas.parentElement;
        const dpr  = window.devicePixelRatio || 1;
        const w    = cont.clientWidth;
        const h    = cont.clientHeight;
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = '#161010';
        ctx.fillRect(0, 0, w, h);

        const loopDur = this.loopDuration;
        const barDur  = this.barDuration;
        const beatDur = this.beatDuration;

        // Beat grid
        for (let bar = 0; bar < this.totalBars; bar++) {
            for (let beat = 0; beat < this.beatsPerBar; beat++) {
                const t = bar * barDur + beat * beatDur;
                const x = (t / loopDur) * w;
                ctx.strokeStyle = beat === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
                ctx.lineWidth = beat === 0 ? 1 : 0.5;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            }
        }

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

        // Draw clip(s)
        if (track.rawBuffer) {
            const clipDur   = track.trimEnd - track.trimStart;
            const clipPxW   = (clipDur / loopDur) * w;

            // Get trimmed portion of the channel data
            const fullData  = track.rawBuffer.getChannelData(0);
            const sr        = track.rawBuffer.sampleRate;
            const sStart    = Math.floor(track.trimStart * sr);
            const sEnd      = Math.min(Math.floor(track.trimEnd * sr), fullData.length);
            const trimData  = fullData.subarray(sStart, sEnd);

            // Build list of instances to draw
            const offsets = [];
            if (track.loop) {
                let pos = 0;
                while (pos < loopDur) { offsets.push(pos); pos += clipDur; }
            } else {
                offsets.push(track.clipOffset);
            }

            // Track overall visible bounds for shading
            let overallVisStart = w;
            let overallVisEnd = 0;

            for (let idx = 0; idx < offsets.length; idx++) {
                const rawStartPx = (offsets[idx] / loopDur) * w;
                let drawStartPx = rawStartPx;
                let drawData = trimData;
                let drawPxW = clipPxW;

                if (rawStartPx < 0) {
                    const hiddenFrac = -rawStartPx / clipPxW;
                    const sampleOffset = Math.floor(hiddenFrac * drawData.length);
                    drawData = drawData.subarray(sampleOffset);
                    drawPxW = clipPxW + rawStartPx;
                    drawStartPx = 0;
                }
                if (drawStartPx + drawPxW > w) {
                    const visPxW = w - drawStartPx;
                    const visFrac = visPxW / drawPxW;
                    const sampleEnd = Math.ceil(visFrac * drawData.length);
                    drawData = drawData.subarray(0, sampleEnd);
                    drawPxW = visPxW;
                }

                if (drawPxW > 0 && drawData.length > 0) {
                    // Use slightly dimmer color for repeat instances
                    const color = (track.loop && idx > 0) ? 'rgba(130,209,115,0.5)' : 'rgba(130,209,115,0.85)';
                    this._drawWaveSegment(ctx, drawData, drawStartPx, drawPxW, w, h, color);
                }

                const visS = Math.max(0, rawStartPx);
                const visE = Math.min(w, rawStartPx + clipPxW);
                if (visS < overallVisStart) overallVisStart = visS;
                if (visE > overallVisEnd) overallVisEnd = visE;

                // Draw separator line between loop tiles
                if (track.loop && rawStartPx > 0 && rawStartPx < w) {
                    ctx.strokeStyle = 'rgba(130,209,115,0.3)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.moveTo(rawStartPx, 0); ctx.lineTo(rawStartPx, h); ctx.stroke();
                    ctx.setLineDash([]);
                }
            }

            // Shade inactive regions
            if (!track.loop) {
                ctx.fillStyle = 'rgba(15,10,10,0.5)';
                if (overallVisStart > 0) ctx.fillRect(0, 0, overallVisStart, h);
                if (overallVisEnd < w) ctx.fillRect(overallVisEnd, 0, w - overallVisEnd, h);
            }

            // Grab cursor zone indicator
            if (!track.loop && overallVisEnd > overallVisStart) {
                ctx.strokeStyle = 'rgba(130,209,115,0.35)';
                ctx.lineWidth = 1;
                ctx.strokeRect(overallVisStart + 0.5, 0.5, overallVisEnd - overallVisStart - 1, h - 1);
            }
        }

        // Cache for playhead overlay
        this.waveformCache.set(track.id, ctx.getImageData(0, 0, canvas.width, canvas.height));
    }

    /* ---- Draw a waveform segment (CSS-pixel space, clipped to canvasW) ---- */
    _drawWaveSegment(ctx, data, startX, pixelWidth, canvasW, height, color) {
        if (pixelWidth <= 0 || !data.length) return;

        const mid = height / 2;
        ctx.fillStyle = color;
        const totalPx = Math.ceil(pixelWidth);
        const len = data.length;

        for (let px = 0; px < totalPx; px++) {
            const x = Math.floor(startX + px);
            if (x < 0) continue;
            if (x >= canvasW) break;

            // Proper bin boundaries — each pixel gets its exact slice of data
            const s0 = Math.floor((px / pixelWidth) * len);
            const s1 = Math.min(Math.ceil(((px + 1) / pixelWidth) * len), len);

            let lo = 1.0, hi = -1.0;
            for (let s = s0; s < s1; s++) {
                if (data[s] < lo) lo = data[s];
                if (data[s] > hi) hi = data[s];
            }

            const y1 = mid + lo * mid;
            const y2 = mid + hi * mid;
            ctx.fillRect(x, Math.floor(y1), 1, Math.max(1, Math.ceil(y2 - y1)));
        }
    }

    drawAllWaveforms() {
        for (const t of this.tracks) this._drawSingleTrackWaveform(t);
    }

    _drawAllPlayheads(progress) {
        for (const t of this.tracks) {
            const canvas = document.getElementById(`waveform-${t.id}`);
            if (!canvas) continue;
            const dpr = window.devicePixelRatio || 1;
            const ctx = canvas.getContext('2d');
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const cached = this.waveformCache.get(t.id);
            if (cached) ctx.putImageData(cached, 0, 0);

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const x = progress * w;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
            ctx.shadowColor = 'rgba(255,255,255,0.5)'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
    }

    /* ==========================================================
       Toast
    ========================================================== */
    showToast(msg, type = 'info') {
        const t = this.dom.toast;
        t.textContent = msg;
        t.className = `toast ${type}`;
        void t.offsetWidth;
        t.classList.add('visible');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.classList.remove('visible'), 2500);
    }

    /* ==========================================================
       Drag & Drop files
    ========================================================== */
    setupDragDrop() {
        const app = document.getElementById('app');
        app.addEventListener('dragover', e => { e.preventDefault(); app.style.outline = '2px dashed var(--accent)'; });
        app.addEventListener('dragleave', e => { e.preventDefault(); app.style.outline = 'none'; });
        app.addEventListener('drop', e => {
            e.preventDefault(); app.style.outline = 'none';
            if (e.dataTransfer.files.length) {
                const f = e.dataTransfer.files[0];
                if (f.type.startsWith('audio/')) this.handleFileUpload(f);
                else this.showToast('Please drop an audio file', 'error');
            }
        });
    }

    /* ==========================================================
       Export
    ========================================================== */
    openExportModal() {
        if (!this.tracks.length) { this.showToast('Add some tracks first!', 'error'); return; }
        this.dom.exportStatus.classList.add('hidden');
        this.dom.exportProgressFill.style.width = '0%';
        this.dom.exportStartBtn.disabled = false;
        this.dom.exportModal.classList.remove('hidden');
    }

    closeExportModal() {
        this.dom.exportModal.classList.add('hidden');
    }

    async startExport() {
        await this.initAudio();

        const format     = this.dom.exportFormat.value;        // 'wav', 'wav-24', 'wav-32'
        const sampleRate = parseInt(this.dom.exportSampleRate.value);
        const channels   = parseInt(this.dom.exportChannels.value);
        const loops      = parseInt(this.dom.exportLoops.value);
        const normalize  = this.dom.exportNormalize.checked;
        const inclMetro  = this.dom.exportMetronome.checked;

        const totalDur = this.loopDuration * loops;
        const totalSamples = Math.ceil(sampleRate * totalDur);

        // Show progress
        this.dom.exportStatus.classList.remove('hidden');
        this.dom.exportStatusText.textContent = 'Rendering…';
        this.dom.exportProgressFill.style.width = '10%';
        this.dom.exportStartBtn.disabled = true;

        // Small delay to let the UI update
        await new Promise(r => setTimeout(r, 50));

        try {
            // Create offline context
            const offCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);
            const masterGain = offCtx.createGain();
            masterGain.gain.value = this.masterVolume;
            masterGain.connect(offCtx.destination);

            const anySolo = this.tracks.some(t => t.solo);

            // Schedule all loops
            for (let loop = 0; loop < loops; loop++) {
                const loopStart = loop * this.loopDuration;

                // Metronome
                if (inclMetro) {
                    const metroGain = offCtx.createGain();
                    metroGain.gain.value = 0.35;
                    metroGain.connect(masterGain);
                    const totalBeats = this.totalBars * this.beatsPerBar;
                    for (let i = 0; i < totalBeats; i++) {
                        const t = loopStart + Math.floor(i / this.beatsPerBar) * this.barDuration + (i % this.beatsPerBar) * this.beatDuration;
                        const downbeat = i % this.beatsPerBar === 0;
                        const osc = offCtx.createOscillator();
                        const env = offCtx.createGain();
                        osc.frequency.value = downbeat ? 1000 : 800;
                        osc.type = 'sine';
                        env.gain.setValueAtTime(0, t);
                        env.gain.linearRampToValueAtTime(0.6, t + 0.001);
                        env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
                        osc.connect(env); env.connect(metroGain);
                        osc.start(t); osc.stop(t + 0.065);
                    }
                }

                // Tracks
                for (const track of this.tracks) {
                    if (!track.rawBuffer) continue;
                    const clipDur = track.trimEnd - track.trimStart;
                    if (clipDur <= 0) continue;

                    const audible = !track.muted && (!anySolo || track.solo);
                    if (!audible) continue;

                    // Resample buffer if needed
                    let buf = track.rawBuffer;
                    if (buf.sampleRate !== sampleRate) {
                        buf = await this._resampleBuffer(buf, sampleRate, channels);
                    } else if (buf.numberOfChannels !== channels) {
                        buf = this._rechannelBuffer(buf, channels, sampleRate);
                    }

                    const source = offCtx.createBufferSource();
                    source.buffer = buf;
                    const gain = offCtx.createGain();
                    gain.gain.value = track.volume;
                    source.connect(gain); gain.connect(masterGain);

                    // Build instances (tiled if loop is on)
                    const instances = [];
                    if (track.loop) {
                        let pos = 0;
                        while (pos < this.loopDuration) {
                            instances.push(pos);
                            pos += clipDur;
                        }
                    } else {
                        instances.push(track.clipOffset);
                    }

                    const loopEnd = loopStart + this.loopDuration;
                    for (const offset of instances) {
                        const absStart = loopStart + offset;
                        const absEnd = absStart + clipDur;
                        const audibleStart = Math.max(absStart, loopStart);
                        const audibleEnd = Math.min(absEnd, loopEnd);
                        if (audibleStart >= audibleEnd) continue;

                        const src = offCtx.createBufferSource();
                        src.buffer = buf;
                        const g = offCtx.createGain();
                        g.gain.value = track.volume;
                        src.connect(g); g.connect(masterGain);

                        const bufferOffset = track.trimStart + (audibleStart - absStart);
                        const playDur = audibleEnd - audibleStart;
                        src.start(audibleStart, bufferOffset, playDur);
                    }
                }
            }

            this.dom.exportProgressFill.style.width = '40%';
            this.dom.exportStatusText.textContent = 'Rendering audio…';

            const renderedBuffer = await offCtx.startRendering();

            this.dom.exportProgressFill.style.width = '70%';
            this.dom.exportStatusText.textContent = 'Encoding…';
            await new Promise(r => setTimeout(r, 30));

            // Normalize if requested
            let audioData = [];
            for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
                audioData.push(new Float32Array(renderedBuffer.getChannelData(ch)));
            }

            if (normalize) {
                let peak = 0;
                for (const chData of audioData) {
                    for (let i = 0; i < chData.length; i++) {
                        const abs = Math.abs(chData[i]);
                        if (abs > peak) peak = abs;
                    }
                }
                if (peak > 0 && peak !== 1) {
                    const gain = 1 / peak;
                    for (const chData of audioData) {
                        for (let i = 0; i < chData.length; i++) chData[i] *= gain;
                    }
                }
            }

            // Determine bit depth
            let bitDepth = 16;
            if (format === 'wav-24') bitDepth = 24;
            else if (format === 'wav-32') bitDepth = 32;

            // Encode WAV
            const wavBlob = this._encodeWAV(audioData, sampleRate, bitDepth);

            this.dom.exportProgressFill.style.width = '95%';
            this.dom.exportStatusText.textContent = 'Preparing download…';
            await new Promise(r => setTimeout(r, 30));

            // Download
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            const bpmStr = this.bpm;
            const barsStr = this.totalBars;
            a.href = url;
            a.download = `loop-${bpmStr}bpm-${barsStr}bars-${bitDepth}bit.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);

            this.dom.exportProgressFill.style.width = '100%';
            this.dom.exportStatusText.textContent = 'Done! ✓';
            this.showToast('Export complete! 🎧');

            setTimeout(() => this.closeExportModal(), 1500);

        } catch (err) {
            console.error('Export failed:', err);
            this.showToast('Export failed: ' + err.message, 'error');
            this.dom.exportStatusText.textContent = 'Failed ✕';
            this.dom.exportStartBtn.disabled = false;
        }
    }

    /* ---- Resample buffer to target sample rate & channels ---- */
    async _resampleBuffer(buffer, targetRate, targetChannels) {
        const offCtx = new OfflineAudioContext(targetChannels, Math.ceil(buffer.duration * targetRate), targetRate);
        const source = offCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offCtx.destination);
        source.start(0);
        return await offCtx.startRendering();
    }

    /* ---- Convert channel count (mono↔stereo) ---- */
    _rechannelBuffer(buffer, targetChannels, sampleRate) {
        const len = buffer.length;
        const newBuf = new AudioBuffer({ length: len, numberOfChannels: targetChannels, sampleRate });
        if (targetChannels === 1 && buffer.numberOfChannels >= 2) {
            // Stereo to mono — average channels
            const L = buffer.getChannelData(0);
            const R = buffer.getChannelData(1);
            const mono = newBuf.getChannelData(0);
            for (let i = 0; i < len; i++) mono[i] = (L[i] + R[i]) * 0.5;
        } else if (targetChannels === 2 && buffer.numberOfChannels === 1) {
            // Mono to stereo — duplicate
            const src = buffer.getChannelData(0);
            newBuf.getChannelData(0).set(src);
            newBuf.getChannelData(1).set(src);
        } else {
            // Just copy what we can
            for (let ch = 0; ch < Math.min(targetChannels, buffer.numberOfChannels); ch++) {
                newBuf.getChannelData(ch).set(buffer.getChannelData(ch));
            }
        }
        return newBuf;
    }

    /* ---- WAV encoder ---- */
    _encodeWAV(channelData, sampleRate, bitDepth) {
        const numChannels = channelData.length;
        const numSamples  = channelData[0].length;
        const isFloat     = bitDepth === 32;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = numSamples * blockAlign;
        const headerSize = 44;
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view   = new DataView(buffer);

        // RIFF header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this._writeString(view, 8, 'WAVE');

        // fmt chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);                          // chunk size
        view.setUint16(20, isFloat ? 3 : 1, true);             // format (1=PCM, 3=IEEE float)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);      // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);

        // data chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleave and write samples
        let offset = headerSize;
        for (let i = 0; i < numSamples; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = channelData[ch][i];
                if (isFloat) {
                    view.setFloat32(offset, sample, true);
                } else if (bitDepth === 24) {
                    const s = Math.max(-1, Math.min(1, sample));
                    const val = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
                    const intVal = Math.floor(val) | 0;
                    view.setUint8(offset, intVal & 0xFF);
                    view.setUint8(offset + 1, (intVal >> 8) & 0xFF);
                    view.setUint8(offset + 2, (intVal >> 16) & 0xFF);
                } else {
                    // 16-bit
                    const s = Math.max(-1, Math.min(1, sample));
                    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                }
                offset += bytesPerSample;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    _writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/* ============================================================
   Boot
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const lm = new LoopMachine();
    lm.setupDragDrop();
    window.loopMachine = lm;
});
