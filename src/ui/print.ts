import { state } from '../app';
import { cueSheet } from '../core/sheet';
import { FRAME_RATE_LABELS } from '../core/timecode';
import { $, el } from './dom';

/**
 * Cue シートの印刷。PC が止まった時の控えとして、全ページの Cue を紙や PDF に出す。
 * ブラウザのメニューや ⌘P から印刷した時も、画面ではなくこのシートを出す。
 */

function cell(tag: 'th' | 'td', text: string, className = ''): HTMLElement {
  return el(tag, className, text);
}

function render(): HTMLElement {
  const sheet = el('div', 'sheet');
  sheet.id = 'print-sheet';

  const pages = cueSheet(state.show);
  const count = pages.reduce((n, p) => n + p.rows.length, 0);
  const printed = new Date().toLocaleString();
  const head = el('header', 'sheet__head');
  head.append(
    el('h1', 'sheet__title', 'TC-CD Cue Sheet'),
    el('p', 'sheet__meta', `${FRAME_RATE_LABELS[state.show.frameRate]} fps · ${pages.length} pages · ${count} cues · Printed ${printed}`),
  );
  sheet.append(head);

  for (const page of pages) {
    const section = el('section', 'sheet__page');
    const notes = [page.offset && `Offset ${page.offset}`, page.tcOff && 'TC OFF'].filter(Boolean).join(' · ');
    const title = el('h2', 'sheet__page-title', page.name);
    if (notes) title.append(el('span', 'sheet__page-notes', notes));
    section.append(title);

    if (page.rows.length === 0) {
      section.append(el('p', 'sheet__empty', 'No cues'));
      sheet.append(section);
      continue;
    }

    const shifted = page.offset !== null;
    const table = el('table', 'sheet__table');
    const headRow = el('tr');
    headRow.append(
      cell('th', 'Cue'),
      cell('th', 'Trigger Time'),
      ...(shifted ? [cell('th', 'Fires at')] : []),
      cell('th', 'Cue Name'),
      cell('th', 'Info'),
      cell('th', 'Stby', 'sheet__num'),
      cell('th', 'MIDI Ch / Note / Vel'),
      cell('th', '✓', 'sheet__check'),
    );
    const thead = el('thead');
    thead.append(headRow);

    const tbody = el('tbody');
    for (const row of page.rows) {
      const tr = el('tr', row.off ? 'is-off' : '');
      tr.append(
        cell('td', row.number, 'sheet__cue'),
        cell('td', row.time, 'sheet__mono'),
        ...(shifted ? [cell('td', row.at ?? '', 'sheet__mono')] : []),
        cell('td', row.off ? `${row.name} (off)` : row.name, 'sheet__name'),
        cell('td', row.info),
        cell('td', row.stby, 'sheet__num sheet__mono'),
        cell('td', row.midi, 'sheet__mono'),
        // 本番中に鉛筆で印を付ける欄
        cell('td', '', 'sheet__check'),
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    section.append(table);
    sheet.append(section);
  }
  return sheet;
}

export function initPrint(): void {
  // 印刷する直前に、その時点のショーで作り直す
  window.addEventListener('beforeprint', () => {
    document.getElementById('print-sheet')?.remove();
    document.body.append(render());
  });
  window.addEventListener('afterprint', () => document.getElementById('print-sheet')?.remove());
  $('file-print').addEventListener('click', () => window.print());
}
