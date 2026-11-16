// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
(function () {
    'use strict';
    const { classify, hintFor } = window.Sections;
    const { PDFDocument } = window.PDFLib;
    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const icon = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker-3.11.174.min.js';

    // Orden del paquete. Cuota 1 lleva estos documentos; de la cuota 2 en adelante, solo los de LATER. Nada más.
    const FIRST = ['acta', 'recibido', 'estamp_aut', 'itsa', 'informe', 'banco', 'cuenta', 'planilla', 'certificacion', 'sst'];
    const LATER = ['recibido', 'informe', 'cuenta', 'planilla', 'certificacion'];

    const store = {
        get(k, d) { try { const v = localStorage.getItem('reportS2.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('reportS2.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    };

    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const state = {
        files: [], nextId: 1,
        packages: [], cache: new Map(), thumbs: new Map(), busy: false, again: false,
        rep: store.get('rep', {}),
    };

    let toastTimer;
    function toast(msg) {
        const t = $('#toast'); t.textContent = msg; t.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
    }
    const progress = (p) => { $('#progress').style.width = Math.round(p * 100) + '%'; };

    // ---------- Lectura de PDF ----------
    // Une los fragmentos de texto: sin espacio si están pegados en la misma línea (algunos PDF parten cada palabra).
    function joinItems(items) {
        let s = ''; let prev = null;
        for (const it of items) {
            const t = it.str;
            if (prev && t) {
                const same = Math.abs(it.transform[5] - prev.transform[5]) < 2;
                const gap = it.transform[4] - (prev.transform[4] + prev.width);
                const h = Math.abs(it.transform[3]) || 10;
                s += (same && gap < h * 0.12) ? '' : ' ';
            }
            s += t;
            if (t) prev = it;
        }
        return s;
    }

    const fmtMoney = (digits) => String(digits).replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    function detectMeta(f) {
        const text = f.texts.join('\n');
        const get = (re) => { const r = re.exec(text); return r ? r[1] : ''; };
        const valor = get(/LA SUMA DE:?\s*\$\s*([\d.,]+)/i).replace(/[^\d]/g, '');
        return {
            valor: valor ? fmtMoney(valor) : '',
            contrato: get(/CPS\s+No\.?\s*:?\s*([A-Z0-9-]{6,})/i),
            nombre: get(/DEBE A:?\s*([A-ZÁÉÍÓÚÑ ]+?)\s+C\.?\s?C\.?/).trim(),
        };
    }

    // Cuota a la que pertenece el archivo (null = documento común).
    function detectCuota(f) {
        for (let i = 0; i < f.numPages; i++) {
            if (f.classes[i] !== 'cuenta') continue;
            const m = /CUENTA\s*DE\s*COBRO\s*N[oº°]\.?\s*((?:\d\s*)+)/i.exec(f.texts[i]);
            if (m) { const n = parseInt(m[1].replace(/\s/g, ''), 10); if (n) return n; }
        }
        for (let i = 0; i < f.numPages; i++) {
            if (f.classes[i] !== 'orden') continue;
            const m = /DE\s+CUOTA\s*:?\s*0*(\d+)/i.exec(f.texts[i]);
            if (m) return +m[1];
        }
        const m = /(?:cuenta|cuota|paquete)\D{0,4}0*(\d{1,2})(?!\d)/i.exec(f.name);
        return m ? +m[1] : null;
    }

    async function addFiles(list) {
        const pdfs = [...list].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
        if (!pdfs.length) { toast('Solo se admiten PDF'); return; }
        let i = 0;
        for (const file of pdfs) {
            progress(0.5 * (i / pdfs.length)); toast(`Analizando ${file.name}…`);
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
                const texts = [];
                for (let p = 1; p <= doc.numPages; p++) {
                    const page = await doc.getPage(p);
                    texts.push(joinItems((await page.getTextContent()).items));
                    page.cleanup();
                }
                doc.destroy();
                const f = { id: state.nextId++, name: file.name, bytes, numPages: texts.length, texts, classes: [] };
                const hint = hintFor(f.name);
                texts.forEach((t, k) => { f.classes.push(classify(t) || (k > 0 ? f.classes[k - 1] : null) || hint); });
                f.cuota = detectCuota(f);
                f.meta = detectMeta(f);
                state.files.push(f);
            } catch (e) {
                console.error(e);
                toast(`No se pudo leer ${file.name}`);
            }
            i++;
        }
        await rebuild();
    }

    // ---------- Paquetes: uno por cuota ----------
    function planPackages() {
        const own = new Map(); const shared = [];
        for (const f of state.files) {
            if (f.cuota == null) shared.push(f);
            else { if (!own.has(f.cuota)) own.set(f.cuota, []); own.get(f.cuota).push(f); }
        }
        let cuotas = [...own.keys()].sort((a, b) => a - b);
        if (!cuotas.length && state.files.length) { cuotas = [null]; own.set(null, [...state.files]); shared.length = 0; }

        return cuotas.map((c) => {
            const bySlot = new Map();
            const add = (f, i, map) => { const k = f.classes[i]; if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push({ f, i }); };
            own.get(c).forEach((f) => { for (let i = 0; i < f.numPages; i++) add(f, i, bySlot); });
            const fromShared = new Map();
            shared.forEach((f) => { for (let i = 0; i < f.numPages; i++) add(f, i, fromShared); });

            const later = c != null && c >= 2;
            const keys = later ? LATER : FIRST;
            const plan = [];
            for (const k of keys) plan.push(...(bySlot.get(k) || (later ? [] : fromShared.get(k)) || []));

            const metaSrc = own.get(c).find((f) => f.meta.contrato || f.meta.valor) || own.get(c)[0];
            const cu = plan.find((p) => p.f.classes[p.i] === 'cuenta');
            return { cuota: c, files: own.get(c), thumbKey: cu ? `${cu.f.id}:${cu.i}` : null, thumbSrc: cu, plan, meta: { ...metaSrc.meta }, sig: plan.map((p) => `${p.f.id}:${p.i}`).join(','), result: null };
        });
    }

    const cleanName = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const pkgName = (p) => [cleanName(p.meta.nombre), p.cuota != null ? `CUOTA ${pad(p.cuota)}` : '', 'PAQUETE 1'].filter(Boolean).join(' - ') + '.pdf';

    async function buildPdf(pkg) {
        const out = await PDFDocument.create();
        const groups = new Map();
        for (const p of pkg.plan) {
            if (!groups.has(p.f.id)) groups.set(p.f.id, { f: p.f, used: [], pages: [], ptr: 0 });
            groups.get(p.f.id).used.push(p.i);
        }
        for (const g of groups.values()) {
            const src = await PDFDocument.load(g.f.bytes, { ignoreEncryption: true });
            g.pages = await out.copyPages(src, g.used);
        }
        for (const p of pkg.plan) { const g = groups.get(p.f.id); out.addPage(g.pages[g.ptr++]); }
        const name = pkgName(pkg);
        out.setTitle(name.replace(/\.pdf$/, ''));
        const blob = new Blob([await out.save()], { type: 'application/pdf' });
        return { url: URL.createObjectURL(blob), size: blob.size, name };
    }

    async function rebuild() {
        if (state.busy) { state.again = true; return; }
        state.busy = true;
        try {
            do {
                state.again = false;
                const pkgs = planPackages();
                state.packages = pkgs;
                render();
                let k = 0;
                for (const pkg of pkgs) {
                    const key = pkg.sig + '|' + pkgName(pkg);
                    const hit = state.cache.get(key);
                    if (hit) pkg.result = hit;
                    else if (pkg.plan.length) {
                        try { pkg.result = await buildPdf(pkg); state.cache.set(key, pkg.result); }
                        catch (e) { console.error(e); toast(`No se pudo generar la cuota ${pkg.cuota ?? ''}`); }
                    }
                    progress(0.5 + 0.5 * (++k / pkgs.length));
                    renderPackages();
                }
                const keep = new Set(pkgs.map((p) => p.result && p.result.url));
                for (const [k2, v] of [...state.cache]) if (!keep.has(v.url)) { URL.revokeObjectURL(v.url); state.cache.delete(k2); }
            } while (state.again);
            loadThumbs();
            if (state.packages.length) toast(state.packages.length === 1 ? 'Paquete listo' : `${state.packages.length} paquetes listos`);
        } finally {
            state.busy = false; await sleep(400); progress(0);
        }
    }

    // ---------- Datos SECOP (las fechas las pone la plataforma) ----------
    const dmy = (d, sep) => `${pad(d.getDate())}${sep}${pad(d.getMonth() + 1)}${sep}${d.getFullYear()}`;
    const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return y ? new Date(y, m - 1, d) : new Date(); };
    function secopFields(p) {
        const num = pad(p.cuota || 0, 3);
        return [
            ['Número de factura', num],
            ['Valor', p.meta.valor],
            ['Notas', `Se sube primer paquete de cuenta de cobro ${num}`],
        ];
    }

    // Miniatura de la parte superior de la cuenta de cobro (fecha y valor a la vista).
    // Dibuja una página (o una región [x, y, w, h] en fracciones) con el ancho de salida pedido, en PNG nítido.
    async function renderPage(f, i, outWidth, region) {
        const doc = await window.pdfjsLib.getDocument({ data: f.bytes.slice(0) }).promise;
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const frac = region ? region[2] : 1;
        const vp = page.getViewport({ scale: outWidth / (base.width * frac) });
        const full = document.createElement('canvas'); full.width = Math.round(vp.width); full.height = Math.round(vp.height);
        await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
        let out = full;
        if (region) {
            const x = Math.round(vp.width * region[0]), y = Math.round(vp.height * region[1]);
            const w = Math.round(vp.width * region[2]), h = Math.round(vp.height * region[3]);
            out = document.createElement('canvas'); out.width = w; out.height = h;
            out.getContext('2d').drawImage(full, x, y, w, h, 0, 0, w, h);
        }
        doc.destroy();
        return out.toDataURL('image/png');
    }
    // Miniatura: solo la zona con la fecha, el número y el valor, a ~2x del tamaño en que se muestra.
    const makeThumb = (f, i) => renderPage(f, i, 1000, [0.1, 0.07, 0.8, 0.27]);

    // Popup con la cuenta de cobro completa.
    async function openZoom(idx) {
        const p = state.packages[idx]; if (!p || !p.thumbSrc) return;
        const dlg = $('#zoom'), img = $('#zoom-img');
        img.src = state.thumbs.get(p.thumbKey) || '';
        if (!dlg.open) dlg.showModal();
        const key = 'full:' + p.thumbKey;
        try {
            if (!state.thumbs.has(key)) state.thumbs.set(key, await renderPage(p.thumbSrc.f, p.thumbSrc.i, 1500, null));
            if (dlg.open) img.src = state.thumbs.get(key);
        } catch (e) { console.error(e); }
    }
    async function loadThumbs() {
        for (const p of state.packages) {
            if (!p.thumbKey || state.thumbs.has(p.thumbKey)) continue;
            try { state.thumbs.set(p.thumbKey, await makeThumb(p.thumbSrc.f, p.thumbSrc.i)); renderPackages(); }
            catch (e) { console.error(e); }
        }
    }

    // ---------- Reportes ----------
    const keyOf = (p) => (p && p.meta.contrato) || 'general';
    const repData = (key) => (state.rep[key] ||= { total: 11, done: {} });
    const isReported = (key, n) => !!repData(key).done[String(n)];
    function toggleReported(key, n) {
        const r = repData(key); const k = String(n);
        if (r.done[k]) delete r.done[k]; else r.done[k] = todayISO();
        store.set('rep', state.rep);
        renderPackages(); renderRep();
    }

    // ---------- Render ----------
    function render() {
        const has = state.files.length > 0;
        $('#empty').hidden = has;
        $('#files-block').hidden = !has;
        $('#btn-clear').hidden = !has;
        $('#files').innerHTML = state.files.map((f) =>
            `<li><span class="nm">${esc(f.name)}</span><span class="pg">${f.numPages} pág.</span>` +
            `<button type="button" class="icon-btn" data-rm="${f.id}" aria-label="Quitar">${icon('close')}</button></li>`).join('');
        renderPackages(); renderRep();
    }

    function renderPackages() {
        const pk = state.packages;
        $('#pkg-block').hidden = !pk.length;
        $('#btn-all').hidden = pk.filter((p) => p.result).length < 2;
        $('#pkg-count').textContent = pk.length ? `${pk.length}` : '';
        $('#pkgs').innerHTML = pk.map((p, idx) => {
            const r = p.result; const key = keyOf(p);
            const done = p.cuota != null && isReported(key, p.cuota);
            const title = p.cuota != null ? `Cuota ${pad(p.cuota)}` : 'Paquete';
            const sub = [p.meta.nombre, `${p.plan.length} pág.`, r ? `${(r.size / 1048576).toFixed(1)} MB` : 'Generando…'].filter(Boolean).join(' · ');
            const acts = r
                ? `<a class="btn primary" href="${r.url}" download="${esc(r.name)}">${icon('download')}Descargar</a>` +
                  `<a class="btn" href="${r.url}" target="_blank" rel="noopener">${icon('open')}Abrir</a>`
                : '';
            const rep = p.cuota != null ? `<button type="button" class="btn${done ? ' done' : ''}" data-report="${idx}">${icon('done')}${done ? 'Reportada' : 'Reportar'}</button>` : '';
            const thumb = p.thumbKey && state.thumbs.get(p.thumbKey);
            const rows = secopFields(p).map(([k, v]) =>
                `<li><span class="k">${esc(k)}</span><span class="v">${esc(v) || '—'}</span>` +
                (v ? `<button type="button" class="icon-btn" data-copy="${esc(v)}" aria-label="Copiar ${esc(k)}">${icon('copy')}</button>` : '') + `</li>`).join('');
            return `<article class="pkg"><button type="button" class="pk-thumb" data-zoom="${idx}" aria-label="Ver la cuenta de cobro en grande">${thumb ? `<img src="${thumb}" alt="Parte superior de la cuenta de cobro">` : '<span class="muted">Generando vista previa…</span>'}</button>` +
                `<div class="pk-main"><header><div class="pk-title"><b>${title}</b><span class="muted">${esc(sub)}</span></div>` +
                `<label class="consec">Consecutivo<input type="text" inputmode="numeric" value="${p.cuota ?? ''}" data-consec="${idx}" aria-label="Consecutivo"></label>` +
                `<div class="pk-actions">${acts}${rep}</div></header>` +
                `<ul class="rows">${rows}</ul></div></article>`;
        }).join('');
    }

    function renderRep() {
        const keys = [...new Set([...state.packages.map(keyOf), ...Object.keys(state.rep)])];
        const current = new Set(state.packages.map((p) => keyOf(p) + '#' + p.cuota));
        $('#rep-groups').innerHTML = keys.length ? keys.map((key) => {
            const r = repData(key);
            let chips = '';
            for (let n = 1; n <= r.total; n++) {
                const d = r.done[String(n)];
                chips += `<button type="button" class="chip-c${d ? ' done' : ''}${current.has(key + '#' + n) ? ' cur' : ''}" data-key="${esc(key)}" data-n="${n}">${n}<small>${d ? dmy(parseISO(d), '/') : '·'}</small></button>`;
            }
            return `<div class="rep-group"><div class="rep-head"><b>${key === 'general' ? 'Cuotas' : esc(key)}</b><span class="muted">${Object.keys(r.done).length} / ${r.total}</span></div>` +
                `<div class="chips">${chips}</div>` +
                `<div class="rep-foot"><label class="inline">Total<input type="text" inputmode="numeric" value="${r.total}" data-total="${esc(key)}"></label>` +
                `<button type="button" class="btn small danger" data-reset="${esc(key)}">Reiniciar</button></div></div>`;
        }).join('') : '<p class="muted">Sin cuotas todavía</p>';
    }

    // ---------- Acciones ----------
    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); }
        catch (e) {
            const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e2) { /* nada */ }
            ta.remove();
        }
        toast('Copiado');
    }

    async function downloadAll() {
        for (const p of state.packages) {
            if (!p.result) continue;
            const a = document.createElement('a'); a.href = p.result.url; a.download = p.result.name;
            document.body.appendChild(a); a.click(); a.remove();
            await sleep(600);
        }
    }

    function clearAll() {
        if (!confirm('¿Limpiar archivos y paquetes? El seguimiento de reportes se conserva.')) return;
        for (const v of state.cache.values()) URL.revokeObjectURL(v.url);
        state.cache.clear(); state.thumbs.clear(); state.files = []; state.packages = [];
        $('#file-input').value = '';
        render(); toast('Limpio');
    }

    const setSheet = (open) => document.body.classList.toggle('sheet-open', open);

    // ---------- Eventos ----------
    $('#pkgs').addEventListener('click', (e) => {
        const z = e.target.closest('[data-zoom]');
        if (z) return openZoom(+z.dataset.zoom);
        const c = e.target.closest('[data-copy]');
        if (c) return copyText(c.dataset.copy);
        const r = e.target.closest('[data-report]');
        if (r) { const p = state.packages[+r.dataset.report]; toggleReported(keyOf(p), p.cuota); }
    });
    // Corrección del consecutivo: cambia el número de factura y, si pasa a ser la cuota 1 o 2+, el contenido del paquete.
    $('#pkgs').addEventListener('change', (e) => {
        const inp = e.target.closest('[data-consec]'); if (!inp) return;
        const p = state.packages[+inp.dataset.consec]; const n = parseInt(inp.value, 10);
        if (!n) { renderPackages(); return; }
        p.files.forEach((f) => { f.cuota = n; });
        rebuild();
    });
    $('#files').addEventListener('click', (e) => {
        const b = e.target.closest('[data-rm]'); if (!b) return;
        state.files = state.files.filter((f) => f.id !== +b.dataset.rm);
        rebuild();
    });
    $('#rep-groups').addEventListener('click', (e) => {
        const c = e.target.closest('.chip-c');
        if (c) return toggleReported(c.dataset.key, +c.dataset.n);
        const r = e.target.closest('[data-reset]');
        if (r && confirm('¿Borrar el seguimiento de este contrato?')) { delete state.rep[r.dataset.reset]; store.set('rep', state.rep); renderPackages(); renderRep(); }
    });
    $('#rep-groups').addEventListener('change', (e) => {
        const t = e.target.closest('[data-total]'); if (!t) return;
        repData(t.dataset.total).total = Math.min(60, Math.max(1, parseInt(t.value, 10) || 11));
        store.set('rep', state.rep); renderRep();
    });
    $('#zoom').addEventListener('click', (e) => { if (e.target === $('#zoom') || e.target.closest('#zoom-close')) $('#zoom').close(); });
    $('#file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    $('#add').addEventListener('click', () => $('#file-input').click());
    $('#add-empty').addEventListener('click', () => $('#file-input').click());
    $('#btn-all').addEventListener('click', downloadAll);
    $('#btn-clear').addEventListener('click', clearAll);
    $('#btn-settings').addEventListener('click', () => setSheet(!document.body.classList.contains('sheet-open')));
    $('#sheet-done').addEventListener('click', () => setSheet(false));
    $('#scrim').addEventListener('click', () => setSheet(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSheet(false); });

    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
    document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
        addFiles(e.dataTransfer.files);
    });

    $('#ver').textContent = 'ReportS2 v' + (self.APP_VERSION || '');
    if (window.AppUpdate) window.AppUpdate.init();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    render();
})();
