'use strict';

const DB_NAME = 'traintrack-db';
const DB_VERSION = 1;
const STORE = 'app';
const DEFAULTS = {
  attendance: [],
  plannedDays: [1, 2, 3, 4, 5],
  streakMode: 'calendar',
  reminderEnabled: false,
  reminderTime: '17:30',
  lastRemindedDate: null,
  photos: {},
  savedVideos: []
};

let db;
let state = structuredClone(DEFAULTS);
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let photoMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let statsYear = new Date().getFullYear();
let installPrompt = null;
let toastTimer = null;
let confirmAction = null;

const $ = (id) => document.getElementById(id);
const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const monthShort = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const weekdayNames = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Este navegador não oferece armazenamento local compatível.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento.'));
  });
}

function readState() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get('main');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function writeState() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, 'main');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Falha ao salvar os dados.'));
    tx.onabort = () => reject(tx.error || new Error('Salvamento cancelado.'));
  });
}

function mergeState(saved) {
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULTS);
  return {
    ...structuredClone(DEFAULTS),
    ...saved,
    attendance: Array.isArray(saved.attendance) ? [...new Set(saved.attendance.filter(validDateKey))].sort() : [],
    plannedDays: Array.isArray(saved.plannedDays) ? [...new Set(saved.plannedDays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))] : [...DEFAULTS.plannedDays],
    photos: saved.photos && typeof saved.photos === 'object' ? saved.photos : {},
    savedVideos: Array.isArray(saved.savedVideos) ? saved.savedVideos.filter(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(item.id)).slice(0, 30) : []
  };
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function photoKey(date, slot) {
  return `${monthKey(date)}-${slot}`;
}

function sameMonth(key, date) {
  return key.startsWith(`${monthKey(date)}-`);
}

function planned(date) {
  return state.plannedDays.includes(date.getDay());
}

function monthAttendance(date) {
  const prefix = monthKey(date);
  return state.attendance.filter(key => key.startsWith(prefix));
}

function yearAttendance(year) {
  return state.attendance.filter(key => key.startsWith(`${year}-`));
}

function plannedCountInMonth(date) {
  const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= total; day++) if (state.plannedDays.includes(new Date(date.getFullYear(), date.getMonth(), day).getDay())) count++;
  return count;
}

function attendancePercent(date) {
  const target = plannedCountInMonth(date);
  return target ? Math.round((monthAttendance(date).length / target) * 100) : 0;
}

function consecutiveStreaks(attendanceDates, mode) {
  const dates = [...new Set(attendanceDates)].sort();
  if (!dates.length) return { best: 0, current: 0 };
  if (mode === 'planned') {
    const plannedDates = dates.filter(key => planned(parseDateKey(key)));
    let best = 0, run = 0, previous = null;
    for (const key of plannedDates) {
      const current = parseDateKey(key);
      if (!previous) run = 1;
      else {
        let next = shiftDate(previous, 1);
        while (!planned(next)) next = shiftDate(next, 1);
        run = dateKey(next) === key ? run + 1 : 1;
      }
      best = Math.max(best, run);
      previous = current;
    }
    let current = 0;
    let cursor = new Date();
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    // O dia planejado de hoje ainda pode ser concluído; não quebra a sequência antes do fim do dia.
    if (planned(cursor) && !state.attendance.includes(dateKey(cursor))) {
      const now = new Date();
      const dayIsStillOpen = now.getHours() < 23 || now.getMinutes() < 59;
      if (dayIsStillOpen) cursor = shiftDate(cursor, -1);
    }
    while (current < 3700) {
      if (planned(cursor)) {
        if (state.attendance.includes(dateKey(cursor))) current++;
        else break;
      }
      cursor = shiftDate(cursor, -1);
    }
    return { best, current };
  }

  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((parseDateKey(dates[i]) - parseDateKey(dates[i - 1])) / 86400000);
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const today = dateKey(new Date());
  const yesterday = dateKey(shiftDate(new Date(), -1));
  let cursorKey = dates[dates.length - 1];
  let current = 0;
  if (cursorKey === today || cursorKey === yesterday) {
    let cursor = parseDateKey(cursorKey);
    while (state.attendance.includes(dateKey(cursor))) {
      current++;
      cursor = shiftDate(cursor, -1);
    }
  }
  return { best, current };
}

function longestStreakWithinYear(year) {
  const dates = yearAttendance(year);
  if (!dates.length) return 0;
  if (state.streakMode === 'planned') {
    const plannedDates = dates.filter(key => planned(parseDateKey(key)));
    let best = 0, run = 0, prev = null;
    for (const key of plannedDates) {
      const cur = parseDateKey(key);
      if (!prev) run = 1;
      else {
        let next = shiftDate(prev, 1);
        while (!planned(next)) next = shiftDate(next, 1);
        run = dateKey(next) === key ? run + 1 : 1;
      }
      best = Math.max(best, run); prev = cur;
    }
    return best;
  }
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = Math.round((parseDateKey(dates[i]) - parseDateKey(dates[i - 1])) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function askConfirm(title, message, action, buttonText = 'Confirmar') {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('acceptConfirm').textContent = buttonText;
  confirmAction = action;
  $('confirmModal').hidden = false;
}

function closeConfirm() {
  $('confirmModal').hidden = true;
  confirmAction = null;
}

async function saveAndRender(message) {
  try {
    await writeState();
    renderAll();
    if (message) showToast(message);
  } catch (error) {
    console.error(error);
    showToast('Não foi possível salvar. Exporte um backup e tente novamente.');
  }
}

function toggleAttendance(key) {
  if (!validDateKey(key)) return;
  const date = parseDateKey(key);
  const today = new Date();
  today.setHours(0,0,0,0);
  if (date > today) return showToast('Não é possível registrar um treino em uma data futura.');
  if (state.attendance.includes(key)) {
    state.attendance = state.attendance.filter(item => item !== key);
    saveAndRender('Registro de treino removido.');
  } else {
    state.attendance.push(key);
    state.attendance.sort();
    saveAndRender('Treino registrado. Boa consistência!');
  }
}

function renderHome() {
  const now = new Date();
  const today = dateKey(now);
  $('fullDate').textContent = new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(now);
  $('yearChip').textContent = String(now.getFullYear());
  const done = state.attendance.includes(today);
  $('heroTitle').textContent = done ? 'Treino registrado!' : 'Fez seu treino?';
  $('heroDescription').textContent = done ? 'Você já marcou seu treino de hoje. Continue mantendo a consistência.' : 'Registre com um toque e acompanhe sua consistência.';
  $('markTodayBtn').textContent = done ? '✓  TREINO REGISTRADO' : '✓  TREINO CONCLUÍDO';
  $('markTodayBtn').classList.toggle('is-done', done);
  const streaks = consecutiveStreaks(state.attendance, state.streakMode);
  $('currentStreak').textContent = streaks.current;
  $('bestStreak').textContent = streaks.best;
  $('streakModeLabel').textContent = state.streakMode === 'planned' ? 'Dias de treino planejados' : 'Dias consecutivos';
  $('monthCount').textContent = monthAttendance(now).length;
  const percent = attendancePercent(now);
  $('monthProgressLabel').textContent = `${percent}% da meta planejada`;
  $('yearCount').textContent = yearAttendance(now.getFullYear()).length;
  $('yearLabel').textContent = String(now.getFullYear());
  $('homeMonthTitle').textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  $('homePercent').textContent = `${percent}%`;
  $('homeProgressFill').style.width = `${Math.min(percent, 100)}%`;
  const mini = $('miniWeek');
  mini.innerHTML = '';
  for (let offset = -6; offset <= 0; offset++) {
    const date = shiftDate(now, offset);
    const key = dateKey(date);
    const item = document.createElement('div');
    item.className = 'mini-day';
    const label = document.createElement('small');
    label.textContent = weekdayNames[date.getDay()];
    const dot = document.createElement('span');
    dot.className = `mini-dot${state.attendance.includes(key) ? ' done' : ''}${key === today ? ' today' : ''}`;
    dot.textContent = date.getDate();
    item.append(label, dot);
    mini.append(item);
  }
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  $('calendarMonthTitle').textContent = `${monthNames[month]} ${year}`;
  const grid = $('calendarGrid');
  grid.innerHTML = '';
  ['D','S','T','Q','Q','S','S'].forEach(letter => {
    const heading = document.createElement('div'); heading.className = 'weekday'; heading.textContent = letter; grid.append(heading);
  });
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div'); blank.className = 'calendar-day empty'; grid.append(blank);
  }
  const today = dateKey(new Date());
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const key = dateKey(date);
    const trained = state.attendance.includes(key);
    const isFuture = date > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-day${planned(date) ? ' planned' : ''}${trained ? ' trained' : ''}${key === today ? ' today' : ''}${isFuture ? ' future' : ''}`;
    button.textContent = String(day);
    button.disabled = isFuture;
    button.setAttribute('aria-label', `${day} de ${monthNames[month]}${trained ? ', treino registrado' : planned(date) ? ', dia planejado' : ''}`);
    if (trained || planned(date)) {
      const marker = document.createElement('i'); marker.className = 'day-dot'; button.append(marker);
    }
    button.addEventListener('click', () => toggleAttendance(key));
    grid.append(button);
  }
  const cells = firstDay + totalDays;
  const trailing = (7 - cells % 7) % 7;
  for (let i = 0; i < trailing; i++) {
    const blank = document.createElement('div'); blank.className = 'calendar-day empty'; grid.append(blank);
  }
  $('calendarMonthCount').textContent = monthAttendance(calendarMonth).length;
  $('calendarMonthPercent').textContent = `${attendancePercent(calendarMonth)}%`;
}

function monthLabel(date) { return `${monthNames[date.getMonth()]} ${date.getFullYear()}`; }

function renderPhotoMonth() {
  $('photoMonthTitle').textContent = monthLabel(photoMonth);
  ['before','after'].forEach(slot => {
    const key = photoKey(photoMonth, slot);
    const photo = state.photos[key];
    const frame = $(`${slot}Frame`);
    frame.innerHTML = '';
    if (photo && photo.data) {
      const img = document.createElement('img');
      img.src = photo.data;
      img.alt = slot === 'before' ? 'Foto do início do mês' : 'Foto do final do mês';
      frame.append(img);
      const date = photo.takenAt ? new Date(photo.takenAt) : null;
      $(`${slot}Date`).textContent = date && !Number.isNaN(date.getTime()) ? `Registrada em ${new Intl.DateTimeFormat('pt-BR').format(date)}` : 'Foto salva';
      $(`${slot}Remove`).hidden = false;
      $(`${slot}Upload`).textContent = 'Trocar foto';
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'photo-placeholder';
      placeholder.innerHTML = '<span>＋</span><small>Adicionar foto</small>';
      frame.append(placeholder);
      $(`${slot}Date`).textContent = 'Nenhuma foto';
      $(`${slot}Remove`).hidden = true;
      $(`${slot}Upload`).textContent = 'Adicionar foto';
    }
  });
}

function renderStats() {
  const dates = yearAttendance(statsYear);
  const counts = Array.from({length:12}, (_, month) => state.attendance.filter(key => key.startsWith(`${statsYear}-${String(month + 1).padStart(2,'0')}-`)).length);
  const total = dates.length;
  $('statsYearTitle').textContent = String(statsYear);
  $('annualTotal').textContent = total;
  const monthsElapsed = statsYear < new Date().getFullYear() ? 12 : statsYear === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
  $('annualAverage').textContent = (total / monthsElapsed).toFixed(1).replace('.', ',');
  const max = Math.max(1, ...counts);
  const chart = $('annualChart'); chart.innerHTML = '';
  counts.forEach((count, index) => {
    const item = document.createElement('div'); item.className = 'bar-item';
    const value = document.createElement('span'); value.className = 'bar-value'; value.textContent = count || '';
    const track = document.createElement('div'); track.className = 'bar-track';
    const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.height = `${count ? Math.max(4, (count / max) * 100) : 0}%`;
    track.append(fill);
    const label = document.createElement('span'); label.className = 'bar-label'; label.textContent = monthShort[index];
    item.append(value, track, label); chart.append(item);
  });
  const bestCount = Math.max(...counts);
  const bestIndex = counts.indexOf(bestCount);
  $('bestMonth').textContent = bestCount ? `${monthNames[bestIndex]} (${bestCount})` : 'Ainda sem registros';
  $('annualBestStreak').textContent = `${longestStreakWithinYear(statsYear)} dias`;
  const list = $('monthlyReportList'); list.innerHTML = '';
  monthNames.forEach((name, index) => {
    const monthDate = new Date(statsYear, index, 1);
    const count = counts[index];
    const denominator = plannedCountInMonth(monthDate);
    const percent = denominator ? Math.round(count / denominator * 100) : 0;
    const row = document.createElement('div'); row.className = 'report-row';
    const month = document.createElement('span'); month.className = 'report-month'; month.textContent = monthShort[index];
    const middle = document.createElement('div');
    const details = document.createElement('div'); details.className = 'report-details'; details.textContent = `${percent}% da meta planejada · ${denominator} dias planejados`;
    const bar = document.createElement('div'); bar.className = 'report-bar';
    const barFill = document.createElement('span'); barFill.style.width = `${Math.min(100, percent)}%`; bar.append(barFill);
    middle.append(details, bar);
    const value = document.createElement('strong'); value.className = 'report-count'; value.textContent = `${count} ${count === 1 ? 'dia' : 'dias'}`;
    row.append(month, middle, value); list.append(row);
  });
}

function renderSettings() {
  document.querySelectorAll('#plannedDays button').forEach(button => {
    button.classList.toggle('selected', state.plannedDays.includes(Number(button.dataset.day)));
    button.setAttribute('aria-pressed', state.plannedDays.includes(Number(button.dataset.day)) ? 'true' : 'false');
  });
  $('streakMode').value = state.streakMode;
  $('reminderEnabled').checked = !!state.reminderEnabled;
  $('reminderTime').value = state.reminderTime || '17:30';
  updateNotificationStatus();
}

function renderAll() {
  renderHome(); renderCalendar(); renderPhotoMonth(); renderStats(); renderSettings(); renderMotivation();
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('mainContent').focus({preventScroll:true});
  window.scrollTo({top:0, behavior:'smooth'});
}

function updateNotificationStatus() {
  const status = $('notificationStatus');
  if (!('Notification' in window)) {
    status.textContent = 'Este navegador não oferece notificações. Use o arquivo .ics para criar o lembrete no calendário.';
  } else if (Notification.permission === 'granted') {
    status.textContent = 'Permissão concedida. O aviso do TRAINTRACK funciona enquanto o app estiver aberto.';
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Permissão bloqueada no navegador. Você pode ativá-la nas configurações do site.';
  } else {
    status.textContent = 'Toque em “Permitir notificações” para autorizar os avisos enquanto o app estiver aberto.';
  }
}

async function requestNotifications() {
  if (!('Notification' in window)) return showToast('Notificações não disponíveis neste navegador.');
  try {
    const permission = await Notification.requestPermission();
    updateNotificationStatus();
    if (permission === 'granted') showToast('Permissão de notificações concedida.');
    else showToast('Permissão não concedida.');
  } catch (error) {
    showToast('Não foi possível pedir permissão neste navegador.');
  }
}

function checkReminder() {
  if (!state.reminderEnabled || !state.plannedDays.length) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const today = dateKey(now);
  if (!planned(now) || state.attendance.includes(today) || state.lastRemindedDate === today) return;
  const [hour, minute] = (state.reminderTime || '17:30').split(':').map(Number);
  if (now.getHours() === hour && now.getMinutes() >= minute) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(registration => registration.showNotification('Bora treinar!', { body:'Está na hora de cuidar de você.', icon:'icons/icon.svg', badge:'icons/icon.svg', tag:`traintrack-${today}` }));
      } else {
        new Notification('Bora treinar!', { body:'Está na hora de cuidar de você.' });
      }
      state.lastRemindedDate = today;
      writeState();
    } catch (error) { console.warn('Notification failed', error); }
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCalendarReminder() {
  if (!state.plannedDays.length) return showToast('Selecione pelo menos um dia de treino nas configurações.');
  const byDay = ['SU','MO','TU','WE','TH','FR','SA'];
  const dayCodes = [...state.plannedDays].sort((a,b) => ((a+6)%7)-((b+6)%7)).map(day => byDay[day]).join(',');
  const [hour, minute] = (state.reminderTime || '17:30').split(':').map(Number);
  const now = new Date();
  let first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
  while (!state.plannedDays.includes(first.getDay()) || first <= now) first.setDate(first.getDate() + 1);
  const stamp = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}00`;
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TRAINTRACK//Workout Reminder//PT-BR','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    `UID:traintrack-${Date.now()}@local`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(first)}`,'DURATION:PT15M',
    `RRULE:FREQ=WEEKLY;BYDAY=${dayCodes}`,'SUMMARY:Bora treinar!','DESCRIPTION:Está na hora de cuidar de você. Lembrete criado pelo TRAINTRACK.',
    'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:Bora treinar!','END:VALARM','END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  downloadFile('lembrete-traintrack.ics', ics, 'text/calendar;charset=utf-8');
  showToast('Arquivo criado. Abra-o e adicione ao calendário do celular.');
}

function exportBackup() {
  const backup = { app:'TRAINTRACK', version:1, exportedAt:new Date().toISOString(), data:state };
  downloadFile(`traintrack-backup-${dateKey(new Date())}.json`, JSON.stringify(backup), 'application/json');
  showToast('Backup exportado. Guarde esse arquivo em local seguro.');
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed?.data || parsed;
    if (!incoming || !Array.isArray(incoming.attendance)) throw new Error('Arquivo de backup inválido.');
    state = mergeState(incoming);
    await writeState(); renderAll(); showToast('Backup importado com sucesso.');
  } catch (error) {
    console.error(error); showToast('Não foi possível importar este arquivo de backup.');
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler foto.'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  const dataUrl = await readFileAsDataURL(file);
  const image = new Image();
  image.src = dataUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function savePhoto(slot, file) {
  try {
    const data = await compressImage(file);
    const key = photoKey(photoMonth, slot);
    state.photos[key] = { data, takenAt:new Date().toISOString() };
    await writeState(); renderPhotoMonth(); showToast('Foto salva neste aparelho.');
  } catch (error) {
    console.error(error); showToast(error.message || 'Não foi possível salvar esta foto.');
  }
}

function escICS(text) { return text.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }


const FEATURED_MOTIVATION_VIDEOS = [
  { id: 'G3GwBMe_a_k', title: 'Motivação para treinar', description: 'Uma mensagem para ouvir antes de ir à academia.', channel: 'Nando Pinheiro' },
  { id: 'froUrj5I_S0', title: 'Seus erros te deixam mais forte', description: 'Motivação bodybuilding sobre persistência e superação.', channel: 'Apolo Motivação' },
  { id: '_SLvY03R80g', title: 'Disciplina gera transformação', description: 'Um incentivo para sair da zona de conforto e continuar.', channel: 'Marcelo Zanardo' },
  { id: 'eQofu-TA-T0', title: 'Persistência, consistência e disciplina', description: 'Uma mensagem para manter o foco nos dias difíceis.', channel: 'zyzz Motivation' },
  { id: 'LzXTDTx0h6M', title: 'Como ter disciplina e motivação para treinar', description: 'Mentalidade, paciência e consistência no longo prazo.', channel: 'Theus Treinos' }
];

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function youtubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)) return null;
    let id = url.hostname.includes('youtu.be') ? url.pathname.slice(1).split('/')[0] : (url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/)?.[1]);
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function renderMotivation() {
  const list = $('motivationVideoList');
  if (!list) return;
  const custom = state.savedVideos.map(video => ({...video, custom:true}));
  const videos = [...FEATURED_MOTIVATION_VIDEOS, ...custom];
  list.innerHTML = videos.map((video, index) => `
    <article class="motivation-video-card">
      <div class="motivation-video-frame">
        <iframe src="https://www.youtube-nocookie.com/embed/${video.id}" title="${escapeHTML(video.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>
      <div class="motivation-video-info">
        <div><span class="eyebrow">${video.custom ? 'ADICIONADO POR VOCÊ' : `VÍDEO ${String(index + 1).padStart(2,'0')}`}</span><h3>${escapeHTML(video.title)}</h3><p>${escapeHTML(video.description || 'Vídeo salvo na sua playlist.')}</p><small>${escapeHTML(video.channel || 'YouTube')}</small></div>
        <div class="motivation-video-actions"><a class="outline-button" href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer">Abrir no YouTube ↗</a>${video.custom ? `<button class="remove-photo remove-saved-video" type="button" data-video-id="${video.id}" aria-label="Remover vídeo">×</button>` : ''}</div>
      </div>
    </article>`).join('');
  if (!videos.length) list.innerHTML = '<p class="muted">Nenhum vídeo adicionado ainda.</p>';
}

async function addMotivationVideo(event) {
  event.preventDefault();
  const input = $('customVideoUrl');
  const id = youtubeVideoId(input.value.trim());
  if (!id) return showToast('Cole um link válido de vídeo do YouTube.');
  if (FEATURED_MOTIVATION_VIDEOS.some(video => video.id === id) || state.savedVideos.some(video => video.id === id)) {
    input.value = '';
    return showToast('Esse vídeo já está na sua lista.');
  }
  state.savedVideos.unshift({ id, title: 'Vídeo salvo do YouTube', description: 'Adicionado por você.', channel: 'YouTube' });
  state.savedVideos = state.savedVideos.slice(0, 30);
  await writeState();
  input.value = '';
  renderMotivation();
  showToast('Vídeo adicionado à sua playlist.');
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
  $('markTodayBtn').addEventListener('click', () => toggleAttendance(dateKey(new Date())));
  $('addVideoForm').addEventListener('submit', addMotivationVideo);
  $('motivationVideoList').addEventListener('click', async event => {
    const button = event.target.closest('.remove-saved-video');
    if (!button) return;
    const id = button.dataset.videoId;
    state.savedVideos = state.savedVideos.filter(video => video.id !== id);
    await writeState(); renderMotivation(); showToast('Vídeo removido da sua playlist.');
  });
  $('prevMonth').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()-1, 1); renderCalendar(); });
  $('nextMonth').addEventListener('click', () => { const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+1, 1); const max = new Date(new Date().getFullYear(), new Date().getMonth(), 1); if (next <= max) { calendarMonth = next; renderCalendar(); } });
  $('prevPhotoMonth').addEventListener('click', () => { photoMonth = new Date(photoMonth.getFullYear(), photoMonth.getMonth()-1, 1); renderPhotoMonth(); });
  $('nextPhotoMonth').addEventListener('click', () => { const next = new Date(photoMonth.getFullYear(), photoMonth.getMonth()+1, 1); const max = new Date(new Date().getFullYear(), new Date().getMonth(), 1); if (next <= max) { photoMonth = next; renderPhotoMonth(); } });
  $('prevYear').addEventListener('click', () => { statsYear--; renderStats(); });
  $('nextYear').addEventListener('click', () => { if (statsYear < new Date().getFullYear()) { statsYear++; renderStats(); } });
  document.querySelectorAll('#plannedDays button').forEach(button => button.addEventListener('click', async () => {
    const day = Number(button.dataset.day);
    if (state.plannedDays.includes(day)) state.plannedDays = state.plannedDays.filter(item => item !== day);
    else state.plannedDays.push(day);
    state.plannedDays.sort((a,b) => a-b);
    await saveAndRender('Rotina semanal atualizada.');
  }));
  $('streakMode').addEventListener('change', async event => { state.streakMode = event.target.value; await saveAndRender('Modo de sequência atualizado.'); });
  $('reminderEnabled').addEventListener('change', async event => { state.reminderEnabled = event.target.checked; await saveAndRender(event.target.checked ? 'Aviso no app ativado.' : 'Aviso no app desativado.'); });
  $('reminderTime').addEventListener('change', async event => { state.reminderTime = event.target.value || '17:30'; await saveAndRender('Horário atualizado.'); });
  $('notificationPermission').addEventListener('click', requestNotifications);
  $('exportReminder').addEventListener('click', exportCalendarReminder);
  $('exportBackup').addEventListener('click', exportBackup);
  $('importBackup').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) importBackup(file); event.target.value = ''; });
  $('clearData').addEventListener('click', () => askConfirm('Apagar todos os dados?', 'Isso apagará os registros de treino, as configurações e as fotos salvas neste navegador. Exporte um backup antes, caso queira guardar seu histórico.', async () => {
    state = structuredClone(DEFAULTS); await writeState(); renderAll(); showToast('Dados apagados.');
  }, 'Apagar tudo'));
  $('cancelConfirm').addEventListener('click', closeConfirm);
  $('acceptConfirm').addEventListener('click', async () => { const action = confirmAction; closeConfirm(); if (action) await action(); });
  $('confirmModal').addEventListener('click', event => { if (event.target === $('confirmModal')) closeConfirm(); });
  ['before','after'].forEach(slot => {
    $(`${slot}Upload`).addEventListener('click', () => $(`${slot}Input`).click());
    $(`${slot}Input`).addEventListener('change', event => { const file = event.target.files?.[0]; if (file) savePhoto(slot, file); event.target.value = ''; });
    $(`${slot}Remove`).addEventListener('click', () => askConfirm('Excluir esta foto?', 'A foto será removida do histórico deste mês.', async () => { delete state.photos[photoKey(photoMonth, slot)]; await writeState(); renderPhotoMonth(); showToast('Foto removida.'); }, 'Excluir foto'));
  });
  $('installBtn').addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null; $('installBtn').hidden = true;
    } else {
      showToast('No Chrome do Android: menu ⋮ → Instalar app ou Adicionar à tela inicial.');
    }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; showToast('TRAINTRACK instalado.'); });
}

async function init() {
  try {
    db = await openDatabase();
    state = mergeState(await readState());
    await writeState();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = '<main style="max-width:560px;margin:10vh auto;padding:24px;color:white;font-family:system-ui"><h1>TRAINTRACK</h1><p>Não foi possível iniciar o armazenamento local neste navegador. Abra o app em uma versão atualizada do Chrome ou Edge.</p></main>';
    return;
  }
  bindEvents();
  renderAll();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed', error));
  }
  setInterval(checkReminder, 20000);
  checkReminder();
}

init();
