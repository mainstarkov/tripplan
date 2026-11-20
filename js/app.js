(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const { destinations, packing, categories } = window.TripData;
    const STORAGE_KEY = 'tripplan.v1';
    let storageError = '';
    let state;
    let filter = 'all';
    let activeTab = 'route';
    let selectedDay = '';
    let currentTripId = '';
    let toastTimer;
    let deleteTripId = '';

    // Пользовательский текст экранируется перед выводом в HTML.
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
    const money = value => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value) + ' ₽';
    const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const date = value => new Date(value + 'T12:00:00');
    const shortDate = value => date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    const isoDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const dayCount = (start, end) => Math.round((date(end) - date(start)) / 86400000) + 1;
    const daysOf = trip => Array.from({ length: dayCount(trip.start, trip.end) }, (_, index) => {
        const value = date(trip.start);
        value.setDate(value.getDate() + index);
        return isoDate(value);
    });
    const plural = (number, one, few, many) => {
        const mod100 = number % 100;
        if (mod100 > 10 && mod100 < 20) return many;
        return number % 10 === 1 ? one : number % 10 >= 2 && number % 10 <= 4 ? few : many;
    };
    const getDestination = name => destinations.find(item => [item.name, `${item.name}, ${item.country}`].some(value => value.toLowerCase() === name.trim().toLowerCase()));
    const tripImage = trip => getDestination(trip.destination)?.image || 'mountains.jpg';
    const total = trip => roundMoney(trip.expenses.reduce((sum, expense) => sum + expense.amount, 0));
    const tripById = value => state.trips.find(trip => trip.id === value);
    const currentTrip = () => tripById(currentTripId);
    const icon = name => {
        const paths = {
            heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
            edit: '<path d="m16 3 5 5M4 20l4-1 13-13a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
            trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
        };
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
    };

    function readState() {
        const empty = { version: 1, trips: [], favorites: [], theme: 'light' };
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return empty;
            const saved = JSON.parse(raw);
            if (saved.version !== 1 || !Array.isArray(saved.trips) || !Array.isArray(saved.favorites)) throw new Error('format');
            if (!saved.trips.every(trip => typeof trip.id === 'string' && typeof trip.title === 'string' && typeof trip.destination === 'string' && Number.isFinite(trip.budget) && Number.isInteger(trip.people) && dayCount(trip.start, trip.end) >= 1 && dayCount(trip.start, trip.end) <= 90 && ['places', 'expenses', 'packing'].every(key => Array.isArray(trip[key])))) throw new Error('format');
            return { ...saved, theme: saved.theme === 'dark' ? 'dark' : 'light' };
        } catch (error) {
            storageError = 'Не удалось прочитать сохранённые планы. Проверьте, что браузер разрешает хранение данных.';
            return empty;
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            storageError = '';
        } catch (error) {
            storageError = 'Браузер не разрешает сохранение. Изменения доступны только до закрытия страницы.';
        }
        $('#storage-warning').textContent = storageError;
        $('#storage-warning').hidden = !storageError;
    }

    function toast(message) {
        const element = $('#toast');
        clearTimeout(toastTimer);
        element.textContent = message;
        element.hidden = false;
        toastTimer = setTimeout(() => { element.hidden = true; }, 2800);
    }

    function applyTheme() {
        document.documentElement.dataset.theme = state.theme;
        const toggle = $('.theme-toggle');
        toggle.textContent = state.theme === 'dark' ? '☀' : '☾';
        toggle.setAttribute('aria-label', state.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    }

    function destinationCard(destination) {
        const saved = state.favorites.includes(destination.id);
        const photo = `<img src="images/${destination.image}" alt="${destination.alt}" width="1200" height="800" loading="lazy">`;
        return `<article class="destination-card">
            ${destination.video ? `<button class="destination-media" type="button" data-action="preview-video" aria-label="Видеопревью: ${destination.name}" aria-pressed="false">
                ${photo}
                <video src="images/${destination.video}.mp4" aria-hidden="true" muted loop playsinline preload="auto"></video>
            </button>` : photo}
            <button class="icon-button favorite-button" type="button" data-action="favorite" data-id="${destination.id}" aria-pressed="${saved}" aria-label="${saved ? 'Удалить из избранного' : 'В избранное'}: ${destination.name}">${icon('heart')}</button>
            <div class="card-content"><p class="card-country">${destination.country}</p><h3>${destination.name}</h3><p>${destination.description}</p><button class="card-link" type="button" data-action="new-trip" data-destination="${destination.id}">Собрать поездку ↗</button></div>
        </article>`;
    }

    function emptyState(symbol, heading, description, actions = '') {
        return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${symbol}</span><h2>${heading}</h2><p>${description}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
    }

    function renderDestinations() {
        $('#home-destinations').innerHTML = destinations.map(destinationCard).join('');
        const query = $('#destination-search').value.trim().toLowerCase();
        const found = destinations.filter(item => (filter === 'all' || filter === item.category) && `${item.name} ${item.country} ${item.description}`.toLowerCase().includes(query));
        $('#all-destinations').innerHTML = found.length ? found.map(destinationCard).join('') : emptyState('⌕', 'Пока ничего не нашлось', 'Попробуйте другое название или создайте поездку в своё место.');
        $('#search-count').textContent = `Найдено: ${found.length}`;
        $$('[data-action="filter"]').forEach(button => {
            const active = button.dataset.filter === filter;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active);
        });
        const favoriteItems = destinations.filter(item => state.favorites.includes(item.id));
        $('#favorite-list').innerHTML = favoriteItems.length ? favoriteItems.map(destinationCard).join('') : emptyState('♡', 'Здесь будут ваши любимые места', 'Нажмите на сердце в карточке направления, чтобы сохранить его.', '<a class="button" href="#/directions">Выбрать направление</a>');
    }

    function renderTrips() {
        const count = state.trips.length;
        const days = state.trips.reduce((sum, trip) => sum + dayCount(trip.start, trip.end), 0);
        const budget = state.trips.reduce((sum, trip) => sum + trip.budget, 0);
        $('#trip-stats').innerHTML = [[count, plural(count, 'поездка в планах', 'поездки в планах', 'поездок в планах')], [days, plural(days, 'день впечатлений', 'дня впечатлений', 'дней впечатлений')], [money(budget), 'общий бюджет']].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
        if (!count) {
            $('#trip-list').innerHTML = emptyState('↗', 'Первая поездка начинается здесь', 'Укажите место и даты — и собирайте маршрут в своём темпе.', '<button class="button" type="button" data-action="new-trip">+ Создать поездку</button><button class="button secondary" type="button" data-action="demo">Посмотреть пример Рима</button>');
            return;
        }
        $('#trip-list').innerHTML = [...state.trips].sort((a, b) => a.start.localeCompare(b.start)).map(trip => `<article class="trip-card">
            <img src="images/${tripImage(trip)}" alt="${escape(trip.destination)}" width="400" height="460">
            <div class="trip-card-body"><p class="eyebrow">${shortDate(trip.start)} — ${shortDate(trip.end)} ${date(trip.end).getFullYear()}</p><h2>${escape(trip.title)} ${trip.demo ? '<span class="badge">Пример</span>' : ''}</h2><p class="small">${escape(trip.destination)}<br>${dayCount(trip.start, trip.end)} ${plural(dayCount(trip.start, trip.end), 'день', 'дня', 'дней')} · ${trip.people} ${plural(trip.people, 'путешественник', 'путешественника', 'путешественников')}</p><p>Бюджет: ${money(trip.budget)}</p><a class="button" href="#/trip/${trip.id}">Открыть план ↗</a></div>
        </article>`).join('') + '<div class="add-trip-card"><h2>Следующая история — ваша</h2><p class="muted">Выберите даты и дайте поездке название.</p><button class="button" type="button" data-action="new-trip">+ Новая поездка</button></div>';
    }

    function summary(trip) {
        const spent = total(trip);
        const remaining = roundMoney(trip.budget - spent);
        const percent = trip.budget > 0 ? Math.min(spent / trip.budget * 100, 100) : spent ? 100 : 0;
        const done = trip.packing.filter(item => item.done).length;
        return `<aside class="summary" aria-label="Сводка поездки"><img src="images/${tripImage(trip)}" alt="${escape(trip.destination)}" width="624" height="360"><h2>Всё под контролем</h2><p class="small muted">Бюджет поездки</p><p class="budget-amount">${money(spent)} <span class="muted">/ ${money(trip.budget)}</span></p><div class="progress ${remaining < 0 ? 'over-budget-bar' : ''}" role="progressbar" aria-label="Использовано бюджета" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><span style="width:${percent}%"></span></div><p class="remaining ${remaining < 0 ? 'over-budget' : ''}">${remaining < 0 ? `Превышение на ${money(-remaining)}` : `Осталось ${money(remaining)}`}</p><hr><p>Вещи собраны: ${done} из ${trip.packing.length}</p><p class="small muted">Добавляйте расходы и отмечайте вещи в разделах поездки.</p></aside>`;
    }

    function placeRow(place) {
        return `<article class="place-row"><span class="place-time">${escape(place.time)}</span><div><h3>${escape(place.title)}</h3>${place.note ? `<p>${escape(place.note)}</p>` : ''}</div><div class="row-actions"><button class="icon-button" type="button" data-action="edit-place" data-id="${place.id}" aria-label="Изменить место ${escape(place.title)}">${icon('edit')}</button><button class="icon-button" type="button" data-action="delete-place" data-id="${place.id}" aria-label="Удалить место ${escape(place.title)}">${icon('trash')}</button></div></article>`;
    }

    function routePanel(trip) {
        const days = daysOf(trip);
        if (!days.includes(selectedDay)) selectedDay = days[0];
        const places = trip.places.filter(place => place.date === selectedDay).sort((a, b) => a.time.localeCompare(b.time));
        return `<div class="day-tabs" role="group" aria-label="День поездки">${days.map(value => `<button class="chip ${value === selectedDay ? 'active' : ''}" type="button" data-action="day" data-date="${value}" aria-pressed="${value === selectedDay}">${shortDate(value)} · ${date(value).toLocaleDateString('ru-RU', { weekday: 'short' })}</button>`).join('')}</div>
            <div class="panel-heading"><h2>День ${days.indexOf(selectedDay) + 1} · ${date(selectedDay).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</h2></div>
            <div class="place-list">${places.length ? places.map(placeRow).join('') : emptyState('↗', 'День открыт для планов', 'Добавьте место, прогулку или время для отдыха.')}</div><button class="button secondary" type="button" data-action="new-place">+ Добавить место</button>`;
    }

    function budgetPanel(trip) {
        const spent = total(trip);
        const categoryRows = categories.map(category => {
            const sum = roundMoney(trip.expenses.filter(expense => expense.category === category).reduce((result, expense) => result + expense.amount, 0));
            return `<div class="category-line"><div><span>${category}</span><strong>${money(sum)}</strong></div><div class="progress"><span style="width:${spent ? sum / spent * 100 : 0}%"></span></div></div>`;
        }).join('');
        return `<div class="panel-heading"><h2>Бюджет поездки</h2><button class="button small-button" type="button" data-action="new-expense">+ Добавить расход</button></div><div class="budget-cards"><div class="stat"><strong>${money(spent)}</strong><span>всего расходов</span></div><div class="stat"><strong>${money(roundMoney(spent / trip.people))}</strong><span>на человека</span></div></div><div class="category-list">${categoryRows}</div><div class="expense-list">${trip.expenses.length ? trip.expenses.map(expense => `<article class="expense-row"><div><h3>${escape(expense.title)}</h3><p>${escape(expense.category)}</p></div><div class="expense-right"><strong>${money(expense.amount)}</strong><div class="row-actions"><button class="icon-button" type="button" data-action="edit-expense" data-id="${expense.id}" aria-label="Изменить расход ${escape(expense.title)}">${icon('edit')}</button><button class="icon-button" type="button" data-action="delete-expense" data-id="${expense.id}" aria-label="Удалить расход ${escape(expense.title)}">${icon('trash')}</button></div></div></article>`).join('') : emptyState('₽', 'Расходов пока нет', 'Добавьте билеты, жильё или другие расходы. Сумма посчитается автоматически.')}</div>`;
    }

    function packingPanel(trip) {
        const done = trip.packing.filter(item => item.done).length;
        return `<div class="panel-heading"><h2>Всё с собой</h2><p class="muted small">Собрано ${done} из ${trip.packing.length}</p></div>
            <form id="packing-form" class="packing-form"><input name="item" required maxlength="80" placeholder="Добавить вещь" aria-label="Название вещи"><button class="button" type="submit">Добавить</button></form>
            <div class="progress"><span style="width:${trip.packing.length ? done / trip.packing.length * 100 : 0}%"></span></div>
            <div class="packing-list">${trip.packing.length ? trip.packing.map(item => `<div class="packing-item ${item.done ? 'checked' : ''}"><label><input type="checkbox" data-action="check-item" data-id="${item.id}" ${item.done ? 'checked' : ''}><span>${escape(item.title)}</span></label><button class="icon-button" type="button" data-action="delete-item" data-id="${item.id}" aria-label="Удалить вещь ${escape(item.title)}">${icon('trash')}</button></div>`).join('') : emptyState('✓', 'Список пока пуст', 'Добавьте вещи, которые хотите взять с собой.')}</div>`;
    }

    function renderPlanner() {
        const trip = currentTrip();
        const view = $('#planner-view');
        if (!trip) {
            view.innerHTML = emptyState('↗', 'Поездка не найдена', 'Возможно, она была удалена или создана в другом браузере.', '<a class="button" href="#/trips">К моим поездкам</a>');
            return;
        }
        const panels = { route: routePanel, budget: budgetPanel, packing: packingPanel };
        view.innerHTML = `<a href="#/trips" class="back-link">← Мои поездки</a><div class="planner-heading"><div><h1>${escape(trip.title)} ${trip.demo ? '<span class="badge">Пример</span>' : ''}</h1><p>${escape(trip.destination)} · ${shortDate(trip.start)} — ${shortDate(trip.end)} ${date(trip.end).getFullYear()} · ${trip.people} ${plural(trip.people, 'путешественник', 'путешественника', 'путешественников')}</p></div><div class="actions"><button class="button secondary" type="button" data-action="edit-trip">Изменить поездку</button><button class="icon-button" type="button" data-action="delete-trip" aria-label="Удалить поездку">${icon('trash')}</button></div></div>
            <div class="tabs" role="tablist" aria-label="Разделы поездки">${[['route', 'Маршрут'], ['budget', 'Бюджет'], ['packing', 'Список вещей']].map(([value, name]) => `<button class="chip ${activeTab === value ? 'active' : ''}" type="button" role="tab" id="tab-${value}" aria-controls="trip-panel" tabindex="${activeTab === value ? '0' : '-1'}" aria-selected="${activeTab === value}" data-action="tab" data-tab="${value}">${name}</button>`).join('')}</div><div class="planner-layout"><div id="trip-panel" role="tabpanel" aria-labelledby="tab-${activeTab}">${panels[activeTab](trip)}</div>${summary(trip)}</div>`;
    }

    // Раздел определяется адресом после #. Это позволяет открывать сайт без сервера.
    function render() {
        let [view = 'home', value] = location.hash.replace(/^#\/?/, '').split('/');
        if (!['home', 'directions', 'trips', 'favorites', 'trip'].includes(view)) view = 'home';
        if (view === 'trip' && currentTripId !== value) {
            currentTripId = value;
            activeTab = 'route';
            selectedDay = '';
        }
        $$('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
        $$('[data-nav]').forEach(link => {
            if (link.dataset.nav === (view === 'trip' ? 'trips' : view)) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const titles = { home: 'Путешествия по плану', directions: 'Направления', trips: 'Мои поездки', favorites: 'Избранное', trip: currentTrip()?.title || 'План поездки' };
        document.title = `${titles[view]} — TripPlan`;
        renderDestinations();
        renderTrips();
        if (view === 'trip') renderPlanner();
        applyTheme();
        $('#storage-warning').hidden = !storageError;
        $('#storage-warning').textContent = storageError;
    }

    function setFields(form, values) {
        for (const [key, value] of Object.entries(values)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    }

    function updateTripPreview() {
        const value = $('#trip-form').elements.destination.value.split(',')[0].trim().toLowerCase();
        const destination = destinations.find(item => item.name.toLowerCase() === value);
        const places = $('#trip-preview-places');
        const hint = $('#trip-preview-hint');
        $('#trip-preview-title').textContent = destination ? destination.name : 'Идеи для поездки';
        places.hidden = !destination;
        places.innerHTML = destination ? destination.stops.map(stop => `
            <figure>
                <img src="images/${stop.image}" alt="">
                <figcaption><strong>${stop.title}</strong><p>${stop.caption}</p></figcaption>
            </figure>`).join('') : '';
        hint.hidden = Boolean(destination);
        hint.textContent = value ? 'Для этого места пока нет подборки фотографий.' : 'Выберите направление, чтобы увидеть места и идеи для отдыха.';
    }

    function openTrip(destinationId, edit = false) {
        const form = $('#trip-form');
        form.reset();
        $('#trip-error').textContent = '';
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const end = new Date(tomorrow);
        end.setDate(end.getDate() + 3);
        const destination = destinations.find(item => item.id === destinationId);
        const trip = edit ? currentTrip() : null;
        setFields(form, trip || { id: '', title: '', destination: destination ? `${destination.name}${destination.category === 'city' ? ', ' + destination.country : ''}` : '', start: isoDate(tomorrow), end: isoDate(end), people: 1, budget: 0 });
        $('#trip-dialog-title').textContent = edit ? 'Изменить поездку' : 'Новая поездка';
        $('#trip-submit').textContent = edit ? 'Сохранить изменения' : 'Создать поездку';
        updateTripPreview();
        $('#trip-dialog').showModal();
        $('#trip-dialog').scrollTop = 0;
    }

    function openPlace(placeId) {
        const trip = currentTrip();
        if (!trip) return;
        const form = $('#place-form');
        form.reset();
        $('#place-error').textContent = '';
        const place = trip.places.find(item => item.id === placeId);
        setFields(form, place || { id: '', title: '', date: selectedDay || trip.start, time: '10:00', note: '' });
        form.elements.date.min = trip.start;
        form.elements.date.max = trip.end;
        $('#place-dialog-title').textContent = place ? 'Изменить место' : 'Добавить место';
        $('#place-dialog').showModal();
    }

    function openExpense(expenseId) {
        const trip = currentTrip();
        if (!trip) return;
        const form = $('#expense-form');
        form.reset();
        $('#expense-error').textContent = '';
        const expense = trip.expenses.find(item => item.id === expenseId);
        setFields(form, expense || { id: '', title: '', amount: '', category: 'Транспорт' });
        $('#expense-dialog-title').textContent = expense ? 'Изменить расход' : 'Добавить расход';
        $('#expense-dialog').showModal();
    }

    function commit(message) {
        save();
        render();
        if (message) toast(storageError || message);
    }

    function createDemo() {
        let trip = state.trips.find(item => item.demo);
        if (!trip) {
            trip = { id: id(), demo: true, title: 'Выходные в Риме', destination: 'Рим, Италия', start: '2026-12-12', end: '2026-12-15', people: 2, budget: 60000,
                places: [
                    { id: id(), title: 'Заселение в отель', date: '2026-12-12', time: '10:00', note: 'Оставить вещи и немного отдохнуть' },
                    { id: id(), title: 'Прогулка у Колизея', date: '2026-12-12', time: '12:00', note: 'Первое знакомство с историческим центром' },
                    { id: id(), title: 'Фонтан Треви', date: '2026-12-12', time: '16:00', note: 'Прогулка и фотографии' }
                ],
                expenses: [
                    { id: id(), title: 'Дорога', amount: 18000, category: 'Транспорт' },
                    { id: id(), title: 'Проживание', amount: 16000, category: 'Жильё' },
                    { id: id(), title: 'Кафе', amount: 3000, category: 'Еда' }
                ],
                packing: packing.map((title, index) => ({ id: id(), title, done: index < 2 }))
            };
            state.trips.push(trip);
            save();
        }
        location.hash = `/trip/${trip.id}`;
        toast('Открыт учебный пример. Даты и расходы можно изменить.');
    }

    document.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const { action, id: itemId } = button.dataset;
        const trip = currentTrip();
        switch (action) {
            case 'menu': {
                const open = $('#navigation').classList.toggle('open');
                button.setAttribute('aria-expanded', open);
                button.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
                break;
            }
            case 'theme': state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); break;
            case 'preview-video': {
                const play = button.querySelector('video').paused;
                if (play) {
                    document.querySelectorAll('.destination-media').forEach(other => {
                        if (other !== button) setDestinationPreview(other, false);
                    });
                }
                setDestinationPreview(button, play);
                break;
            }
            case 'new-trip': openTrip(button.dataset.destination); break;
            case 'edit-trip': openTrip('', true); break;
            case 'close-dialog': button.closest('dialog').close(); break;
            case 'filter': filter = button.dataset.filter; renderDestinations(); break;
            case 'favorite': {
                const exists = state.favorites.includes(itemId);
                state.favorites = exists ? state.favorites.filter(value => value !== itemId) : [...state.favorites, itemId];
                commit(exists ? 'Направление удалено из избранного' : 'Направление сохранено');
                break;
            }
            case 'demo': createDemo(); break;
            case 'tab': activeTab = button.dataset.tab; renderPlanner(); $(`#tab-${activeTab}`).focus({ preventScroll: true }); break;
            case 'day': selectedDay = button.dataset.date; renderPlanner(); $(`[data-date="${selectedDay}"]`).focus({ preventScroll: true }); break;
            case 'new-place': openPlace(); break;
            case 'edit-place': openPlace(itemId); break;
            case 'delete-place': if (trip) { trip.places = trip.places.filter(item => item.id !== itemId); commit('Место удалено'); } break;
            case 'new-expense': openExpense(); break;
            case 'edit-expense': openExpense(itemId); break;
            case 'delete-expense': if (trip) { trip.expenses = trip.expenses.filter(item => item.id !== itemId); commit('Расход удалён'); } break;
            case 'delete-item': if (trip) { trip.packing = trip.packing.filter(item => item.id !== itemId); commit('Вещь удалена'); } break;
            case 'delete-trip': if (trip) { deleteTripId = trip.id; $('#confirm-dialog').showModal(); } break;
        }
    });

    document.addEventListener('change', event => {
        if (event.target.dataset.action !== 'check-item') return;
        const item = currentTrip()?.packing.find(value => value.id === event.target.dataset.id);
        if (!item) return;
        item.done = event.target.checked;
        save();
        renderPlanner();
        $(`[data-action="check-item"][data-id="${item.id}"]`)?.focus({ preventScroll: true });
    });

    document.addEventListener('keydown', event => {
        if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = ['route', 'budget', 'packing'];
        let index = tabs.indexOf(activeTab);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = 2;
        else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        activeTab = tabs[index];
        renderPlanner();
        $(`#tab-${activeTab}`).focus();
    });

    const previewVisibility = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) setDestinationPreview(entry.target, false);
        }
    });

    function setDestinationPreview(button, play) {
        const video = button.querySelector('video');
        if (play) {
            if (video.paused) video.currentTime = 0;
            video.play().then(() => {
                if (video.paused || !button.isConnected) return;
                button.setAttribute('aria-pressed', 'true');
                previewVisibility.observe(button);
            }).catch(() => {});
        } else {
            previewVisibility.unobserve(button);
            video.pause();
            button.setAttribute('aria-pressed', 'false');
        }
    }

    const flight = $('#hero-flight');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let flightVisible = false;

    function updateFlightPlayback() {
        if (flightVisible && !document.hidden && !reducedMotion.matches) {
            if (flight.paused) flight.currentTime = 0;
            flight.play().catch(() => {});
        } else {
            flight.pause();
        }
    }

    const flightVisibility = new IntersectionObserver(([entry]) => {
        flightVisible = entry.isIntersecting;
        updateFlightPlayback();
    });
    flightVisibility.observe(flight);
    function stopDestinationPreviews() {
        document.querySelectorAll('.destination-media').forEach(button => setDestinationPreview(button, false));
    }

    document.addEventListener('visibilitychange', () => {
        updateFlightPlayback();
        if (document.hidden) stopDestinationPreviews();
    });

    reducedMotion.addEventListener('change', event => {
        updateFlightPlayback();
        if (event.matches) stopDestinationPreviews();
    });

    document.addEventListener('pointerover', event => {
        if (event.pointerType === 'touch' || reducedMotion.matches) return;
        const card = event.target.closest('.destination-card');
        if (!card || card.contains(event.relatedTarget)) return;
        const button = card.querySelector('.destination-media');
        if (button) setDestinationPreview(button, true);
    });

    document.addEventListener('pointerout', event => {
        if (event.pointerType === 'touch') return;
        const card = event.target.closest('.destination-card');
        if (!card || card.contains(event.relatedTarget)) return;
        const button = card.querySelector('.destination-media');
        if (button) setDestinationPreview(button, false);
    });

    // Формы проверяют даты, суммы и пустые строки перед сохранением.
    $('#trip-form').elements.destination.addEventListener('input', updateTripPreview);

    $('#trip-form').addEventListener('submit', event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target));
        data.title = data.title.trim();
        data.destination = data.destination.trim();
        data.budget = roundMoney(Number(data.budget));
        data.people = Number(data.people);
        const error = $('#trip-error');
        if (!data.title || !data.destination) { error.textContent = 'Введите название и место поездки.'; return; }
        const days = dayCount(data.start, data.end);
        if (!Number.isFinite(days) || days < 1 || days > 90) { error.textContent = 'Дата окончания должна быть не раньше начала. Длительность — от 1 до 90 дней.'; return; }
        if (!Number.isFinite(data.budget) || data.budget < 0 || data.budget > 1e9 || !Number.isInteger(data.people) || data.people < 1 || data.people > 30) { error.textContent = 'Проверьте бюджет и количество путешественников.'; return; }
        let trip = tripById(data.id);
        if (trip) {
            if (trip.places.some(place => place.date < data.start || place.date > data.end)) { error.textContent = 'Вне новых дат остаются запланированные места. Сначала перенесите или удалите их в маршруте.'; return; }
            Object.assign(trip, data);
        } else {
            trip = { ...data, id: id(), places: [], expenses: [], packing: packing.map(title => ({ id: id(), title, done: false })) };
            state.trips.push(trip);
        }
        save();
        $('#trip-dialog').close();
        if (location.hash === `#/trip/${trip.id}`) render();
        else location.hash = `/trip/${trip.id}`;
        toast(storageError || 'Поездка сохранена');
    });

    $('#place-form').addEventListener('submit', event => {
        event.preventDefault();
        const trip = currentTrip();
        if (!trip) return;
        const data = Object.fromEntries(new FormData(event.target));
        data.title = data.title.trim();
        data.note = data.note.trim();
        if (!data.title || data.date < trip.start || data.date > trip.end || !/^\d{2}:\d{2}$/.test(data.time)) { $('#place-error').textContent = 'Введите название и выберите дату внутри поездки.'; return; }
        const existing = trip.places.find(place => place.id === data.id);
        if (existing) Object.assign(existing, data);
        else trip.places.push({ ...data, id: id() });
        selectedDay = data.date;
        $('#place-dialog').close();
        commit('Место сохранено');
    });

    $('#expense-form').addEventListener('submit', event => {
        event.preventDefault();
        const trip = currentTrip();
        if (!trip) return;
        const data = Object.fromEntries(new FormData(event.target));
        data.title = data.title.trim();
        data.amount = roundMoney(Number(data.amount));
        if (!data.title || !Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 1e9 || !categories.includes(data.category)) { $('#expense-error').textContent = 'Введите название и положительную сумму расхода.'; return; }
        const existing = trip.expenses.find(expense => expense.id === data.id);
        if (existing) Object.assign(existing, data);
        else trip.expenses.push({ ...data, id: id() });
        $('#expense-dialog').close();
        commit('Расход сохранён');
    });

    document.addEventListener('submit', event => {
        if (event.target.id !== 'packing-form') return;
        event.preventDefault();
        const title = event.target.elements.namedItem('item').value.trim();
        if (!title || !currentTrip()) return;
        currentTrip().packing.push({ id: id(), title, done: false });
        commit('Вещь добавлена');
        $('#packing-form input').focus({ preventScroll: true });
    });

    $('#confirm-form').addEventListener('submit', event => {
        event.preventDefault();
        state.trips = state.trips.filter(trip => trip.id !== deleteTripId);
        deleteTripId = '';
        $('#confirm-dialog').close();
        save();
        location.hash = '/trips';
        toast(storageError || 'Поездка удалена');
    });

    $('#destination-search').addEventListener('input', renderDestinations);
    $('#destination-options').innerHTML = destinations.map(item => `<option value="${item.name}${item.category === 'city' ? ', ' + item.country : ''}"></option>`).join('');
    window.addEventListener('hashchange', () => {
        $('#navigation').classList.remove('open');
        $('.menu-toggle').setAttribute('aria-expanded', 'false');
        $('.menu-toggle').setAttribute('aria-label', 'Открыть меню');
        render();
        window.scrollTo({ top: 0, behavior: 'auto' });
    });
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY) { state = readState(); render(); }
    });
    state = readState();
    render();
})();
