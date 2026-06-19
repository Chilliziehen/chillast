import { h } from '../Dom.js';
import { t } from '../I18n.js';

export function renderSolarTermCalendar(data) {
  const rows = data.terms.map((term) =>
    h('tr', {}, [
      h('td', { class: 'fw-medium' }, term.name),
      h('td', {}, term.date),
      h('td', { class: 'text-muted' }, term.time),
      h('td', { class: 'text-muted' }, term.lunarDate),
    ])
  );

  return h('div', {}, [
    h('div', { class: 'flex gap-2 mb-3' }, [
      h('span', { class: 'chip' }, data.lunarYear),
      data.zodiac ? h('span', { class: 'chip' }, `${data.zodiac}年`) : null,
    ]),
    h('table', { class: 'data-table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', {}, '节气'), h('th', {}, '公历'), h('th', {}, '时间'), h('th', {}, '农历'),
      ])),
      h('tbody', {}, rows),
    ]),
  ]);
}
