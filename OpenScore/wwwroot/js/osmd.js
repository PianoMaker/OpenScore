'use strict';
(function () {
    const container = document.getElementById('osmd');
    if (!container) return;

    const scoreUrl = container.getAttribute('data-score-url');

    // Resolve OSMD constructor from different possible globals
    const ns = window.opensheetmusicdisplay || window.OSMD || window.osmd || window;
    const OSMD_Ctor = ns && (ns.OpenSheetMusicDisplay || ns.default || window.OpenSheetMusicDisplay);
    if (!OSMD_Ctor) {
        console.error('OSMD script not loaded or global not found.');
        container.innerText = 'Помилка: бібліотека OSMD не завантажена.';
        return;
    }

    const osmd = new OSMD_Ctor(container, {
        autoResize: true,
        drawTitle: true,
        // Additional cursors for highlighting
        cursorsOptions: [
            { type: 1, color: '#26a69a', alpha: 0.9, follow: true },
            { type: 3, color: '#ffee58', alpha: 0.2, follow: true }
        ]
    });

    // Render default example
    if (scoreUrl) {
        fetch(scoreUrl, { credentials: 'same-origin' })
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} while fetching score`);
                return r.text();
            })
            .then(xml => osmd.load(xml))
            .then(() => {
                osmd.render();
                initTempoFromScore();
            })
            .catch(err => {
                console.error('OSMD load/render error', err);
                container.innerText = 'Помилка завантаження/рендерингу: ' + err;
            });
    }

    // Open local file
    const openBtn = document.getElementById('openFileBtn');
    const fileInput = document.getElementById('fileInput');
    const fileNameSpan = document.getElementById('fileName');

    if (openBtn && fileInput) {
        openBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            stopPlayback();
            if (fileNameSpan) fileNameSpan.textContent = file.name;
            const lower = file.name.toLowerCase();
            const reader = new FileReader();

            if (lower.endsWith('.mxl')) {
                reader.onload = (e) => {
                    const buffer = e.target.result; // ArrayBuffer
                    const binary = arrayBufferToBinaryString(buffer);
                    osmd.load(binary)
                        .then(() => {
                            osmd.render();
                            initTempoFromScore();
                        })
                        .catch(err => {
                            console.error('OSMD load/render error (.mxl)', err);
                            container.innerText = 'Помилка завантаження/рендерингу (.mxl): ' + err;
                        });
                };
                reader.readAsArrayBuffer(file);
            } else {
                reader.onload = (e) => {
                    const text = e.target.result;
                    osmd.load(text)
                        .then(() => {
                            osmd.render();
                            initTempoFromScore();
                        })
                        .catch(err => {
                            console.error('OSMD load/render error (.xml)', err);
                            container.innerText = 'Помилка завантаження/рендерингу (.xml): ' + err;
                        });
                };
                reader.readAsText(file);
            }
        });
    }

    // ---- Simple WebAudio playback with cursor ----
    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const bpmRange = document.getElementById('bpmRange');
    const bpmBox = document.getElementById('bpmBox');

    let audioCtx = null;
    let playing = false;
    let playTimer = null;
    let bpm = 100; // default; can be overridden by score

    // tempo controls sync
    function setTempoUI(val) {
        if (bpmRange) bpmRange.value = String(val);
        if (bpmBox) bpmBox.value = String(val);
    }
    function setTempo(val) {
        const clamped = Math.max(30, Math.min(240, Math.round(Number(val) || bpm)));
        bpm = clamped;
        setTempoUI(bpm);
        if (playing) {
            if (playTimer) clearTimeout(playTimer);
            step();
        }
    }
    if (bpmRange) bpmRange.addEventListener('input', () => setTempo(bpmRange.value));
    if (bpmBox) bpmBox.addEventListener('input', () => setTempo(bpmBox.value));
    setTempoUI(bpm);

    function initTempoFromScore() {
        const m0 = osmd?.Sheet?.SourceMeasures?.[0];
        const scoreBpm = (m0?.TempoInBPM && isFinite(m0.TempoInBPM) && m0.TempoInBPM > 0)
            ? m0.TempoInBPM
            : (osmd?.Sheet?.DefaultStartTempoInBpm && isFinite(osmd.Sheet.DefaultStartTempoInBpm) ? osmd.Sheet.DefaultStartTempoInBpm : null);
        if (scoreBpm) setTempo(scoreBpm);
    }

    if (playBtn) playBtn.addEventListener('click', () => {
        if (playing) return;
        if (!osmd.GraphicSheet && !osmd.graphic) return;
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        osmd.FollowCursor = true;
        const cur = getCursor();
        if (!cur) return;
        cur.reset();
        cur.show();
        playing = true;
        step();
    });

    if (stopBtn) stopBtn.addEventListener('click', () => stopPlayback());

    function stopPlayback() {
        playing = false;
        if (playTimer) { clearTimeout(playTimer); playTimer = null; }
        const cur = getCursor();
        cur?.hide();
    }

    function step() {
        if (!playing) return;
        const cur = getCursor();
        if (!cur) return stopPlayback();

        // sound for notes under cursor
        const notes = (typeof cur.NotesUnderCursor === 'function') ? cur.NotesUnderCursor() : [];
        if (notes && notes.length) {
            const freqs = notes.map(n => midiToFreq(n.halfTone));
            beepChord(freqs, 0.9); // short beep
        }

        // compute delta to next timestamp (in “quarters”)
        const currentTs = cur.Iterator?.currentTimeStamp?.RealValue ?? 0;
        cur.next();
        const nextTs = cur.Iterator?.currentTimeStamp?.RealValue ?? currentTs;
        cur.previous();

        let deltaQuarter = estimateDeltaQuarters(currentTs, nextTs);
        if (deltaQuarter <= 0 || !isFinite(deltaQuarter)) deltaQuarter = 0.25;

        const seconds = (60 / bpm) * deltaQuarter;

        playTimer = setTimeout(() => {
            if (!playing) return;
            cur.next();
            if (cur.Iterator?.EndReached) {
                stopPlayback();
                return;
            }
            step();
        }, seconds * 1000);
    }

    function estimateDeltaQuarters(tsNow, tsNext) {
        let delta = tsNext - tsNow;
        if (!isFinite(delta)) delta = 0.25;
        return Math.max(delta, 0.0625); // >= 1/16 of a quarter
    }

    function beepChord(freqs, gainScale) {
        if (!audioCtx || !freqs || freqs.length === 0) return;
        const durSec = 0.2;
        const now = audioCtx.currentTime;

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.2 * (gainScale ?? 1), now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
        gain.connect(audioCtx.destination);

        for (const f of freqs) {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = f;
            osc.connect(gain);
            osc.start(now);
            osc.stop(now + durSec);
        }
    }

    function midiToFreq(m) { return 880 * Math.pow(2, (m - 69) / 12); } // A4 ref (demo)

    function getCursor() {
        return (osmd.cursors && osmd.cursors[0]) ? osmd.cursors[0] : osmd.cursor;
    }

    // ArrayBuffer -> binary string (chunked) for .mxl
    function arrayBufferToBinaryString(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000; // 32k
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return binary;
    }
})();
