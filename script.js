(function () {
    'use strict';

    // =========================================================
    // Constantes
    // =========================================================
    const STORAGE_KEYS = {
        tickets: 'tickets',
        journal: 'journal',
        theme: 'theme',
        accent: 'accent'
    };

    const ACCENTS = [
        { name: 'Bleu', value: '#2563eb' },
        { name: 'Violet', value: '#7c3aed' },
        { name: 'Vert', value: '#059669' },
        { name: 'Orange', value: '#ea580c' },
        { name: 'Rose', value: '#db2777' }
    ];

    const QUICK_VALUES = [8, 9, 10, 11, 12, 13];
    const SERIES_COLORS = 6;
    const EXPIRING_SOON_DAYS = 60;
    const JOURNAL_MAX_ENTRIES = 300;

    // =========================================================
    // Utilitaires
    // =========================================================
    const $ = (selector, root = document) => root.querySelector(selector);

    const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
    const formatMoney = amount => euroFormatter.format(amount);
    const toCents = amount => Math.round(amount * 100);

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function icon(name) {
        return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
    }

    function plural(count, singular, pluralForm = singular + 's') {
        return `${count} ${count > 1 ? pluralForm : singular}`;
    }

    function normalizeText(text) {
        return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function createId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    const sum = (items, fn) => items.reduce((acc, item) => acc + fn(item), 0);

    // --- Dates (on travaille en heure locale pour éviter les décalages UTC) ---
    function toISODate(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseISODate(iso) {
        const [year, month, day] = iso.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    const todayISO = () => toISODate(new Date());

    function formatDate(iso, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
        if (!iso) return '—';
        return parseISODate(iso).toLocaleDateString('fr-FR', options);
    }

    /**
     * Un titre-restaurant est utilisable pendant l'année civile de son émission
     * et jusqu'à la fin février de l'année suivante.
     */
    function expiryDateOf(iso) {
        const year = parseISODate(iso).getFullYear() + 1;
        return new Date(year, 2, 0); // jour 0 de mars = dernier jour de février
    }

    function daysUntil(date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((date - today) / 86400000);
    }

    function expiryStatus(iso) {
        const date = expiryDateOf(iso);
        const days = daysUntil(date);
        let level = 'ok';
        if (days < 0) level = 'expired';
        else if (days <= EXPIRING_SOON_DAYS) level = 'soon';
        return { date, days, level };
    }

    const isExpired = lot => expiryStatus(lot.date).level === 'expired';

    function expiryBadge(status) {
        if (status.level === 'expired') {
            return `<span class="badge badge-expired">${icon('alert')} Expiré</span>`;
        }
        if (status.level === 'soon') {
            const label = status.days === 0 ? "Expire aujourd'hui" : `Expire dans ${plural(status.days, 'jour')}`;
            return `<span class="badge badge-soon">${icon('clock')} ${label}</span>`;
        }
        return '';
    }

    // =========================================================
    // Persistance
    // =========================================================
    const storage = {
        read(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch {
                return fallback;
            }
        },
        write(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        }
    };

    // Rend les données robustes (anciennes versions, données corrompues, ids numériques…)
    function sanitizeTickets(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .map(t => ({
                id: String(t.id ?? createId()),
                name: String(t.name ?? '').trim(),
                value: Number(t.value),
                quantity: parseInt(t.quantity, 10),
                date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayISO(),
                reference: String(t.reference ?? '').trim()
            }))
            .filter(t => t.name && t.value > 0 && t.quantity > 0);
    }

    // Clés des anciennes versions de l'application
    ['backgroundColor', 'history', 'dailyCap'].forEach(key => localStorage.removeItem(key));

    // =========================================================
    // État
    // =========================================================
    let tickets = sanitizeTickets(storage.read(STORAGE_KEYS.tickets, []));
    let journal = storage.read(STORAGE_KEYS.journal, []);
    if (!Array.isArray(journal)) journal = [];

    const ui = {
        query: '',
        sort: 'name',
        openGroups: new Set(),
        period: { from: '', to: '' },
        editingId: null
    };

    function persist() {
        storage.write(STORAGE_KEYS.tickets, tickets);
        storage.write(STORAGE_KEYS.journal, journal);
    }

    function commit() {
        persist();
        render();
    }

    /** Ajoute une ligne au journal des opérations (traçabilité des saisies). */
    function log(type, text, amount = 0) {
        journal.unshift({ id: createId(), at: new Date().toISOString(), type, text, amount });
        journal.length = Math.min(journal.length, JOURNAL_MAX_ENTRIES);
    }

    /**
     * Applique une modification et propose de l'annuler via un toast.
     * On sauvegarde un instantané de l'état avant mutation : annuler restaure
     * les tickets ET le journal, comme si l'opération n'avait jamais eu lieu.
     */
    let dismissPreviousUndo = () => {};

    function withUndo(message, mutate) {
        // Seule la dernière action est annulable : restaurer un instantané plus ancien
        // effacerait silencieusement les opérations faites depuis.
        dismissPreviousUndo();
        const snapshot = {
            tickets: structuredClone(tickets),
            journal: structuredClone(journal)
        };
        mutate();
        commit();
        dismissPreviousUndo = showToast(message, {
            actionLabel: 'Annuler',
            onAction: () => {
                tickets = snapshot.tickets;
                journal = snapshot.journal;
                commit();
                showToast('Action annulée');
            }
        });
    }

    // =========================================================
    // Domaine : calculs
    // =========================================================
    const lotTotal = t => t.value * t.quantity;
    const describeLot = t => `${t.name} — ${t.quantity} × ${formatMoney(t.value)}`;

    function groupTickets(list) {
        const groups = new Map();
        for (const ticket of list) {
            if (!groups.has(ticket.name)) {
                groups.set(ticket.name, { name: ticket.name, lots: [] });
            }
            groups.get(ticket.name).lots.push(ticket);
        }
        return [...groups.values()].map(group => {
            const usable = group.lots.filter(t => !isExpired(t));
            const values = [...new Set(group.lots.map(t => t.value))].sort((a, b) => a - b);
            const oldestUsable = usable.length
                ? usable.reduce((min, t) => (t.date < min.date ? t : min)).date
                : null;
            group.lots.sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);
            return {
                ...group,
                values,
                quantity: sum(group.lots, t => t.quantity),
                total: sum(group.lots, lotTotal),
                latestDate: group.lots[group.lots.length - 1].date,
                status: oldestUsable ? expiryStatus(oldestUsable) : { level: 'expired' }
            };
        });
    }

    // Couleur stable par nom de ticket (même couleur dans la barre et la liste)
    function colorIndexFor(name) {
        const names = [...new Set(tickets.map(t => t.name))].sort((a, b) => a.localeCompare(b, 'fr'));
        return (names.indexOf(name) % SERIES_COLORS) + 1;
    }

    const inPeriod = (lot, { from, to }) => (!from || lot.date >= from) && (!to || lot.date <= to);

    /** Synthèse comptable : émetteur → valeur faciale → quantité et montant. */
    function computeSummary(period) {
        const lots = tickets.filter(t => inPeriod(t, period));
        const byIssuer = new Map();
        for (const lot of lots) {
            if (!byIssuer.has(lot.name)) byIssuer.set(lot.name, new Map());
            const byValue = byIssuer.get(lot.name);
            const key = toCents(lot.value);
            const row = byValue.get(key) || { value: lot.value, quantity: 0, total: 0 };
            row.quantity += lot.quantity;
            row.total += lotTotal(lot);
            byValue.set(key, row);
        }

        const issuers = [...byIssuer.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'fr'))
            .map(([name, byValue]) => {
                const rows = [...byValue.values()].sort((a, b) => a.value - b.value);
                return {
                    name,
                    rows,
                    quantity: sum(rows, r => r.quantity),
                    total: sum(rows, r => r.total)
                };
            });

        const expired = lots.filter(isExpired);
        return {
            issuers,
            lotCount: lots.length,
            quantity: sum(issuers, i => i.quantity),
            total: sum(issuers, i => i.total),
            expiredTotal: sum(expired, lotTotal)
        };
    }

    // =========================================================
    // Domaine : mutations
    // =========================================================
    function addLot({ name, value, quantity, date, reference }) {
        // Fusionne avec un lot identique existant plutôt que de dupliquer
        const existing = tickets.find(t =>
            t.name.toLowerCase() === name.toLowerCase() &&
            toCents(t.value) === toCents(value) &&
            t.date === date &&
            t.reference === reference
        );
        if (existing) {
            existing.quantity += quantity;
        } else {
            tickets.push({ id: createId(), name, value, quantity, date, reference });
        }
    }

    // =========================================================
    // Validation des formulaires
    // =========================================================
    const FORM_FIELDS = ['name', 'value', 'quantity', 'date', 'reference'];

    function readTicketForm(form) {
        const { name, value, quantity, date, reference } = form.elements;
        return {
            name: name.value.trim(),
            value: parseFloat(value.value),
            quantity: Number(quantity.value),
            date: date.value,
            reference: reference.value.trim()
        };
    }

    function validateTicket(data) {
        const errors = {};
        if (!data.name) errors.name = 'Indiquez un nom.';
        else if (data.name.length > 60) errors.name = '60 caractères maximum.';
        if (!(data.value > 0)) errors.value = 'La valeur doit être supérieure à 0.';
        else if (data.value > 1000) errors.value = 'Valeur trop élevée.';
        if (!Number.isInteger(data.quantity) || data.quantity < 1) errors.quantity = 'Quantité entière ≥ 1.';
        else if (data.quantity > 100000) errors.quantity = 'Quantité trop élevée.';
        if (!data.date) errors.date = 'Choisissez une date.';
        if (data.reference.length > 80) errors.reference = '80 caractères maximum.';
        return errors;
    }

    function showFormErrors(form, errors, prefix) {
        let firstInvalid = null;
        for (const field of FORM_FIELDS) {
            const input = form.elements[field];
            const message = errors[field] || '';
            $(`#${prefix}-${field}-error`).textContent = message;
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
            if (message && !firstInvalid) firstInvalid = input;
        }
        if (firstInvalid) {
            firstInvalid.focus();
            shake(form);
        }
        return !firstInvalid;
    }

    function shake(element) {
        element.classList.remove('shake');
        void element.offsetWidth; // relance l'animation
        element.classList.add('shake');
    }

    // =========================================================
    // Rendu
    // =========================================================
    const els = {
        statBalance: $('#stat-balance'),
        statBalanceSub: $('#stat-balance-sub'),
        statCount: $('#stat-count'),
        statCountSub: $('#stat-count-sub'),
        statExpiring: $('#stat-expiring'),
        statExpiringSub: $('#stat-expiring-sub'),
        statExpiringCard: $('#stat-expiring-card'),
        statIssuers: $('#stat-issuers'),
        statIssuersSub: $('#stat-issuers-sub'),
        distribution: $('#distribution'),
        list: $('#ticket-list'),
        journal: $('#history-list'),
        suggestions: $('#name-suggestions'),
        summary: $('#summary')
    };

    function render() {
        renderStats();
        renderSummary();
        renderDistribution();
        renderList();
        renderJournal();
        renderSuggestions();
    }

    function renderStats() {
        const withStatus = tickets.map(t => ({ ...t, status: expiryStatus(t.date) }));
        const valid = withStatus.filter(t => t.status.level !== 'expired');
        const expired = withStatus.filter(t => t.status.level === 'expired');
        const soon = withStatus.filter(t => t.status.level === 'soon');

        els.statBalance.textContent = formatMoney(sum(valid, lotTotal));
        els.statBalanceSub.textContent = expired.length
            ? `+ ${formatMoney(sum(expired, lotTotal))} expirés`
            : 'Tickets valides uniquement';

        const count = sum(tickets, t => t.quantity);
        els.statCount.textContent = count.toLocaleString('fr-FR');
        els.statCountSub.textContent = count
            ? `Valeur moyenne ${formatMoney(sum(tickets, lotTotal) / count)}`
            : 'Aucun ticket';

        const soonCount = sum(soon, t => t.quantity);
        els.statExpiring.textContent = formatMoney(sum(soon, lotTotal));
        els.statExpiringSub.textContent = soonCount
            ? `${plural(soonCount, 'ticket')} sous ${EXPIRING_SOON_DAYS} j`
            : 'Rien à signaler';
        els.statExpiringCard.classList.toggle('is-warning', soonCount > 0);

        const issuers = new Set(tickets.map(t => t.name)).size;
        els.statIssuers.textContent = issuers;
        els.statIssuersSub.textContent = tickets.length ? plural(tickets.length, 'lot') : 'Aucun lot';
    }

    function periodLabel({ from, to }) {
        if (!from && !to) return 'toutes dates';
        if (from && to) return `du ${formatDate(from)} au ${formatDate(to)}`;
        return from ? `depuis le ${formatDate(from)}` : `jusqu'au ${formatDate(to)}`;
    }

    function renderSummary() {
        const summary = computeSummary(ui.period);

        if (summary.lotCount === 0) {
            els.summary.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">${icon('receipt')}</div>
                    <strong>Aucun ticket sur cette période</strong>
                    <span>${tickets.length ? 'Élargissez la période pour voir la synthèse.' : 'Saisissez des tickets pour obtenir une synthèse.'}</span>
                </div>`;
            return;
        }

        const body = summary.issuers.map(issuer => {
            const rows = issuer.rows.map((row, i) => `
                <tr>
                    ${i === 0 ? `<td class="issuer-cell" rowspan="${issuer.rows.length}">${escapeHtml(issuer.name)}</td>` : ''}
                    <td class="col-num">${formatMoney(row.value)}</td>
                    <td class="col-num">${row.quantity.toLocaleString('fr-FR')}</td>
                    <td class="col-num">${formatMoney(row.total)}</td>
                </tr>`).join('');
            const subtotal = issuer.rows.length > 1 ? `
                <tr class="subtotal">
                    <td colspan="2">Sous-total ${escapeHtml(issuer.name)}</td>
                    <td class="col-num">${issuer.quantity.toLocaleString('fr-FR')}</td>
                    <td class="col-num">${formatMoney(issuer.total)}</td>
                </tr>` : '';
            return rows + subtotal;
        }).join('');

        els.summary.innerHTML = `
            <div class="summary-scroll">
                <table class="summary-table">
                    <caption class="visually-hidden">Synthèse ${periodLabel(ui.period)}</caption>
                    <thead>
                        <tr>
                            <th scope="col">Émetteur</th>
                            <th scope="col" class="col-num">Valeur faciale</th>
                            <th scope="col" class="col-num">Quantité</th>
                            <th scope="col" class="col-num">Montant</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="2">Total</td>
                            <td class="col-num">${summary.quantity.toLocaleString('fr-FR')}</td>
                            <td class="col-num">${formatMoney(summary.total)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p class="summary-note">
                ${plural(summary.lotCount, 'lot')} émis ${periodLabel(ui.period)}${summary.expiredTotal > 0 ? ` · dont ${formatMoney(summary.expiredTotal)} expirés` : ''}.
            </p>`;
    }

    function renderDistribution() {
        const groups = groupTickets(tickets).filter(g => g.total > 0);
        if (groups.length < 2) {
            els.distribution.innerHTML = '';
            return;
        }
        const total = sum(groups, g => g.total);
        groups.sort((a, b) => b.total - a.total);

        els.distribution.innerHTML = `
            <div class="dist-bar" role="img" aria-label="Répartition de la valeur par émetteur">
                ${groups.map(g => `<span class="dist-seg" style="--c: var(--c${colorIndexFor(g.name)})" data-width="${(g.total / total) * 100}" title="${escapeHtml(g.name)} : ${formatMoney(g.total)}"></span>`).join('')}
            </div>
            <ul class="dist-legend">
                ${groups.map(g => `
                    <li><span class="dot" style="--c: var(--c${colorIndexFor(g.name)})"></span>
                    ${escapeHtml(g.name)} · ${Math.round((g.total / total) * 100)} %</li>`).join('')}
            </ul>`;

        // Largeur appliquée après insertion pour profiter de la transition CSS
        requestAnimationFrame(() => {
            els.distribution.querySelectorAll('.dist-seg').forEach(seg => {
                seg.style.width = seg.dataset.width + '%';
            });
        });
    }

    function sortGroups(groups) {
        const comparators = {
            name: (a, b) => a.name.localeCompare(b.name, 'fr'),
            total: (a, b) => b.total - a.total,
            quantity: (a, b) => b.quantity - a.quantity,
            expiry: (a, b) => (a.status.days ?? Infinity) - (b.status.days ?? Infinity),
            recent: (a, b) => b.latestDate.localeCompare(a.latestDate)
        };
        return groups.sort(comparators[ui.sort]);
    }

    function renderList() {
        if (tickets.length === 0) {
            els.list.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">${icon('ticket')}</div>
                    <strong>Aucun ticket pour le moment</strong>
                    <span>Saisissez un premier lot avec le formulaire ci-dessus, ou importez un fichier CSV.</span>
                </div>`;
            return;
        }

        // La recherche porte sur le nom et sur la référence des lots
        const query = normalizeText(ui.query.trim());
        const matches = t => !query || normalizeText(`${t.name} ${t.reference}`).includes(query);
        const groups = sortGroups(groupTickets(tickets.filter(matches)));

        if (groups.length === 0) {
            els.list.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">${icon('search')}</div>
                    <strong>Aucun résultat</strong>
                    <span>Aucun lot ne correspond à « ${escapeHtml(ui.query)} ».</span>
                </div>`;
            return;
        }

        const grandTotal = sum(groups, g => g.total);
        els.list.innerHTML = groups.map((group, index) => renderGroup(group, index, Boolean(query))).join('') + `
            <div class="list-total">
                <span>Total${query ? ' (filtré)' : ''}</span>
                <span class="num">${formatMoney(grandTotal)}</span>
            </div>`;
    }

    function renderGroup(group, index, filtered) {
        const valuesLabel = group.values.map(formatMoney).join(' / ');
        // Pendant une recherche, on déplie les groupes pour montrer les lots trouvés
        const isOpen = filtered || ui.openGroups.has(group.name);
        return `
            <details class="group" data-name="${escapeHtml(group.name)}" ${isOpen ? 'open' : ''} style="animation-delay:${index * 0.03}s">
                <summary class="group-summary">
                    <span class="group-color" style="--c: var(--c${colorIndexFor(group.name)})"></span>
                    <span class="group-info">
                        <span class="group-name">${escapeHtml(group.name)}</span>
                        <span class="group-meta">${plural(group.quantity, 'ticket')} · ${plural(group.lots.length, 'lot')} · ${valuesLabel}</span>
                    </span>
                    <span class="group-badge">${expiryBadge(group.status)}</span>
                    <span class="group-total">${formatMoney(group.total)}</span>
                    <span class="group-chevron">${icon('chevron')}</span>
                </summary>
                <div class="group-body">
                    <table class="lots">
                        <thead>
                            <tr>
                                <th scope="col">Valeur</th>
                                <th scope="col" class="col-num">Quantité</th>
                                <th scope="col">Émis le</th>
                                <th scope="col">Valable jusqu'au</th>
                                <th scope="col">Référence</th>
                                <th scope="col" class="col-num">Total</th>
                                <th scope="col" class="col-actions"><span class="visually-hidden">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody>${group.lots.map(renderLot).join('')}</tbody>
                    </table>
                    <div class="group-footer">
                        <button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete-group" data-name="${escapeHtml(group.name)}">
                            ${icon('trash')} Supprimer « ${escapeHtml(group.name)} »
                        </button>
                    </div>
                </div>
            </details>`;
    }

    function renderLot(lot) {
        const status = expiryStatus(lot.date);
        const reference = lot.reference
            ? `<span class="ref" title="${escapeHtml(lot.reference)}">${escapeHtml(lot.reference)}</span>`
            : '—';
        return `
            <tr class="${status.level === 'expired' ? 'is-expired' : ''}">
                <td data-label="Valeur">${formatMoney(lot.value)}</td>
                <td data-label="Quantité" class="col-num">${lot.quantity.toLocaleString('fr-FR')}</td>
                <td data-label="Émis le">${formatDate(lot.date)}</td>
                <td data-label="Valable jusqu'au">${formatDate(toISODate(status.date))} ${expiryBadge(status)}</td>
                <td data-label="Référence">${reference}</td>
                <td data-label="Total" class="col-num"><strong>${formatMoney(lotTotal(lot))}</strong></td>
                <td class="col-actions">
                    <button type="button" class="action-btn" data-action="edit" data-id="${lot.id}"
                        title="Modifier" aria-label="Modifier ce lot">${icon('edit')}</button>
                    <button type="button" class="action-btn is-danger" data-action="delete" data-id="${lot.id}"
                        title="Supprimer" aria-label="Supprimer ce lot">${icon('trash')}</button>
                </td>
            </tr>`;
    }

    const JOURNAL_ICONS = { add: 'plus', edit: 'edit', delete: 'trash', import: 'upload', reset: 'alert' };

    function renderJournal() {
        if (journal.length === 0) {
            els.journal.innerHTML = `
                <li class="empty">
                    <div class="empty-icon">${icon('receipt')}</div>
                    <strong>Aucune opération enregistrée</strong>
                    <span>Les ajouts, modifications, suppressions et imports apparaîtront ici.</span>
                </li>`;
            return;
        }

        els.journal.innerHTML = journal.map(entry => {
            const at = new Date(entry.at);
            const amount = entry.amount
                ? `<div class="history-amount">${entry.amount > 0 ? '+' : '−'}${formatMoney(Math.abs(entry.amount))}</div>`
                : '<div></div>';
            return `
                <li class="history-item history-${entry.type}">
                    <div class="history-date" title="${at.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}">
                        <b>${at.toLocaleDateString('fr-FR', { day: 'numeric' })}</b>
                        <span>${at.toLocaleDateString('fr-FR', { month: 'short' })}</span>
                    </div>
                    <div>
                        <div class="history-title">${escapeHtml(entry.text)}</div>
                        <div class="history-detail">${at.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    </div>
                    ${amount}
                    <span class="history-icon">${icon(JOURNAL_ICONS[entry.type] || 'check')}</span>
                </li>`;
        }).join('');
    }

    function renderSuggestions() {
        const names = [...new Set(tickets.map(t => t.name))].sort((a, b) => a.localeCompare(b, 'fr'));
        els.suggestions.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    }

    // =========================================================
    // Composants : toasts & dialogues
    // =========================================================
    const toastRegion = $('#toast-region');

    function showToast(message, { type = 'success', actionLabel, onAction, duration = 5000 } = {}) {
        const toast = document.createElement('div');
        toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
        toast.innerHTML = `
            ${icon(type === 'error' ? 'alert' : 'check')}
            <span class="toast-msg"></span>
            ${actionLabel ? `<button type="button" class="toast-action">${icon('undo')} ${escapeHtml(actionLabel)}</button>` : ''}`;
        toast.querySelector('.toast-msg').textContent = message;

        const dismiss = () => {
            if (toast.classList.contains('is-leaving')) return;
            toast.classList.add('is-leaving');
            toast.addEventListener('animationend', () => toast.remove(), { once: true });
        };

        if (actionLabel) {
            toast.querySelector('.toast-action').addEventListener('click', () => {
                if (toast.classList.contains('is-leaving')) return;
                dismiss();
                onAction();
            });
        }

        // Pas plus de 3 toasts empilés
        while (toastRegion.children.length >= 3) toastRegion.firstElementChild.remove();
        toastRegion.appendChild(toast);
        setTimeout(dismiss, duration);
        return dismiss;
    }

    const confirmDialog = $('#confirm-dialog');

    function askConfirmation({ title, message, confirmLabel = 'Confirmer' }) {
        $('#confirm-title').textContent = title;
        $('#confirm-message').textContent = message;
        $('#confirm-ok').textContent = confirmLabel;
        confirmDialog.returnValue = '';
        confirmDialog.showModal();
        return new Promise(resolve => {
            confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
        });
    }

    const editDialog = $('#edit-dialog');
    const editForm = $('#edit-form');

    function openEditDialog(id) {
        const lot = tickets.find(t => t.id === id);
        if (!lot) return;
        ui.editingId = id;
        for (const field of FORM_FIELDS) editForm.elements[field].value = lot[field];
        showFormErrors(editForm, {}, 'edit');
        editDialog.showModal();
    }

    // Ferme les dialogues en cliquant sur le fond
    for (const dialog of [editDialog, confirmDialog]) {
        dialog.addEventListener('click', event => {
            if (event.target === dialog) dialog.close();
        });
    }

    editDialog.querySelector('[data-close]').addEventListener('click', () => editDialog.close());

    editForm.addEventListener('submit', event => {
        event.preventDefault();
        const data = readTicketForm(editForm);
        if (!showFormErrors(editForm, validateTicket(data), 'edit')) return;

        const lot = tickets.find(t => t.id === ui.editingId);
        if (lot) {
            withUndo('Lot modifié', () => {
                const delta = lotTotal(data) - lotTotal(lot);
                log('edit', `Modification : ${describeLot(data)}`, delta);
                Object.assign(lot, data);
            });
        }
        editDialog.close();
    });

    // =========================================================
    // Formulaire d'ajout
    // =========================================================
    const ticketForm = $('#ticket-form');
    const quickValues = $('#quick-values');
    const formPreview = $('#form-preview');
    const dateHint = $('#ticket-date-hint');

    ticketForm.elements.date.value = todayISO();

    quickValues.innerHTML = QUICK_VALUES
        .map(v => `<button type="button" class="chip" data-value="${v}" aria-pressed="false">${formatMoney(v)}</button>`)
        .join('');

    quickValues.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        ticketForm.elements.value.value = chip.dataset.value;
        updateFormPreview();
        ticketForm.elements.quantity.focus();
    });

    ticketForm.querySelectorAll('.stepper-btn').forEach(button => {
        button.addEventListener('click', () => {
            const input = ticketForm.elements.quantity;
            input.value = Math.max(1, (parseInt(input.value, 10) || 0) + Number(button.dataset.step));
            updateFormPreview();
        });
    });

    // Aperçu en direct du total et de la date limite d'utilisation
    function updateFormPreview() {
        const { value, quantity, date } = readTicketForm(ticketForm);

        quickValues.querySelectorAll('.chip').forEach(chip => {
            chip.setAttribute('aria-pressed', String(Number(chip.dataset.value) === value));
        });

        formPreview.innerHTML = value > 0 && quantity > 0
            ? `${quantity.toLocaleString('fr-FR')} × ${formatMoney(value)} = <strong>${formatMoney(value * quantity)}</strong>`
            : '';

        if (date) {
            const status = expiryStatus(date);
            dateHint.textContent = status.level === 'expired'
                ? `⚠ Ces tickets ont expiré le ${formatDate(toISODate(status.date))}.`
                : `Utilisables jusqu'au ${formatDate(toISODate(status.date), { dateStyle: 'long' })}.`;
        } else {
            dateHint.textContent = '';
        }
    }

    ticketForm.addEventListener('input', event => {
        event.target.removeAttribute('aria-invalid');
        const error = $(`#${event.target.id}-error`);
        if (error) error.textContent = '';
        updateFormPreview();
    });

    ticketForm.addEventListener('submit', event => {
        event.preventDefault();
        const data = readTicketForm(ticketForm);
        if (!showFormErrors(ticketForm, validateTicket(data), 'ticket')) return;

        withUndo(`${plural(data.quantity, 'ticket ajouté', 'tickets ajoutés')} (${formatMoney(lotTotal(data))})`, () => {
            addLot(data);
            log('add', `Ajout : ${describeLot(data)}${data.reference ? ` (réf. ${data.reference})` : ''}`, lotTotal(data));
        });
        ui.openGroups.add(data.name);
        renderList();

        // On garde valeur, date et référence : on saisit souvent plusieurs lots d'une même facture
        ticketForm.elements.name.value = '';
        ticketForm.elements.quantity.value = 1;
        updateFormPreview();
        ticketForm.elements.name.focus();
    });

    updateFormPreview();

    // =========================================================
    // Synthèse : choix de la période
    // =========================================================
    const periodFrom = $('#period-from');
    const periodTo = $('#period-to');
    const periodPresets = $('#period-presets');

    function presetRange(preset) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        switch (preset) {
            case 'month': return { from: toISODate(new Date(y, m, 1)), to: toISODate(new Date(y, m + 1, 0)) };
            case 'last-month': return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
            case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
            default: return { from: '', to: '' };
        }
    }

    function setPeriod(period) {
        ui.period = period;
        periodFrom.value = period.from;
        periodTo.value = period.to;
        // Le préréglage correspondant à la période saisie est mis en évidence
        periodPresets.querySelectorAll('.chip').forEach(chip => {
            const range = presetRange(chip.dataset.period);
            chip.setAttribute('aria-pressed', String(range.from === period.from && range.to === period.to));
        });
        renderSummary();
    }

    periodPresets.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (chip) setPeriod(presetRange(chip.dataset.period));
    });

    for (const input of [periodFrom, periodTo]) {
        input.addEventListener('change', () => setPeriod({ from: periodFrom.value, to: periodTo.value }));
    }

    // =========================================================
    // Liste : recherche, tri, actions (délégation d'événements)
    // =========================================================
    const searchInput = $('#search');
    const sortSelect = $('#sort');

    searchInput.addEventListener('input', () => {
        ui.query = searchInput.value;
        renderList();
    });

    sortSelect.addEventListener('change', () => {
        ui.sort = sortSelect.value;
        renderList();
    });

    // 'toggle' ne remonte pas : on l'écoute en phase de capture
    els.list.addEventListener('toggle', event => {
        const group = event.target;
        if (!group.matches('.group') || ui.query) return;
        if (group.open) ui.openGroups.add(group.dataset.name);
        else ui.openGroups.delete(group.dataset.name);
    }, true);

    els.list.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const { action, id, name } = button.dataset;
        const lot = tickets.find(t => t.id === id);

        switch (action) {
            case 'edit':
                openEditDialog(id);
                break;
            case 'delete':
                if (!lot) return;
                withUndo(`Lot de ${plural(lot.quantity, 'ticket')} supprimé`, () => {
                    log('delete', `Suppression : ${describeLot(lot)}`, -lotTotal(lot));
                    tickets = tickets.filter(t => t.id !== id);
                });
                break;
            case 'delete-group': {
                const lots = tickets.filter(t => t.name === name);
                withUndo(`Tous les tickets « ${name} » ont été supprimés`, () => {
                    log('delete', `Suppression de l'émetteur « ${name} » (${plural(lots.length, 'lot')})`, -sum(lots, lotTotal));
                    tickets = tickets.filter(t => t.name !== name);
                    ui.openGroups.delete(name);
                });
                break;
            }
        }
    });

    // =========================================================
    // Import / export CSV
    // =========================================================
    const CSV_SEPARATOR = ';'; // ; et virgule décimale : s'ouvre directement dans Excel FR

    function csvCell(value) {
        const text = String(value);
        return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    const toCsv = rows => rows.map(row => row.map(csvCell).join(CSV_SEPARATOR)).join('\r\n');
    const frNumber = n => n.toFixed(2).replace('.', ',');

    function generateCsv() {
        const header = ['Nom du ticket', 'Valeur unitaire (€)', 'Quantité', "Date d'émission", "Valable jusqu'au", 'Valeur totale (€)', 'Référence'];
        const rows = [...tickets]
            .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.date.localeCompare(b.date))
            .map(t => [
                t.name,
                frNumber(t.value),
                t.quantity,
                formatDate(t.date),
                formatDate(toISODate(expiryDateOf(t.date))),
                frNumber(lotTotal(t)),
                t.reference
            ]);
        return toCsv([header, ...rows]);
    }

    function generateSummaryCsv() {
        const summary = computeSummary(ui.period);
        const rows = [
            [`Synthèse des titres-restaurant ${periodLabel(ui.period)}`],
            [],
            ['Émetteur', 'Valeur faciale (€)', 'Quantité', 'Montant (€)']
        ];
        for (const issuer of summary.issuers) {
            issuer.rows.forEach(r => rows.push([issuer.name, frNumber(r.value), r.quantity, frNumber(r.total)]));
            rows.push([`Sous-total ${issuer.name}`, '', issuer.quantity, frNumber(issuer.total)]);
        }
        rows.push(['Total', '', summary.quantity, frNumber(summary.total)]);
        return toCsv(rows);
    }

    function downloadFile(content, filename, type) {
        // Le BOM permet à Excel de détecter l'UTF-8 (accents, €)
        const blob = new Blob(['﻿' + content], { type });
        const url = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function parseCsv(text) {
        text = text.replace(/^﻿/, '');
        const firstLine = text.split(/\r?\n/, 1)[0];
        const separator = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';

        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inQuotes) {
                if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
                else if (char === '"') inQuotes = false;
                else cell += char;
            } else if (char === '"') {
                inQuotes = true;
            } else if (char === separator) {
                row.push(cell); cell = '';
            } else if (char === '\n' || char === '\r') {
                if (char === '\r' && text[i + 1] === '\n') i++;
                row.push(cell); rows.push(row);
                row = []; cell = '';
            } else {
                cell += char;
            }
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(c => c.trim()));
    }

    function parseNumber(text) {
        return parseFloat(String(text).replace(/[€\s ]/g, '').replace(',', '.'));
    }

    function parseDate(text) {
        const value = String(text).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        const fr = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
        return '';
    }

    $('#export-csv').addEventListener('click', () => {
        if (tickets.length === 0) {
            showToast('Aucun ticket à exporter.', { type: 'error' });
            return;
        }
        downloadFile(generateCsv(), `inventaire_tickets_${todayISO()}.csv`, 'text/csv;charset=utf-8');
        showToast('Export CSV téléchargé');
    });

    $('#export-summary').addEventListener('click', () => {
        if (computeSummary(ui.period).lotCount === 0) {
            showToast('Aucun ticket sur cette période.', { type: 'error' });
            return;
        }
        const suffix = ui.period.from || ui.period.to ? `${ui.period.from || 'debut'}_${ui.period.to || 'fin'}` : todayISO();
        downloadFile(generateSummaryCsv(), `synthese_tickets_${suffix}.csv`, 'text/csv;charset=utf-8');
        showToast('Synthèse CSV téléchargée');
    });

    $('#import-csv').addEventListener('change', async event => {
        const input = event.target;
        const file = input.files[0];
        input.value = ''; // permet de réimporter le même fichier
        if (!file) return;

        const rows = parseCsv(await file.text());
        // Colonnes attendues (format de l'export) : nom, valeur, quantité, date, [validité, total, référence]
        const lots = [];
        let skipped = 0;
        rows.forEach((cells, index) => {
            const data = {
                name: (cells[0] || '').trim(),
                value: parseNumber(cells[1]),
                quantity: Number(parseNumber(cells[2])),
                date: parseDate(cells[3] || ''),
                reference: (cells[6] || '').trim()
            };
            if (Object.keys(validateTicket(data)).length === 0) lots.push(data);
            else if (index > 0) skipped++; // la 1re ligne invalide est l'en-tête
        });

        if (lots.length === 0) {
            showToast('Aucune ligne valide trouvée dans ce fichier.', { type: 'error' });
            return;
        }

        withUndo(
            `${plural(lots.length, 'lot importé', 'lots importés')}${skipped ? `, ${plural(skipped, 'ligne ignorée', 'lignes ignorées')}` : ''}`,
            () => {
                lots.forEach(addLot);
                log('import', `Import de « ${file.name} » : ${plural(lots.length, 'lot')}`, sum(lots, lotTotal));
            }
        );
    });

    $('#reset-data').addEventListener('click', async () => {
        if (tickets.length === 0 && journal.length === 0) {
            showToast('Il n\'y a rien à effacer.', { type: 'error' });
            return;
        }
        const confirmed = await askConfirmation({
            title: 'Tout effacer ?',
            message: 'Tous les tickets et le journal des opérations seront supprimés. Pensez à exporter un CSV avant.',
            confirmLabel: 'Tout effacer'
        });
        if (!confirmed) return;
        withUndo('Toutes les données ont été effacées', () => {
            tickets = [];
            journal = [];
            ui.openGroups.clear();
        });
    });

    // =========================================================
    // Impression : tous les groupes sont dépliés le temps de l'impression
    // =========================================================
    let closedBeforePrint = [];

    window.addEventListener('beforeprint', () => {
        closedBeforePrint = [...els.list.querySelectorAll('details.group:not([open])')];
        closedBeforePrint.forEach(group => { group.open = true; });
    });

    window.addEventListener('afterprint', () => {
        closedBeforePrint.forEach(group => { group.open = false; });
        closedBeforePrint = [];
    });

    $('#print').addEventListener('click', () => window.print());

    // =========================================================
    // Thème & couleur d'accent
    // =========================================================
    const root = document.documentElement;
    const themeToggle = $('#theme-toggle');
    const accentPicker = $('#accent-picker');

    function applyTheme(theme) {
        root.dataset.theme = theme;
        themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre');
    }

    themeToggle.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEYS.theme, next);
        applyTheme(next);
    });

    applyTheme(root.dataset.theme || 'light');

    function applyAccent(color) {
        root.style.setProperty('--accent', color);
        $('meta[name="theme-color"]').setAttribute('content', color);
        accentPicker.querySelectorAll('.swatch').forEach(swatch => {
            swatch.setAttribute('aria-checked', String(swatch.dataset.color === color));
        });
    }

    accentPicker.innerHTML = ACCENTS.map(a => `
        <button type="button" class="swatch" role="radio" data-color="${a.value}"
            style="--swatch:${a.value}" aria-label="${a.name}" title="${a.name}"></button>`).join('');

    accentPicker.addEventListener('click', event => {
        const swatch = event.target.closest('.swatch');
        if (!swatch) return;
        localStorage.setItem(STORAGE_KEYS.accent, swatch.dataset.color);
        applyAccent(swatch.dataset.color);
    });

    applyAccent(localStorage.getItem(STORAGE_KEYS.accent) || ACCENTS[0].value);

    // =========================================================
    // Raccourcis clavier
    // =========================================================
    document.addEventListener('keydown', event => {
        const typing = event.target.closest('input, textarea, select');
        if (event.key === '/' && !typing && !document.querySelector('dialog[open]')) {
            event.preventDefault();
            searchInput.focus();
        }
        if (event.key === 'Escape' && event.target === searchInput && searchInput.value) {
            searchInput.value = '';
            ui.query = '';
            renderList();
        }
    });

    // =========================================================
    // Démarrage
    // =========================================================
    render();
})();
