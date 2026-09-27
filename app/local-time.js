'use strict';

// User-facing calendar dates follow the device timezone. Calendar-day
// arithmetic must not assume that every local day lasts 24 hours (DST).
const pad = n => String(n).padStart(2, '0');

function localDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addCalendarDays(value, days) {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) return d;
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function localDayPlus(days, value = new Date()) {
  return localDay(addCalendarDays(value, days));
}

function addIsoDays(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function localDayRange(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: localDay(d),
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
  };
}

function localStamp(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return localDay(d).replace(/-/g, '') + '-' + pad(d.getHours()) + pad(d.getMinutes());
}

module.exports = { localDay, addCalendarDays, localDayPlus, addIsoDays, localDayRange, localStamp };
