// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Guía en diapositivas: textos e imágenes de «GUIA FACTURAS SECOP II»; en azul, lo que hace ReportS2.
(function () {
    'use strict';
    // hl: recuadros en % de la imagen {x, y, w, h}. note: lo que aporta ReportS2 en ese paso.
    const SLIDES = [
        { img: 'guia/paso1.jpg',
          text: 'En la sección número 7 de sus contratos (Ejecución del contrato) van a encontrar una sección que dice "Plan de pagos" y en la parte lateral derecha de esa sección, identifiquen el botón "Crear".' },
        { img: 'guia/paso2.jpg',
          text: 'Una vez terminado el primer punto, se abrirá una ventana emergente con unos campos por diligenciar. Tengan en cuenta las indicaciones en cada campo.',
          hl: [{ x: 17.5, y: 24.8, w: 47, h: 5.4 }, { x: 19, y: 42.3, w: 33, h: 10.3 }, { x: 21.5, y: 52.5, w: 43, h: 6.6 }],
          note: 'ReportS2 prepara el número de factura, el valor (neto y total) y las notas, listos para copiar. Las fechas las pone la plataforma.' },
        { img: 'guia/paso3.jpg',
          text: 'Completados los campos y habiéndole dado clic en "Anexar", se abrirá esta nueva ventana. Dar clic en "Buscar documento".' },
        { img: 'guia/paso4.jpg',
          text: 'Ubican en su computador el archivo de su <mark>primer paquete de la cuenta de cobro</mark> a cobrar y lo cargan.',
          hl: [{ x: 17.4, y: 51.8, w: 53.3, h: 3.6 }, { x: 25, y: 66, w: 29, h: 3.6 }],
          note: 'ReportS2 genera ese PDF: un paquete por cuota, con los documentos ya ordenados.' },
        { img: 'guia/paso5.jpg',
          text: 'Una vez cargue el documento, dar clic en "Anexar".',
          hl: [{ x: 5, y: 33.2, w: 62, h: 7.6 }],
          note: 'El nombre del archivo también lo define ReportS2: NOMBRE - CUOTA 01 - PAQUETE 1.pdf' },
        { img: 'guia/paso6.jpg',
          text: 'Anexado correctamente el documento, definen esas fechas. En la fecha de recepción original, diligencian la fecha de hoy (o del día que lo suban); en la fecha estimada de pago, eligen 15 días calendario, teniendo en cuenta la fecha en que radican. (Ver ejemplo).',
          hl: [{ x: 8, y: 26.3, w: 56, h: 4.9 }],
          note: 'El archivo anexado es el paquete de ReportS2. Las fechas se definen en la plataforma.' },
        { img: 'guia/paso7.jpg',
          text: 'Una vez confirmen en el paso 6, dar clic en "Enviar".' },
        { img: 'guia/paso8.jpg',
          text: 'Si todo lo hicieron como lo indican los pasos anteriores, el estado del Plan de Pagos de la cuenta enviada, debe quedar en "Enviado a la Entidad Estatal".',
          credit: 'Hecho por: Camilo Rodríguez Villegas' },
    ];

    const $ = (s) => document.querySelector(s);
    let i = 0;

    function show(n) {
        i = Math.max(0, Math.min(SLIDES.length - 1, n));
        const s = SLIDES[i];
        $('#g-count').textContent = `${i + 1} / ${SLIDES.length}`;
        $('#g-step').textContent = `Paso ${i + 1}`;
        $('#g-img').src = s.img;
        $('#g-hl').innerHTML = (s.hl || []).map((b) =>
            `<span class="hl" style="left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%"></span>`).join('');
        $('#g-text').innerHTML = s.text;
        const note = $('#g-note'); note.hidden = !s.note; note.textContent = s.note || '';
        const credit = $('#g-credit'); credit.hidden = !s.credit; credit.textContent = s.credit || '';
        $('#g-prev').disabled = i === 0;
        $('#g-next').disabled = i === SLIDES.length - 1;
        $('#g-dots').innerHTML = SLIDES.map((_, k) => `<button type="button" class="${k === i ? 'on' : ''}" data-go="${k}" aria-label="Paso ${k + 1}"></button>`).join('');
        $('#g-body').scrollTop = 0;
    }

    function open(n = 0) {
        const dlg = $('#guide');
        show(n);
        if (!dlg.open) dlg.showModal();
        dlg.setAttribute('tabindex', '-1'); dlg.focus();
    }

    $('#btn-guide').addEventListener('click', () => open(0));
    $('#g-prev').addEventListener('click', () => show(i - 1));
    $('#g-next').addEventListener('click', () => show(i + 1));
    $('#g-dots').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) show(+b.dataset.go); });
    $('#g-close').addEventListener('click', () => $('#guide').close());
    $('#guide').addEventListener('click', (e) => { if (e.target === $('#guide')) $('#guide').close(); });
    $('#guide').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') show(i + 1);
        else if (e.key === 'ArrowLeft') show(i - 1);
    });
    // Deslizar con el dedo
    let x0 = null;
    $('#g-body').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    $('#g-body').addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 60) show(i + (dx < 0 ? 1 : -1));
    });
})();
