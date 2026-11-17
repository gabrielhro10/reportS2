// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Plantilla del paquete (orden final) y detección de a qué sección pertenece cada página.
(function () {
    'use strict';

    // Orden de salida. `text`: frases que identifican la primera página de la sección (se comparan sin tildes,
    // en mayúsculas y sin espacios ni signos). `hint`: nombre de archivo para páginas sin texto (escaneos).
    const SECTIONS = [
        { key: 'orden',      label: 'Orden de pago',                 text: ['ASUNTO: PAGO A CONTRATISTA'] },
        { key: 'estampillas',label: 'Soporte de estampillas',        text: ['SOPORTE DEL PAGO DE ESTAMPILLAS'] },
        { key: 'causacion',  label: 'Causación de pago',             text: ['CAUSACION DE PAGO'] },
        { key: 'cdp',        label: 'CDP',                           text: ['DISPONIBLE PAC'] },
        { key: 'rp',         label: 'Registro presupuestal',         text: ['AFECTA CUENTA BALANCE'], first: true },
        { key: 'recibido',   label: 'Recibido a satisfacción',       text: ['FORMATO DE RECIBIDO A SATISFACCION'] },
        { key: 'informe',    label: 'Informe de avance',             text: ['INFORME DE AVANCES A CONTRATOS', 'INFORME DE AVANCE A CONTRATOS'] },
        { key: 'acta',       label: 'Acta de inicio',                text: ['OBJETO DEL ACTA'] },
        { key: 'planilla',   label: 'Planilla de seguridad social',  text: ['RESUMEN PLANILLA PAGADA', 'CANCELO LOS APORTES DE SEGURIDAD SOCIAL'], match: isPlanilla, hint: /planilla|\bpila\b|aporte|seguridad.?social/ },
        { key: 'cuenta',     label: 'Cuenta de cobro',               text: ['CUENTA DE COBRO NO'] },
        { key: 'certificacion', label: 'Certificación de retención', text: ['ARTICULO 383'] },
        { key: 'rut',        label: 'RUT',                           text: ['REGISTRO UNICO TRIBUTARIO', 'RESPONSABILIDADES, CALIDADES Y ATRIBUTOS'], hint: /\brut\b/ },
        { key: 'estamp_aut', label: 'Autorización de estampillas',   text: ['AUTORIZACION DE DESCUENTO DE ESTAMPILLAS'], hint: /autoriz/ },
        { key: 'itsa',       label: 'Recibo ITSA',                   text: ['ESTAMPILLA ITSA', 'RECIBO OFICIAL DE PAGO', 'DATOS BASICOS DEL RECIBO'], hint: /itsa|impuesto|recibo/ },
        { key: 'anexo',      label: 'Anexo del contrato',            text: ['ANEXO DE CONDICIONES CONTRACTUALES'], hint: /anexo/ },
        { key: 'secop',      label: 'Contrato SECOP',                text: ['ID DEL CONTRATO EN SECOP'], hint: /secop/ },
        { key: 'banco',      label: 'Certificación bancaria',        text: ['HACEMOS CONSTAR QUE'], hint: /banc|davivienda/ },
        { key: 'cedula',     label: 'Cédula',                        text: [], hint: /cedula|identific|\bcc\b/ },
        { key: 'poliza',     label: 'Póliza',                        text: ['POLIZA DE SEGURO DE CUMPLIMIENTO', 'COMPANIA MUNDIAL DE SEGUROS', 'MUNDIAL DE SEGUROS'], hint: /poliza|seguro/ },
        { key: 'sst',        label: 'Inducción SST',                 text: ['INDUCCION SST', 'CICLO DE APRENDIZAJE'], hint: /sst|induccion/ }
    ];
    SECTIONS.forEach(s => { s.compact = s.text.map(compact); });

    const PRIORITY = [...SECTIONS.filter(s => s.first), ...SECTIONS.filter(s => !s.first)];

    function strip(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    }
    function compact(s) { return strip(s).replace(/[^A-Z0-9]/g, ''); }

    // ---------- Planilla de aportes (PILA) de cualquier operador ----------
    // Cada operador (SOI, Aportes en Línea, Mi Planilla, Asopagos, Enlace Operativo, ARUS…) usa su propio formato,
    // así que en vez de una frase fija se busca: pagos a salud, pensión o ARL + campos propios de una planilla.
    // Siglas cortas con límite de palabra sobre el texto `w`; frases largas sobre el texto compacto `c`.
    const SUBSYSTEMS = [
        // Salud: EPS
        (w, c) => /\bEPS\b/.test(w) || /SALUD(?!O)/.test(c) ||
            /NUEVAEPS|SANITAS|SALUDTOTAL|COOSALUD|MUTUALSER|FAMISANAR|COMPENSAREPS|EMSSANAR|ASMETSALUD|CAJACOPI|SAVIASALUD|ALIANSALUD|SURAEPS|EPSSURA/.test(c),
        // Pensión: AFP
        (w, c) => /\bAFP\b/.test(w) || /PENSION/.test(c) || /COLPENSIONES|PORVENIR|PROTECCION|COLFONDOS|SKANDIA/.test(c),
        // Riesgos laborales: ARL
        (w, c) => /\bARL\b/.test(w) || /RIESGOSLABORALES|RIESGOSPROFESIONALES/.test(c) ||
            /POSITIVACOMPANIA|ARLSURA|SURAARL|SEGUROSBOLIVAR|COLMENASEGUROS|AXACOLPATRIA|LAEQUIDAD|SEGUROSALFA/.test(c),
    ];
    const PILA_FIELDS = [
        (w, c) => /PLANILLA/.test(c) || /\bPILA\b/.test(w),
        (w, c) => /\bIBC\b/.test(w) || /INGRESOBASEDECOTIZACION/.test(c),
        (w, c) => /COTIZANTE/.test(c),
        (w, c) => /APORTANTE/.test(c),
        (w, c) => /DIASCOTIZADOS|DIASCOT/.test(c),
        (w, c) => /OPERADOR/.test(c),
        (w, c) => /\bSOI\b|\bARUS\b/.test(w) ||
            /APORTESENLINEA|MIPLANILLA|ASOPAGOS|ENLACEOPERATIVO|SUAPORTE|PAGOSIMPLE|SIMPLESA|FEDECAJAS|PILAFACIL/.test(c),
    ];
    /** Página de una planilla de aportes: al menos un subsistema (salud, pensión o ARL) y dos campos de planilla. */
    function isPlanilla(rawText) {
        const w = strip(rawText), c = compact(rawText);
        const subs = SUBSYSTEMS.filter(f => f(w, c)).length;
        const fields = PILA_FIELDS.filter(f => f(w, c)).length;
        return subs >= 1 && fields >= 2;
    }

    /** Clave de sección según el texto de la página, o null. */
    function classify(rawText) {
        const c = compact(rawText);
        if (!c) return null;
        // Las marcadas `first` se evalúan antes (el registro presupuestal también trae «Disponible PAC»).
        for (const s of PRIORITY) {
            if (s.compact.some(p => p && c.includes(p))) return s.key;
        }
        // Sin frase exacta: reglas generales (p. ej. planillas de otros operadores).
        for (const s of PRIORITY) {
            if (s.match && s.match(rawText)) return s.key;
        }
        return null;
    }

    function hintFor(fileName) {
        const n = strip(fileName).toLowerCase();
        const found = SECTIONS.find(s => s.hint && s.hint.test(n));
        return found ? found.key : null;
    }

    // «1-3, 5, 8-» → [0,1,2,4,7…] (base 0). «todas» = todas.
    function parseRanges(str, total) {
        const s = String(str || '').trim().toLowerCase();
        if (!s) return [];
        if (s === 'todas' || s === 'all' || s === '*') return Array.from({ length: total }, (_, i) => i);
        const out = [];
        for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
            const m = /^(\d*)-(\d*)$/.exec(part) || /^(\d+)$/.exec(part);
            if (!m) continue;
            let a, b;
            if (m.length === 2) { a = b = +m[1]; }
            else { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
            if (a > b) [a, b] = [b, a];
            for (let p = Math.max(a, 1); p <= Math.min(b, total); p++) out.push(p - 1);
        }
        return out;
    }

    // [0,1,2,4] → «1-3, 5»
    function toRanges(indices) {
        const pages = [...indices].map(i => i + 1).sort((x, y) => x - y);
        const parts = [];
        for (let i = 0; i < pages.length;) {
            let j = i;
            while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
            parts.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
            i = j + 1;
        }
        return parts.join(', ');
    }

    // Secciones propias de cada cuota: si faltan en un paquete se avisa.
    const MONTHLY = new Set(['orden', 'estampillas', 'causacion', 'cdp', 'rp', 'recibido', 'informe', 'acta', 'planilla', 'cuenta', 'certificacion']);

    window.Sections = { SECTIONS, MONTHLY, classify, hintFor, parseRanges, toRanges };
})();
