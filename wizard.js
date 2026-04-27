/**
 * Ascend Enterprise Onboarding Wizard — GitHub Pages version
 * Uses localStorage instead of API backend for standalone testing.
 */

const STORAGE_KEY = 'ascend_onboarding';
let currentStep = -1;
let account = null;
let travelers = [];
let hsCompanyId = null;  // HubSpot company ID from search selection

// ---- Configuration ----
// Replace with live Stripe Payment Link URL. Use ?client_reference_id= to pass account ID.
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_PLACEHOLDER';
// Redirect URL after Stripe payment (this page with ?payment=success&account=ID)
const STRIPE_SUCCESS_URL = window.location.origin + window.location.pathname;
// Vapi Discovery Agent (web call)
const VAPI_ASSISTANT_ID = 'b4e89d33-0315-41dd-9d62-abbb3b871303';
// AE Calendly is resolved dynamically from HubSpot — these are fallbacks
const AE_CALENDLY_FALLBACK = {
    'mike finneran':   'https://calendly.com/mikefinneran',
    'chloe calandra':  'https://calendly.com/chloe-joinascend',
    'cam':             'https://calendly.com/cam-joinascend',
    'zach resnick':    'https://calendly.com/zach-joinascend',
};
const DEFAULT_AE_CALENDLY = 'https://calendly.com/mikefinneran';

// ---- Pricing Constants (from pricing.html) ----

const P_RATE_ANNUAL = 2500;
const P_RATE_MONTHLY = 300;
const P_LOGO_DISCOUNTS = { none: 0, good: 0.05, better: 0.10, best: 0.15 };
const P_NETWORK_TIERS = { low: 0, medium: 0.04, high: 0.08 };
const P_REFERRAL_BONUS = 0.02;
const P_TRAVEL_MIX_PRESETS = {
    heavy_economy:  { economy: 0.70, business: 0.25, first: 0.05 },
    balanced:       { economy: 0.40, business: 0.40, first: 0.20 },
    heavy_premium:  { economy: 0.15, business: 0.50, first: 0.35 },
    all_premium:    { economy: 0,    business: 0.50, first: 0.50 },
};
const P_CABIN_MARGIN_MULT = { economy: 0.6, business: 1.0, first: 1.4 };

let pWaterfallChart = null;
let pMarginChart = null;
let pCalcResult = {};

// ---- localStorage "API" ----

function db_load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function db_save(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function uid() { return 'id-' + Math.random().toString(36).slice(2, 14); }

async function api(method, path, body = null) {
    const store = db_load();
    if (!store.accounts) store.accounts = {};

    // Route matching
    const m = (pattern) => {
        const re = new RegExp('^' + pattern.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
        return path.match(re);
    };

    let result;

    // POST /accounts
    if (method === 'POST' && path === '/accounts') {
        const id = uid();
        const acct = { id, ...body, contract_status: 'draft', wizard_step: 'company', travelers: [], created_at: Date.now() / 1000, updated_at: Date.now() / 1000 };
        store.accounts[id] = acct;
        db_save(store);
        return acct;
    }

    // GET /accounts
    if (method === 'GET' && path === '/accounts') {
        return Object.values(store.accounts).sort((a, b) => b.created_at - a.created_at);
    }

    // GET /accounts/:id
    let match;
    if (method === 'GET' && (match = m('/accounts/\\{id\\}') || path.match(/^\/accounts\/([^/]+)$/))) {
        const id = match[1];
        const acct = store.accounts[id];
        if (!acct) throw new Error('Account not found');
        return { ...acct };
    }

    // PATCH /accounts/:id
    if (method === 'PATCH' && (match = path.match(/^\/accounts\/([^/]+)$/))) {
        const id = match[1];
        if (!store.accounts[id]) throw new Error('Account not found');
        Object.assign(store.accounts[id], body, { updated_at: Date.now() / 1000 });
        db_save(store);
        return { ...store.accounts[id] };
    }

    // POST /accounts/:id/travelers
    if (method === 'POST' && (match = path.match(/^\/accounts\/([^/]+)\/travelers$/))) {
        const id = match[1];
        if (!store.accounts[id]) throw new Error('Account not found');
        const tid = uid();
        const traveler = { id: tid, account_id: id, ...body, created_at: Date.now() / 1000 };
        store.accounts[id].travelers.push(traveler);
        db_save(store);
        return traveler;
    }

    // DELETE /accounts/:id/travelers/:tid
    if (method === 'DELETE' && (match = path.match(/^\/accounts\/([^/]+)\/travelers\/([^/]+)$/))) {
        const [, id, tid] = match;
        if (!store.accounts[id]) throw new Error('Account not found');
        store.accounts[id].travelers = store.accounts[id].travelers.filter(t => t.id !== tid);
        db_save(store);
        return { deleted: true };
    }

    // POST /accounts/:id/sign
    if (method === 'POST' && (match = path.match(/^\/accounts\/([^/]+)\/sign$/))) {
        const id = match[1];
        if (!store.accounts[id]) throw new Error('Account not found');
        store.accounts[id].contract_status = 'signed';
        store.accounts[id].signature_data = body.signature_data;
        store.accounts[id].signer_name = body.signer_name;
        store.accounts[id].signer_title = body.signer_title;
        store.accounts[id].signed_at = new Date().toISOString();
        db_save(store);
        return { status: 'signed', message: 'Agreement signed successfully.' };
    }

    // PATCH /accounts/:id/policy
    if (method === 'PATCH' && (match = path.match(/^\/accounts\/([^/]+)\/policy$/))) {
        const id = match[1];
        Object.assign(store.accounts[id], body, { updated_at: Date.now() / 1000 });
        db_save(store);
        return { ...store.accounts[id] };
    }

    // POST /accounts/:id/payment
    if (method === 'POST' && (match = path.match(/^\/accounts\/([^/]+)\/payment$/))) {
        const id = match[1];
        if (!store.accounts[id]) throw new Error('Account not found');
        store.accounts[id].payment_status = 'paid';
        store.accounts[id].paid_at = new Date().toISOString();
        store.accounts[id].payment_amount = body.amount;
        db_save(store);
        return { status: 'paid', message: 'Payment recorded.' };
    }

    // POST /accounts/:id/complete
    if (method === 'POST' && (match = path.match(/^\/accounts\/([^/]+)\/complete$/))) {
        const id = match[1];
        store.accounts[id].wizard_step = 'complete';
        db_save(store);
        return { status: 'complete', company: store.accounts[id].company_name, travelers: store.accounts[id].travelers.length, hubspot_synced: false };
    }

    throw new Error('Unknown route: ' + method + ' ' + path);
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', () => {
    if (handlePaymentRedirect()) return;
    loadAccounts();
    document.getElementById('effective_date').valueAsDate = new Date();
    initPricingListeners();
    pricingUpdateBasePrice();
    initHubSpotSearch();
    initHubSpotContactSearch();
});

// ---- Toast ----

function toast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), duration);
}

// ---- HubSpot Company Search ----

let _hsSearchTimer = null;

function initHubSpotSearch() {
    const input = document.getElementById('company_name');
    const dropdown = document.getElementById('hs-search-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(_hsSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) { dropdown.classList.add('hidden'); return; }
        _hsSearchTimer = setTimeout(() => hsSearch(q), 350);
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

async function hsSearch(query) {
    const dropdown = document.getElementById('hs-search-dropdown');
    try {
        const resp = await fetch(`/api/hubspot-deal?search=${encodeURIComponent(query)}`);
        if (!resp.ok) { dropdown.classList.add('hidden'); return; }
        const data = await resp.json();
        const results = data.results || [];

        dropdown.replaceChildren();

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'px-4 py-3 text-sm text-txt-muted';
            empty.textContent = 'No matches in HubSpot';
            dropdown.appendChild(empty);
            dropdown.classList.remove('hidden');
            return;
        }

        results.forEach(co => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'w-full text-left px-4 py-3 hover:bg-pri-light border-b border-border last:border-b-0 transition-colors';

            const nameEl = document.createElement('div');
            nameEl.className = 'text-sm font-medium text-txt';
            nameEl.textContent = co.name;
            row.appendChild(nameEl);

            const meta = [];
            if (co.domain) meta.push(co.domain);
            if (co.contact) meta.push(co.contact.name);
            if (co.deals.length > 0) meta.push(co.deals.length + ' deal' + (co.deals.length > 1 ? 's' : ''));

            if (meta.length > 0) {
                const metaEl = document.createElement('div');
                metaEl.className = 'text-xs text-txt-muted mt-0.5';
                metaEl.textContent = meta.join(' · ');
                row.appendChild(metaEl);
            }

            row.addEventListener('click', () => hsSelectCompany(co));
            dropdown.appendChild(row);
        });
        dropdown.classList.remove('hidden');
    } catch (e) {
        console.warn('HubSpot search failed:', e.message);
        dropdown.classList.add('hidden');
    }
}

function hsSelectCompany(co) {
    document.getElementById('hs-search-dropdown').classList.add('hidden');

    // Fill company fields
    document.getElementById('company_name').value = co.name || '';
    if (co.address) document.getElementById('company_address').value = co.address;

    // Fill contact/rep fields from associated contact
    if (co.contact) {
        if (co.contact.name) document.getElementById('representative_name').value = co.contact.name;
        if (co.contact.email) document.getElementById('representative_email').value = co.contact.email;
        if (co.contact.phone) document.getElementById('representative_phone').value = co.contact.phone;
    }

    // Link to first deal in Sales Pipeline if available
    if (co.deals.length > 0) {
        document.getElementById('hubspot_deal_id').value = co.deals[0].id;
    }

    // Store company ID for deal association on push
    hsCompanyId = co.id;
    document.getElementById('hubspot_company_id').value = co.id;

    // Show linked badge
    const badge = document.getElementById('hs-linked-badge');
    const text = document.getElementById('hs-linked-text');
    if (badge) {
        badge.classList.remove('hidden');
        const parts = ['Linked: ' + co.name];
        if (co.deals.length > 0) parts.push('Deal #' + co.deals[0].id);
        text.textContent = parts.join(' · ');
    }

    toast('Loaded from HubSpot: ' + co.name);
}

// ---- HubSpot Contact Search ----

let _hsContactSearchTimer = null;

function initHubSpotContactSearch() {
    const input = document.getElementById('representative_name');
    const dropdown = document.getElementById('hs-contact-search-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(_hsContactSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) { dropdown.classList.add('hidden'); return; }
        _hsContactSearchTimer = setTimeout(() => hsContactSearch(q), 350);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

async function hsContactSearch(query) {
    const dropdown = document.getElementById('hs-contact-search-dropdown');
    try {
        const resp = await fetch(`/api/hubspot-deal?contact=${encodeURIComponent(query)}`);
        if (!resp.ok) { dropdown.classList.add('hidden'); return; }
        const data = await resp.json();
        const results = data.results || [];

        dropdown.replaceChildren();

        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'px-4 py-3 text-sm text-txt-muted';
            empty.textContent = 'No matches in HubSpot';
            dropdown.appendChild(empty);
            dropdown.classList.remove('hidden');
            return;
        }

        results.forEach(c => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'w-full text-left px-4 py-3 hover:bg-pri-light border-b border-border last:border-b-0 transition-colors';

            const nameEl = document.createElement('div');
            nameEl.className = 'text-sm font-medium text-txt';
            nameEl.textContent = c.name;
            row.appendChild(nameEl);

            const meta = [];
            if (c.email) meta.push(c.email);
            if (c.jobtitle) meta.push(c.jobtitle);
            if (c.company) meta.push(c.company.name);

            if (meta.length > 0) {
                const metaEl = document.createElement('div');
                metaEl.className = 'text-xs text-txt-muted mt-0.5';
                metaEl.textContent = meta.join(' · ');
                row.appendChild(metaEl);
            }

            row.addEventListener('click', () => hsSelectContact(c));
            dropdown.appendChild(row);
        });
        dropdown.classList.remove('hidden');
    } catch (e) {
        console.warn('HubSpot contact search failed:', e.message);
        dropdown.classList.add('hidden');
    }
}

function hsSelectContact(c) {
    document.getElementById('hs-contact-search-dropdown').classList.add('hidden');

    document.getElementById('representative_name').value = c.name || '';
    if (c.email) document.getElementById('representative_email').value = c.email;
    if (c.phone) document.getElementById('representative_phone').value = c.phone;
    document.getElementById('hubspot_contact_id').value = c.id;

    const badge = document.getElementById('hs-contact-linked-badge');
    const badgeText = document.getElementById('hs-contact-linked-text');
    if (badge) badge.classList.remove('hidden');
    if (badgeText) badgeText.textContent = `Linked to HubSpot contact #${c.id}`;

    // If no company is bound yet and the contact has one, auto-bind it
    if (c.company && !hsCompanyId && !document.getElementById('hubspot_company_id').value) {
        hsCompanyId = c.company.id;
        document.getElementById('company_name').value = c.company.name || '';
        if (c.company.address) document.getElementById('company_address').value = c.company.address;
        document.getElementById('hubspot_company_id').value = c.company.id;
        const coBadge = document.getElementById('hs-linked-badge');
        const coBadgeText = document.getElementById('hs-linked-text');
        if (coBadge) coBadge.classList.remove('hidden');
        if (coBadgeText) coBadgeText.textContent = `Linked to HubSpot #${c.company.id}`;
        toast(`Loaded contact + company: ${c.name} @ ${c.company.name}`);
    } else {
        toast('Loaded contact: ' + c.name);
    }
}

// ---- HTML Escaping ----

const _escDiv = document.createElement('div');
function esc(str) {
    if (!str) return '';
    _escDiv.textContent = str;
    return _escDiv.innerHTML;
}

// ---- Safe DOM Builders ----

function createAccountCard(a) {
    const statusColors = {
        draft: 'bg-yellow-100 text-yellow-800',
        sent: 'bg-blue-100 text-blue-800',
        viewed: 'bg-purple-100 text-purple-800',
        signed: 'bg-green-100 text-green-800',
    };
    const stepLabels = {
        company: 'Step 1', contract: 'Step 2', travelers: 'Step 3',
        review: 'Step 4', complete: 'Done',
    };
    const color = statusColors[a.contract_status] || 'bg-gray-100 text-gray-800';
    const step = stepLabels[a.wizard_step] || a.wizard_step;
    const date = new Date(a.created_at * 1000).toLocaleDateString();

    const btn = document.createElement('button');
    btn.className = 'w-full flex items-center justify-between bg-white border border-border rounded-lg p-4 hover:border-pri transition-colors text-left';
    btn.addEventListener('click', () => loadAccount(a.id));

    const left = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-medium text-txt';
    nameSpan.textContent = a.company_name;
    const repSpan = document.createElement('span');
    repSpan.className = 'text-txt-muted text-sm ml-2';
    repSpan.textContent = a.representative_name;
    left.append(nameSpan, repSpan);

    const right = document.createElement('div');
    right.className = 'flex items-center gap-3';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'text-xs text-txt-muted';
    dateSpan.textContent = date;
    const statusSpan = document.createElement('span');
    statusSpan.className = `px-2 py-0.5 rounded text-xs font-semibold ${color}`;
    statusSpan.textContent = a.contract_status;
    const stepSpan = document.createElement('span');
    stepSpan.className = 'text-xs text-txt-secondary';
    stepSpan.textContent = step;
    right.append(dateSpan, statusSpan, stepSpan);

    btn.append(left, right);
    return btn;
}

function createTravelerRow(t) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between bg-surface-alt rounded-lg p-3.5 border border-border';
    const left = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-medium text-txt text-sm';
    nameSpan.textContent = t.name;
    left.appendChild(nameSpan);
    if (t.is_representative) { const rep = document.createElement('span'); rep.className = 'ml-2 text-xs text-pri font-semibold'; rep.textContent = 'REP'; left.appendChild(rep); }
    if (t.email) { const email = document.createElement('span'); email.className = 'text-txt-muted text-xs ml-2'; email.textContent = t.email; left.appendChild(email); }
    if (t.phone) { const phone = document.createElement('span'); phone.className = 'text-txt-muted text-xs ml-2'; phone.textContent = t.phone; left.appendChild(phone); }
    const right = document.createElement('div');
    right.className = 'flex items-center gap-2';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'text-red-400 hover:text-red-600 text-sm px-2';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeTraveler(t.id));
    right.appendChild(removeBtn);
    row.append(left, right);
    return row;
}

// ---- Account Picker ----

async function loadAccounts() {
    try {
        const accounts = await api('GET', '/accounts');
        const list = document.getElementById('accounts-list');
        const noMsg = document.getElementById('no-accounts');
        list.replaceChildren();
        if (accounts.length === 0) { noMsg.classList.remove('hidden'); return; }
        noMsg.classList.add('hidden');
        accounts.forEach(a => list.appendChild(createAccountCard(a)));
    } catch (e) { toast('Failed to load accounts: ' + e.message); }
}

async function loadAccount(id) {
    try {
        account = await api('GET', `/accounts/${id}`);
        travelers = account.travelers || [];
        populateCompanyForm();
        populatePricingForm();
        populateContractForm();
        renderTravelers();
        const stepMap = { company: 0, pricing: 1, contract: 2, travelers: 3, review: 4, complete: 4 };
        goToStep(stepMap[account.wizard_step] || 0);
    } catch (e) { toast('Failed to load account: ' + e.message); }
}

function showNewAccountForm() { account = null; travelers = []; clearCompanyForm(); goToStep(0); }

// ---- Step Navigation ----

function goToStep(n) {
    const picker = document.getElementById('account-picker');
    const complete = document.getElementById('complete-screen');
    if (n === -1) { picker.classList.remove('hidden'); complete.classList.add('hidden'); document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active')); currentStep = -1; loadAccounts(); return; }
    if (n > 0 && !account) { toast('Save company info first'); return; }
    picker.classList.add('hidden'); complete.classList.add('hidden'); currentStep = n;
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    const panel = document.querySelector(`[data-panel="${n}"]`);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.step-dot').forEach(dot => { const s = parseInt(dot.dataset.step); dot.classList.remove('active', 'done', 'pending'); dot.classList.add(s < n ? 'done' : s === n ? 'active' : 'pending'); });
    document.querySelectorAll('.step-label').forEach(lbl => { const s = parseInt(lbl.dataset.steplabel); lbl.classList.remove('active', 'done', 'pending'); lbl.classList.add(s < n ? 'done' : s === n ? 'active' : 'pending'); });
    document.querySelectorAll('.step-line').forEach(line => { const s = parseInt(line.dataset.line); line.classList.remove('done', 'pending'); line.classList.add(s < n ? 'done' : 'pending'); });
    if (n === 1) { requestAnimationFrame(() => { pricingRecalculate(); if (pWaterfallChart) pWaterfallChart.resize(); if (pMarginChart) pMarginChart.resize(); }); }
    if (n === 2) updateContractSummary();
    if (n === 3) renderTravelers();
    if (n === 4) renderReview();
}

// ---- Step 0: Company ----

function clearCompanyForm() {
    ['company_name', 'company_address', 'representative_name', 'representative_email', 'representative_phone', 'hubspot_deal_id', 'created_by'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('employee_count').value = '3';
    document.getElementById('account_notes').value = '';
    document.getElementById('hubspot_company_id').value = '';
    hsCompanyId = null;
    const badge = document.getElementById('hs-linked-badge');
    if (badge) badge.classList.add('hidden');
}

function populateCompanyForm() {
    if (!account) return;
    const fields = { company_name: account.company_name, company_address: account.company_address, representative_name: account.representative_name, representative_email: account.representative_email, representative_phone: account.representative_phone, employee_count: account.employee_count, hubspot_deal_id: account.hubspot_deal_id, created_by: account.created_by, account_notes: account.notes };
    for (const [id, v] of Object.entries(fields)) { const el = document.getElementById(id); if (el && v != null) el.value = v; }
}

async function saveCompany() {
    const data = { company_name: val('company_name'), company_address: val('company_address'), representative_name: val('representative_name'), representative_email: val('representative_email'), representative_phone: val('representative_phone'), employee_count: parseInt(val('employee_count')) || 3, hubspot_deal_id: val('hubspot_deal_id') || null, hubspot_company_id: val('hubspot_company_id') || hsCompanyId || null, hubspot_contact_id: val('hubspot_contact_id') || null, created_by: val('created_by') || null, notes: val('account_notes') || null };
    if (!data.company_name || !data.representative_name) { toast('Company name and representative name are required'); return; }
    try {
        if (account) { account = await api('PATCH', `/accounts/${account.id}`, data); } else { account = await api('POST', '/accounts', data); }
        travelers = account.travelers || [];
        toast('Company info saved');
        goToStep(1);
    } catch (e) { toast('Error: ' + e.message); }
}

// ---- Populate Pricing from Account ----

function populatePricingForm() {
    if (!account) return;
    if (account.pricing_impl_fee) document.getElementById('p_implementation_fee').value = account.pricing_impl_fee;
    if (account.pricing_num_users) document.getElementById('p_num_users').value = account.pricing_num_users;
    pricingUpdateBasePrice();
}

// ---- Step 2: Contract ----

function populateContractForm() {
    if (!account) return;
    if (account.effective_date) document.getElementById('effective_date').value = account.effective_date;
    if (account.billing_method) document.getElementById('billing_method').value = account.billing_method;
    if (account.implementation_fee) document.getElementById('implementation_fee').value = account.implementation_fee;
    if (account.monthly_fee) document.getElementById('monthly_fee').value = account.monthly_fee;
    updateContractBadge();
}

function updateContractSummary() {
    if (!account) return;
    const fee = val('implementation_fee') || '2500'; const monthly = val('monthly_fee') || '300';
    const employees = account.employee_count || 3;
    const billing = val('billing_method');
    const billingText = billing === 'retainer' ? 'Monthly Retainer ($10,000 balance)' : billing === 'payasyougo' ? 'Pay-as-You-Go (credit card)' : 'Not selected';
    const date = val('effective_date') || 'TBD';
    const summaryEl = document.getElementById('summary-text');
    summaryEl.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = account.company_name; summaryEl.appendChild(strong);
    summaryEl.append(` \u2014 Effective ${date}`, document.createElement('br'), `Implementation: $${Number(fee).toLocaleString()} | Monthly: $${Number(monthly).toLocaleString()}/mo | ${employees} employee(s)`, document.createElement('br'), `Billing: ${billingText}`);
    if (pCalcResult.recommendedPrice) { summaryEl.append(document.createElement('br'), `Annual Subscription: $${pfmt(pCalcResult.recommendedPrice)} (from pricing)`); }
}

function updateContractBadge() {
    if (!account) return;
    const badge = document.getElementById('contract-badge');
    const status = account.contract_status || 'draft';
    const colors = { draft: 'bg-yellow-50 text-yellow-700', sent: 'bg-blue-50 text-blue-700', viewed: 'bg-pri-light text-pri', signed: 'bg-green-50 text-green-700' };
    badge.className = `px-3 py-1 rounded-full text-xs font-semibold ${colors[status] || 'bg-gray-100 text-gray-600'}`;
    badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

async function sendContract() {
    // Now opens the signature modal instead of DocuSign
    openSignatureModal();
}

async function saveContractFields() {
    if (!account) return;
    account = await api('PATCH', `/accounts/${account.id}`, { effective_date: val('effective_date') || null, billing_method: val('billing_method') || null, implementation_fee: parseFloat(val('implementation_fee')) || 2500, monthly_fee: parseFloat(val('monthly_fee')) || 300, wizard_step: 'contract' });
}

async function saveContractAndContinue() {
    try { await saveContractFields(); toast('Contract details saved'); goToStep(3); } catch (e) { toast('Error: ' + e.message); }
}

// ---- Step 2: Travelers ----

function renderTravelers() {
    const list = document.getElementById('traveler-list'); list.replaceChildren();
    if (travelers.length === 0) { const p = document.createElement('p'); p.className = 'text-sm text-txt-muted'; p.textContent = 'No travelers added yet.'; list.appendChild(p); return; }
    travelers.forEach(t => list.appendChild(createTravelerRow(t)));
}

async function addTraveler() {
    const name = val('new_traveler_name');
    if (!name) { toast('Traveler name is required'); return; }
    try {
        const traveler = await api('POST', `/accounts/${account.id}/travelers`, { name, email: val('new_traveler_email') || null, phone: val('new_traveler_phone') || null, is_representative: document.getElementById('new_traveler_rep').checked });
        travelers.push(traveler); renderTravelers();
        document.getElementById('new_traveler_name').value = ''; document.getElementById('new_traveler_email').value = ''; document.getElementById('new_traveler_phone').value = ''; document.getElementById('new_traveler_rep').checked = false;
        toast(`Added ${name}`);
    } catch (e) { toast('Error: ' + e.message); }
}

async function removeTraveler(id) {
    try { await api('DELETE', `/accounts/${account.id}/travelers/${id}`); travelers = travelers.filter(t => t.id !== id); renderTravelers(); toast('Traveler removed'); } catch (e) { toast('Error: ' + e.message); }
}

// ---- Step 3: Review & Send ----

function renderReview() {
    if (!account) return;
    const container = document.getElementById('review-content'); container.replaceChildren();
    container.appendChild(makeReviewSection('Company', 0, [['Company', account.company_name], ['Address', account.company_address], ['Representative', account.representative_name], ['Email', account.representative_email], ['Phone', account.representative_phone], ['Employees', account.employee_count]]));
    // Pricing summary
    const pricingRows = [['Recommended Price', pCalcResult.recommendedPrice ? `$${pfmt(pCalcResult.recommendedPrice)}/yr` : 'Not calculated'], ['Total Discount', pCalcResult.totalDiscount ? (pCalcResult.totalDiscount * 100).toFixed(1) + '%' : '0%'], ['Deal Health', pCalcResult.healthLabel || 'N/A'], ['Implementation Fee', account.pricing_impl_fee ? `$${pfmt(account.pricing_impl_fee)}` : null], ['Trans. Margin', pCalcResult.projectedTransMargin ? `$${pfmt(pCalcResult.projectedTransMargin)}` : null]];
    container.appendChild(makeReviewSection('Pricing', 1, pricingRows));
    const billingLabels = { retainer: 'Monthly Retainer', payasyougo: 'Pay-as-You-Go' };
    container.appendChild(makeReviewSection('Contract Terms', 2, [['Effective Date', account.effective_date], ['Implementation Fee', account.implementation_fee ? `$${Number(account.implementation_fee).toLocaleString()}` : null], ['Monthly Fee', account.monthly_fee ? `$${Number(account.monthly_fee).toLocaleString()}/mo` : null], ['Billing Method', billingLabels[account.billing_method] || account.billing_method]]));
    const travelerLines = travelers.length > 0 ? travelers.map(t => { let line = t.name; if (t.is_representative) line += ' (REP)'; if (t.email) line += ` \u2014 ${t.email}`; return ['', line]; }) : [['', 'No travelers added']];
    container.appendChild(makeReviewSection(`Travelers (${travelers.length})`, 3, travelerLines));
    updateReviewBadge();
}

function makeReviewSection(title, editStep, rows) {
    const section = document.createElement('div'); section.className = 'border border-border rounded-lg p-5 hover:border-pri/30 transition-colors';
    const header = document.createElement('button'); header.className = 'flex items-center justify-between w-full mb-3'; header.addEventListener('click', () => goToStep(editStep));
    const h3 = document.createElement('h3'); h3.className = 'text-sm font-semibold text-txt'; h3.textContent = title;
    const editLink = document.createElement('span'); editLink.className = 'text-xs font-medium text-pri hover:underline'; editLink.textContent = 'Edit';
    header.append(h3, editLink); section.appendChild(header);
    const grid = document.createElement('div'); grid.className = 'grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm';
    rows.forEach(([label, value]) => {
        if (!value && value !== 0) return;
        if (label) { const l = document.createElement('span'); l.className = 'text-txt-muted'; l.textContent = label; grid.appendChild(l); const v = document.createElement('span'); v.className = 'text-txt'; v.textContent = String(value); grid.appendChild(v); }
        else { const f = document.createElement('span'); f.className = 'col-span-2 text-txt'; f.textContent = String(value); grid.appendChild(f); }
    });
    section.appendChild(grid); return section;
}

function updateReviewBadge() {
    const badge = document.getElementById('review-contract-badge'); if (!badge || !account) return;
    const status = account.contract_status || 'draft';
    const colors = { draft: 'bg-yellow-50 text-yellow-700', sent: 'bg-blue-50 text-blue-700', viewed: 'bg-pri-light text-pri', signed: 'bg-green-50 text-green-700' };
    badge.className = `px-3 py-1 rounded-full text-xs font-semibold ${colors[status] || 'bg-gray-100 text-gray-600'}`;
    badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// ---- Agreement Preview ----

function openAgreementPreview() {
    if (!account) return;
    const body = document.getElementById('agreement-body'); body.replaceChildren();
    renderAgreementDocument(body);
    document.getElementById('agreement-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeAgreementPreview() {
    document.getElementById('agreement-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

function renderAgreementDocument(container) {
    const a = account;
    const implFee = Number(a.implementation_fee || 2500).toLocaleString();
    const monthlyFee = Number(a.monthly_fee || 300).toLocaleString();
    const employees = a.employee_count || 3;
    const repName = a.representative_name || '___________';
    const companyName = a.company_name || '___________';
    const companyAddr = a.company_address || '___________';

    function fmtDate(dateStr) { if (!dateStr) return '___________'; const d = new Date(dateStr + 'T12:00:00'); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }

    const title = _el('h1', 'text-xl font-bold text-center mb-6 tracking-tight', 'ASCEND SERVICES AGREEMENT');

    const preamble = document.createElement('p'); preamble.className = 'mb-6';
    preamble.append(
        'THIS SERVICES AGREEMENT (which, including any attachments and exhibits hereto shall be known as the \u201c',
        _el('strong', '', 'Agreement'),
        '\u201d) is entered into as of ',
        _el('strong', 'underline', fmtDate(a.effective_date)),
        ' (the \u201c',
        _el('strong', '', 'Effective Date'),
        '\u201d) by and between EasyPoint, Inc. DBA Ascend, a Delaware corporation (hereafter \u201c',
        _el('strong', '', 'Ascend'),
        '\u201d), and ',
        _el('strong', 'underline', companyName),
        ', an entity located at ',
        _el('strong', 'underline', companyAddr),
        ' (hereafter \u201c',
        _el('strong', '', 'Customer'),
        '\u201d). Ascend and Customer are individually referred to herein as a \u201c',
        _el('strong', '', 'party'),
        '\u201d and collectively as the \u201c',
        _el('strong', '', 'parties'),
        '\u201d. The parties hereby agree as follows:'
    );
    container.append(title, preamble);

    // Verbatim sections from the Ascend Services Agreement
    const sections = [
        {
            title: 'SERVICES',
            text: 'Ascend agrees to provide to Customer the services outlined here: https://www.joinascend.com/#ac-pricing (collectively the \u201cServices\u201d).'
        },
        {
            title: 'FEES',
            parts: [
                'Customer shall incur a one-time implementation fee of ',
                { bold: true, text: `two thousand five hundred dollars ($${implFee}.00 USD)` },
                ' and a monthly recurring service fee of ',
                { bold: true, text: `three hundred dollars ($${monthlyFee} USD)` },
                '. This fee provides access to one year of Services, beginning on the Effective Date, for ',
                { bold: true, text: `${employees} Customer employee${employees > 1 ? 's' : ''}` },
                '.'
            ]
        },
        {
            title: 'BOOKINGS & PAYMENT',
            text: 'Customer may choose between two billing methods:\n\nOption 1: Monthly Retainer. Customer may maintain a retainer account with Ascend. If selected, the Customer shall replenish the retainer to a balance of ten thousand dollars ($10,000 USD) by the 5th of each month, reflecting amounts applied toward bookings and service fees during the preceding month. This allows for consolidated monthly invoicing and charges. A 1.5% discount applies if payment is made via same-day ACH or wire transfer.\n\nOption 2: Pay-as-You-Go. If the Customer elects not to maintain a retainer, each booking will be charged in real-time to the credit card on file at the time of booking. No monthly replenishment is required under this model.\n\nAscend shall maintain a valid credit card on file for all Customers, to be used either as the primary method under Option 2, or as a backup if ACH or wire payment fails under Option 1. Ascend will not make or confirm any bookings unless sufficient funds are available either in the retainer or via the payment method on file.\n\nEach booking will be invoiced individually and deducted either from the retainer or charged directly, depending on the Customer\u2019s selected billing method. There are no prepayment obligations beyond maintaining the retainer if Option 1 is selected.',
            highlight: true
        },
        {
            title: 'COMMUNICATIONS',
            parts: [
                'The approval of the designated Customer Representative (\u201c',
                { bold: true, text: 'Representative' },
                '\u201d) is required for Ascend to make any flight booking. The initial Representative under this Agreement is ',
                { bold: true, text: repName },
                ' and Ascend may designate a new Representative by providing written notice to Customer. The Representative may also authorize certain Customer employees to book flights without requiring prior approval. The primary communication channel between Ascend and Customer will be WhatsApp, unless otherwise agreed in writing by the Representative.'
            ]
        },
        {
            title: 'RELATIONSHIP BETWEEN THE PARTIES',
            text: 'The parties will be acting as independent contractors vis-\u00e0-vis each other, and nothing shall be construed to imply or construe any other relationship including without limitation employment, a partnership, or a joint-venture. Except as expressly stated herein, or as required for Ascend to render the Services, neither party shall have the authority to bind the other.'
        },
        {
            title: 'TERM & TERMINATION',
            text: 'This Agreement will commence on the Effective Date and will continue until terminated. Either party may terminate this Agreement by providing the other party no less than thirty (30) days\u2019 written notice of its decision to terminate. Termination shall not relieve either party of its obligation to pay the other party any amounts owed, and each party shall pay to the other all amounts it owes no later than ten (10) days from the date of termination.'
        },
        {
            title: 'CONFIDENTIAL INFORMATION; IP',
            text: 'Confidential Information is defined as \u201call proprietary and confidential information unique to each party, and/or its business, including without limitation data, pricing information, business practices, and the terms of this Agreement.\u201d Each party (the \u201cReceiving Party\u201d) shall keep confidential and protect the Confidential Information of the other party (the \u201cDisclosing Party\u201d) with at least the degree of care it uses to protect its own sensitive or proprietary information and in no event less than a reasonable degree of care. Nothing in this Agreement shall act as or be interpreted as a transfer of intellectual property by one party to the other.'
        },
        {
            title: 'ASCEND TERMS',
            text: 'Without limiting the applicability of anything else herein, by signing this Agreement and/or by receiving the Services, Customer affirms that it, its employees, and any other entity that uses the Services on its behalf or with its permission, is bound by and agrees to be bound by Ascend\u2019s Terms of Service (https://www.joinascend.com/terms-of-service), Privacy Policy (https://www.joinascend.com/privacy-policy), and Change and Cancellation Policy (https://fly-flat.com/change-cancellation-policy/).'
        },
        {
            title: 'LIMITATION OF LIABILITY',
            text: 'EXCEPT AS REGARDS EITHER PARTY\u2019S INDEMNIFICATION OBLIGATIONS HEREIN, IN NO EVENT WILL EITHER PARTY (OR THAT PARTY\u2019S OWNERS, DIRECTORS, OFFICERS, EMPLOYEES, AFFILIATES, AGENTS, CONTRACTORS, OR SUBCONTRACTORS) BE LIABLE TO THE OTHER PARTY FOR ANY SPECIAL, INCIDENTAL, INDIRECT, PUNITIVE, EXEMPLARY, OR CONSEQUENTIAL DAMAGES OR LOSS OF PROFITS, DATA, BUSINESS, OR GOODWILL WHETHER ARISING OUT OF BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, REGARDLESS OF WHETHER SUCH DAMAGE WAS FORESEEABLE AND WHETHER OR NOT SUCH PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. IN NO EVENT WILL EITHER PARTY\u2019S LIABILITY TO THE OTHER UNDER THIS AGREEMENT EXCEED THE TOTAL AMOUNT OF FEES PAID BY CUSTOMER IN THE 12 MONTHS PRIOR TO THE CLAIM.'
        },
        {
            title: 'INDEMNIFICATION',
            text: 'Upon the moving party\u2019s request (the \u201cMoving Party\u201d), the non-moving party (the \u201cNon-Moving Party\u201d) will indemnify, hold harmless, and defend the Moving Party and its affiliates and each of their directors, owners, officers, employees, and agents from and against any and all claims, harms, fines, fees, damages, losses, and expenses (including attorneys\u2019 fees) arising out of or resulting from any third-party claim, suit, action, or other proceeding that alleges or is based upon either of the follow by the Non-Moving Party: (i) any violation of this Agreement; or (ii) any violation of any law, rule, or regulation.'
        },
        {
            title: 'NON-DISPARAGEMENT',
            text: 'While this Agreement is in effect, and for a period of twelve (12) months after termination of this Agreement, neither party shall make statements or representations, or otherwise communicate, directly or indirectly, in writing, orally, or otherwise, or take any action which may, directly or indirectly, disparage the other party or any of its subsidiaries or affiliates or their respective officers, owners, directors, employees, advisors, businesses, or reputations. Notwithstanding the foregoing, nothing in this Agreement shall preclude either party from making truthful statements that are required by applicable law, regulation, or legal process.'
        },
        {
            title: 'FORCE MAJEURE',
            text: 'Notwithstanding anything to the contrary contained herein, neither party shall be liable to the other for any delays or failures in performance resulting from acts beyond its reasonable control, except for the obligation to pay any amounts owed hereunder.'
        },
        {
            title: 'MARKETING RIGHTS',
            text: 'Customer grants Ascend the right to use Customer\u2019s name and logo in its marketing and promotional materials, including on its website, investor presentations, pitch decks, customer lists, and case studies. Ascend may also publicly identify Customer as a client in written and oral communications. Any use of Customer\u2019s logo shall comply with any written brand guidelines provided by Customer. These rights are non-exclusive, worldwide, royalty-free, and shall survive termination of this Agreement.'
        },
        {
            title: 'MISCELLANEOUS PROVISIONS',
            text: 'This Agreement is the entire agreement of the parties and supersedes any prior agreements between them, whether written or oral, with respect to the subject matter hereof. No waiver, alteration, or modification of any of the provisions of this Agreement shall be binding unless in writing and signed by duly authorized representatives of the parties hereto. Each party agrees that if any provision of this Agreement is held to be illegal, invalid or unenforceable, such provision shall be enforced to the maximum extent permissible so as to give effect to the intent of the parties, and such provision shall otherwise be severed from this Agreement and the validity, legality and enforceability of the remaining provisions of this Agreement will not in any way be affected or impaired. Neither party may assign this Agreement or any of its rights or obligations under this Agreement without the prior written consent of the other party; provided that either party may assign this Agreement pursuant to a change of control including without limitation a merger, acquisition or sale of all or substantially all of such party\u2019s assets. Any notice shall be addressed to the party being notified at the address set forth in this Agreement or such other address as either party may notify the other of and shall be deemed given upon delivery if personally delivered or transmitted via facsimile or email, or reliable and recognized international carrier service with tracking capability (such as FedEx). This Agreement is in the English language only, and the English language version shall control in all respects. This Agreement may be executed in counterparts, each of which will be deemed to be an original, but all of which taken together will constitute the same instrument. The Agreement may be executed and delivered by email, facsimile, or PDF, which will have the same force and effect as original documents with original signatures.'
        },
    ];

    const ol = document.createElement('ol'); ol.className = 'space-y-5 list-decimal pl-5';
    sections.forEach(sec => {
        const li = document.createElement('li'); li.className = 'leading-relaxed';
        const b = document.createElement('strong'); b.textContent = sec.title + '. '; li.appendChild(b);
        if (sec.parts) {
            sec.parts.forEach(part => {
                if (typeof part === 'string') li.append(part);
                else { const s = document.createElement('strong'); s.className = 'underline decoration-pri/30'; s.textContent = part.text; li.appendChild(s); }
            });
        } else if (sec.text) {
            sec.text.split('\n\n').forEach((line, i) => {
                if (i > 0) { li.appendChild(document.createElement('br')); li.appendChild(document.createElement('br')); }
                li.append(line);
            });
        }
        if (sec.highlight) {
            const box = document.createElement('div'); box.className = 'mt-3 p-3 rounded-md bg-pri-light border border-border-light text-sm';
            const icon = document.createElement('span'); icon.className = 'font-semibold text-pri'; icon.textContent = 'Selected: '; box.appendChild(icon);
            const span = document.createElement('span');
            if (a.billing_method === 'retainer') span.textContent = 'Option 1: Monthly Retainer. Customer shall replenish retainer to $10,000 balance by the 5th of each month. 1.5% discount for same-day ACH or wire.';
            else if (a.billing_method === 'payasyougo') span.textContent = 'Option 2: Pay-as-You-Go. Each booking charged in real-time to credit card on file. No monthly replenishment required.';
            else { span.className = 'italic text-txt-muted'; span.textContent = 'Billing method not yet selected.'; }
            box.appendChild(span); li.appendChild(box);
        }
        ol.appendChild(li);
    });
    container.appendChild(ol);

    // Signature block
    const sigBlock = document.createElement('div'); sigBlock.className = 'mt-10 pt-6 border-t border-border';
    const sigIntro = document.createElement('p'); sigIntro.className = 'text-sm text-txt-secondary italic mb-8';
    sigIntro.textContent = 'IN WITNESS WHEREOF, the parties hereto have executed this Agreement as of the Effective Date.';
    sigBlock.appendChild(sigIntro);

    const sigGrid = document.createElement('div'); sigGrid.className = 'grid grid-cols-2 gap-12';

    // Ascend side (pre-filled)
    const ascendSig = document.createElement('div'); ascendSig.className = 'space-y-4';
    const ascendH = document.createElement('p'); ascendH.className = 'font-bold text-sm'; ascendH.textContent = 'Ascend'; ascendSig.appendChild(ascendH);
    ['Signature: Zachary Resnick', 'Print Name: Zachary Resnick', 'Title: CEO', `Date: ${new Date().toLocaleDateString()}`].forEach(line => {
        const p = document.createElement('p'); p.className = 'text-sm text-txt-secondary'; p.textContent = line; ascendSig.appendChild(p);
    });

    // Customer side — show saved signature or placeholder
    const custSig = document.createElement('div'); custSig.className = 'space-y-4';
    const custH = document.createElement('p'); custH.className = 'font-bold text-sm underline'; custH.textContent = companyName; custSig.appendChild(custH);

    if (a.signature_data) {
        const sigLabel = _el('p', 'text-sm text-txt-muted', 'Signature:');
        custSig.appendChild(sigLabel);
        const sigImg = document.createElement('img');
        sigImg.src = a.signature_data;
        sigImg.className = 'h-16 mt-1';
        sigImg.alt = 'Signature';
        custSig.appendChild(sigImg);
        custSig.appendChild(_el('p', 'text-sm text-txt-secondary', `Print Name: ${a.signer_name || '___________________'}`));
        custSig.appendChild(_el('p', 'text-sm text-txt-secondary', `Title: ${a.signer_title || '___________________'}`));
        custSig.appendChild(_el('p', 'text-sm text-txt-secondary', `Date: ${a.signed_at ? new Date(a.signed_at).toLocaleDateString() : '___________________'}`));
    } else {
        ['Signature: ___________________', 'Print Name: ___________________', 'Title: ___________________', 'Date: ___________________'].forEach(line => {
            const p = document.createElement('p'); p.className = 'text-sm text-txt-secondary'; p.textContent = line; custSig.appendChild(p);
        });
    }

    sigGrid.append(ascendSig, custSig); sigBlock.appendChild(sigGrid); container.appendChild(sigBlock);
}

function _el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; }

// ---- Signature Capture ----

let sigCanvas = null;
let sigCtx = null;
let sigDrawing = false;

function openSignatureModal() {
    if (!account) return;
    document.getElementById('sig-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('sig-signer-name').value = account.representative_name || '';
    document.getElementById('sig-signer-title').value = '';
    initSignatureCanvas();
}

function closeSignatureModal() {
    document.getElementById('sig-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

function initSignatureCanvas() {
    sigCanvas = document.getElementById('sig-canvas');
    sigCtx = sigCanvas.getContext('2d');
    const rect = sigCanvas.parentElement.getBoundingClientRect();
    sigCanvas.width = rect.width;
    sigCanvas.height = 160;
    sigCtx.strokeStyle = '#1a1a2e';
    sigCtx.lineWidth = 2.5;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    clearSignature();

    // Mouse events
    sigCanvas.addEventListener('mousedown', sigStart);
    sigCanvas.addEventListener('mousemove', sigMove);
    sigCanvas.addEventListener('mouseup', sigEnd);
    sigCanvas.addEventListener('mouseleave', sigEnd);

    // Touch events
    sigCanvas.addEventListener('touchstart', sigTouchStart, { passive: false });
    sigCanvas.addEventListener('touchmove', sigTouchMove, { passive: false });
    sigCanvas.addEventListener('touchend', sigEnd);
}

function sigStart(e) {
    sigDrawing = true;
    sigCtx.beginPath();
    sigCtx.moveTo(e.offsetX, e.offsetY);
}

function sigMove(e) {
    if (!sigDrawing) return;
    sigCtx.lineTo(e.offsetX, e.offsetY);
    sigCtx.stroke();
}

function sigEnd() {
    sigDrawing = false;
}

function sigTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = sigCanvas.getBoundingClientRect();
    sigDrawing = true;
    sigCtx.beginPath();
    sigCtx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
}

function sigTouchMove(e) {
    e.preventDefault();
    if (!sigDrawing) return;
    const touch = e.touches[0];
    const rect = sigCanvas.getBoundingClientRect();
    sigCtx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    sigCtx.stroke();
}

function clearSignature() {
    if (!sigCtx) return;
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    // Draw baseline
    sigCtx.save();
    sigCtx.strokeStyle = '#e8e8e8';
    sigCtx.lineWidth = 1;
    sigCtx.setLineDash([4, 4]);
    sigCtx.beginPath();
    sigCtx.moveTo(20, sigCanvas.height - 30);
    sigCtx.lineTo(sigCanvas.width - 20, sigCanvas.height - 30);
    sigCtx.stroke();
    sigCtx.restore();
    sigCtx.strokeStyle = '#1a1a2e';
    sigCtx.lineWidth = 2.5;
    sigCtx.setLineDash([]);
}

function isCanvasBlank() {
    const data = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return false;
    }
    return true;
}

async function confirmSignature() {
    const name = document.getElementById('sig-signer-name').value.trim();
    const title = document.getElementById('sig-signer-title').value.trim();
    if (!name) { toast('Signer name is required'); return; }
    if (!title) { toast('Signer title is required'); return; }

    // Check if canvas has actual ink (ignore baseline)
    // Export signature area only
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sigCanvas.width;
    tempCanvas.height = sigCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(sigCanvas, 0, 0);
    // Clear baseline area to check for real strokes
    const sigData = sigCanvas.toDataURL('image/png');

    // Simple check: has user drawn anything beyond the baseline?
    if (isCanvasBlank()) {
        toast('Please draw your signature above the line');
        return;
    }

    try {
        const result = await api('POST', `/accounts/${account.id}/sign`, {
            signature_data: sigData,
            signer_name: name,
            signer_title: title
        });
        account.contract_status = 'signed';
        account.signature_data = sigData;
        account.signer_name = name;
        account.signer_title = title;
        account.signed_at = new Date().toISOString();
        updateContractBadge();
        updateReviewBadge();
        closeSignatureModal();
        toast(result.message);
        // After signing, show payment screen
        showPaymentScreen();
    } catch (e) { toast('Error saving signature: ' + e.message); }
}

// ---- Payment ----

function showPaymentScreen() {
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('account-picker').classList.add('hidden');
    document.getElementById('complete-screen').classList.add('hidden');
    document.getElementById('onboarding-options-screen').classList.add('hidden');
    document.getElementById('payment-screen').classList.remove('hidden');

    // Populate payment details
    const implFee = Number(account.implementation_fee || 2500);
    const monthlyFee = Number(account.monthly_fee || 300);
    const total = implFee + monthlyFee;
    document.getElementById('pay-impl-fee').textContent = `$${implFee.toLocaleString()}`;
    document.getElementById('pay-monthly-fee').textContent = `$${monthlyFee.toLocaleString()}`;
    document.getElementById('pay-total').textContent = `$${total.toLocaleString()}`;
    document.getElementById('pay-company').textContent = account.company_name;

    // Mark all steps done
    document.querySelectorAll('.step-dot').forEach(d => { d.classList.remove('active', 'pending'); d.classList.add('done'); });
    document.querySelectorAll('.step-label').forEach(l => { l.classList.remove('active', 'pending'); l.classList.add('done'); });
    document.querySelectorAll('.step-line').forEach(l => { l.classList.remove('pending'); l.classList.add('done'); });
}

function proceedToStripe() {
    if (!account) return;
    const implFee = Number(account.implementation_fee || 2500);
    const monthlyFee = Number(account.monthly_fee || 300);
    const total = implFee + monthlyFee;
    const successUrl = `${STRIPE_SUCCESS_URL}?payment=success&account=${account.id}`;
    const cancelUrl = `${STRIPE_SUCCESS_URL}?payment=cancelled&account=${account.id}`;
    const stripeUrl = `${STRIPE_PAYMENT_LINK}?client_reference_id=${account.id}&prefilled_email=${encodeURIComponent(account.representative_email || '')}`;
    // For sandbox testing, simulate payment immediately
    if (STRIPE_PAYMENT_LINK.includes('PLACEHOLDER')) {
        simulatePayment();
    } else {
        window.location.href = stripeUrl;
    }
}

async function simulatePayment() {
    if (!account) return;
    const implFee = Number(account.implementation_fee || 2500);
    const monthlyFee = Number(account.monthly_fee || 300);
    try {
        await api('POST', `/accounts/${account.id}/payment`, { amount: implFee + monthlyFee });
        account.payment_status = 'paid';
        account.paid_at = new Date().toISOString();
        toast('Payment recorded (sandbox mode)');
        showOnboardingOptions();
    } catch (e) { toast('Error: ' + e.message); }
}

// ---- Onboarding Options (post-payment) ----

async function showOnboardingOptions() {
    document.getElementById('payment-screen').classList.add('hidden');
    document.getElementById('onboarding-options-screen').classList.remove('hidden');
    document.getElementById('onboard-company').textContent = account.company_name;

    const aeLink = document.getElementById('onboard-ae-link');
    const aeNameEl = document.getElementById('onboard-ae-name');
    const prefill = `?name=${encodeURIComponent(account.representative_name || '')}&email=${encodeURIComponent(account.representative_email || '')}`;

    // Resolve AE from HubSpot deal owner, fall back to form AE name
    let aeName = account.created_by || 'your account executive';
    let aeCalendly = DEFAULT_AE_CALENDLY;

    if (account.hubspot_deal_id) {
        try {
            const resp = await fetch(`/api/hubspot-owner?deal_id=${account.hubspot_deal_id}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.ae_name) aeName = data.ae_name;
                if (data.calendly) aeCalendly = data.calendly;
            }
        } catch (e) {
            // HubSpot unavailable — use fallback
            console.warn('HubSpot owner lookup failed, using fallback:', e.message);
        }
    }

    // If HubSpot didn't resolve, try local AE name mapping
    if (aeCalendly === DEFAULT_AE_CALENDLY && aeName) {
        const lower = aeName.toLowerCase().trim();
        for (const [key, url] of Object.entries(AE_CALENDLY_FALLBACK)) {
            if (lower.includes(key.split(' ')[0]) || key.includes(lower.split(' ')[0])) {
                aeCalendly = url;
                break;
            }
        }
    }

    aeNameEl.textContent = aeName;
    aeLink.href = aeCalendly + prefill;
}

function chooseSelfService() {
    // Take them to the policy & preferences page
    window.location.href = `policy.html?account=${account.id}`;
}

// ---- Discovery Agent Outbound Call ----

async function startDiscoveryCall() {
    if (!account) return;
    const phone = account.representative_phone;
    if (!phone) {
        toast('No phone number on file — go back and add one');
        return;
    }

    // Show the call UI
    document.getElementById('call-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('call-status').textContent = 'Placing call...';
    document.getElementById('call-phone').textContent = phone;

    try {
        const resp = await fetch('/api/start-discovery-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone_number: phone,
                company_name: account.company_name,
                representative_name: account.representative_name,
                representative_email: account.representative_email,
                account_id: account.id,
            }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            document.getElementById('call-status').textContent = `Failed: ${data.error}`;
            return;
        }
        document.getElementById('call-status').textContent = 'Ringing — pick up your phone!';
        document.getElementById('call-pulse').classList.add('animate-pulse');
    } catch (e) {
        document.getElementById('call-status').textContent = 'Failed to connect — try again';
    }
}

function closeCallModal() {
    document.getElementById('call-modal').classList.add('hidden');
    document.getElementById('call-pulse').classList.remove('animate-pulse');
    document.body.style.overflow = '';
}

async function chooseOnboardingOption(option) {
    if (!account) return;
    account.onboarding_method = option;
    await api('PATCH', `/accounts/${account.id}`, { onboarding_method: option });
    if (option === 'self_service') {
        chooseSelfService();
    } else {
        // For scheduled calls, mark as pending and show confirmation
        await api('POST', `/accounts/${account.id}/complete`);
        document.getElementById('onboarding-options-screen').classList.add('hidden');
        document.getElementById('complete-screen').classList.remove('hidden');
        const methodLabels = { discovery_agent: 'discovery call', account_executive: 'call with your AE' };
        document.getElementById('complete-message').textContent = `${account.company_name} is all set. Check your email for your ${methodLabels[option]} confirmation.`;
    }
}

// ---- Handle Stripe redirect ----

function handlePaymentRedirect() {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const accountId = params.get('account');
    if (paymentStatus === 'success' && accountId) {
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
        // Load account and record payment
        (async () => {
            try {
                account = await api('GET', `/accounts/${accountId}`);
                travelers = account.travelers || [];
                if (account.payment_status !== 'paid') {
                    const implFee = Number(account.implementation_fee || 2500);
                    const monthlyFee = Number(account.monthly_fee || 300);
                    await api('POST', `/accounts/${accountId}/payment`, { amount: implFee + monthlyFee });
                    account.payment_status = 'paid';
                }
                showOnboardingOptions();
            } catch (e) { toast('Error loading account: ' + e.message); }
        })();
        return true;
    }
    return false;
}

// ---- Complete ----

async function completeOnboarding() {
    if (!account) return;
    try {
        const result = await api('POST', `/accounts/${account.id}/complete`);

        // Push contract data to HubSpot
        let hsSynced = false;
        try {
            const hsPayload = {
                company_name: account.company_name,
                hubspot_deal_id: account.hubspot_deal_id || null,
                hubspot_company_id: account.hubspot_company_id || hsCompanyId || null,
                effective_date: account.effective_date || null,
                billing_method: account.billing_method || null,
                implementation_fee: account.implementation_fee || account.pricing_impl_fee || 2500,
                monthly_fee: account.monthly_fee || 300,
                employee_count: account.employee_count || 3,
                traveler_count: (account.travelers || travelers || []).length,
                created_by: account.created_by || null,
            };
            const hsResp = await fetch('/api/hubspot-deal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hsPayload),
            });
            if (hsResp.ok) {
                const hsResult = await hsResp.json();
                hsSynced = true;
                // Store the deal ID back if it was newly created
                if (hsResult.deal_id && !account.hubspot_deal_id) {
                    account.hubspot_deal_id = hsResult.deal_id;
                    try { await api('PATCH', `/accounts/${account.id}`, { hubspot_deal_id: hsResult.deal_id }); } catch (_) {}
                }
            }
        } catch (hsErr) {
            console.warn('HubSpot push failed (non-fatal):', hsErr.message);
        }

        document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('account-picker').classList.add('hidden');
        document.getElementById('complete-screen').classList.remove('hidden');
        const syncMsg = hsSynced ? ' HubSpot deal synced.' : ' HubSpot sync skipped.';
        document.getElementById('complete-message').textContent = `${result.company} onboarded with ${result.travelers} traveler(s).${syncMsg}`;
        document.querySelectorAll('.step-dot').forEach(d => { d.classList.remove('active', 'pending'); d.classList.add('done'); });
        document.querySelectorAll('.step-label').forEach(l => { l.classList.remove('active', 'pending'); l.classList.add('done'); });
        document.querySelectorAll('.step-line').forEach(l => { l.classList.remove('pending'); l.classList.add('done'); });
    } catch (e) { toast('Error: ' + e.message); }
}

function resetWizard() { account = null; travelers = []; hsCompanyId = null; clearCompanyForm(); goToStep(-1); }

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function pfmt(n) { return Math.round(n).toLocaleString('en-US'); }

// ---- Pricing Engine ----

function pricingUpdateBasePrice() {
    const users = parseInt(val('p_num_users')) || 1;
    const billing = val('p_billing_cycle');
    let annualPrice;

    document.getElementById('p_custom_pricing').style.display = billing === 'custom' ? '' : 'none';

    if (billing === 'custom') {
        const cm = parseFloat(val('p_custom_monthly')) || 0;
        const ca = parseFloat(val('p_custom_annual')) || 0;
        annualPrice = cm > 0 ? cm * 12 * users : ca * users;
        document.getElementById('p_base_price_display').value = '$' + pfmt(annualPrice) + '/yr ($' + pfmt(annualPrice / 12) + '/mo)';
    } else if (billing === 'monthly') {
        annualPrice = users * P_RATE_MONTHLY * 12;
        document.getElementById('p_base_price_display').value = '$' + pfmt(annualPrice) + '/yr ($' + pfmt(users * P_RATE_MONTHLY) + '/mo)';
    } else {
        annualPrice = users * P_RATE_ANNUAL;
        document.getElementById('p_base_price_display').value = '$' + pfmt(annualPrice) + '/yr';
    }
    document.getElementById('p_base_price').value = annualPrice;
    pricingRecalculate();
}

function pricingRecalculate() {
    const basePrice = parseInt(val('p_base_price')) || 2500;

    // Discounts
    const logoRights = document.querySelector('input[name="p_logo_rights"]:checked')?.value === 'yes';
    const brandTier = val('p_brand_tier');
    const logoDiscount = logoRights ? (P_LOGO_DISCOUNTS[brandTier] || 0) : 0;
    const networkTier = val('p_network_tier');
    let networkDiscount = P_NETWORK_TIERS[networkTier] || 0;
    if (document.querySelector('input[name="p_referral_commit"]:checked')?.value === 'yes') networkDiscount += P_REFERRAL_BONUS;
    const totalDiscount = logoDiscount + networkDiscount;
    const discountAmount = basePrice * totalDiscount;
    const recommendedPrice = Math.round(basePrice - discountAmount);

    // Travel mix + margin
    const tripsYear = parseInt(val('p_trips_year')) || 0;
    const tpb = parseInt(val('p_travelers_per_booking')) || 1;
    const avgRouteValue = parseInt(val('p_avg_route_value')) || 0;
    const marginRate = parseFloat(val('p_margin_rate')) || 15;

    const mixKey = val('p_travel_mix');
    const mix = P_TRAVEL_MIX_PRESETS[mixKey] || P_TRAVEL_MIX_PRESETS.balanced;
    const weightedMarginMult = mix.economy * P_CABIN_MARGIN_MULT.economy + mix.business * P_CABIN_MARGIN_MULT.business + mix.first * P_CABIN_MARGIN_MULT.first;
    const effectiveMarginRate = (marginRate / 100) * weightedMarginMult;
    const totalFlightValue = avgRouteValue * tripsYear * tpb;
    const flightMargin = totalFlightValue * effectiveMarginRate;

    // Hotel
    const hotelNights = parseInt(val('p_hotel_nights')) || 0;
    const avgNightlyRate = parseFloat(val('p_avg_nightly_rate')) || 0;
    const hotelCommission = parseFloat(val('p_hotel_commission')) || 10;
    const hotelMargin = hotelNights * avgNightlyRate * (hotelCommission / 100);

    // Car
    const carDays = parseInt(val('p_car_days')) || 0;
    const avgDailyRental = parseFloat(val('p_avg_daily_rental')) || 0;
    const carCommission = parseFloat(val('p_car_commission')) || 8;
    const carMargin = carDays * avgDailyRental * (carCommission / 100);

    const projectedTransMargin = flightMargin + hotelMargin + carMargin;

    // Break-even (simplified — using defaults from pricing.html)
    const staffCost = 2 * 45 * tripsYear * tpb; // 2hrs @ $45/hr
    const platformCost = 200 * 12;
    const paymentCost = recommendedPrice * 0.029;
    const totalCostToServe = staffCost + platformCost + paymentCost + 500 + 300; // CAC + overhead
    let breakEvenFee = totalCostToServe - projectedTransMargin;
    if (breakEvenFee < 0) breakEvenFee = 0;
    const netMargin = recommendedPrice + projectedTransMargin - totalCostToServe;

    // Deal health
    let healthLabel, healthClass;
    if (recommendedPrice < breakEvenFee) { healthLabel = 'Below Break-Even'; healthClass = 'bg-red-50 text-red-700'; }
    else if (recommendedPrice < breakEvenFee * 1.3) { healthLabel = 'Thin Margin'; healthClass = 'bg-yellow-50 text-yellow-700'; }
    else { healthLabel = 'Healthy'; healthClass = 'bg-green-50 text-green-700'; }

    // Store
    pCalcResult = { recommendedPrice, totalDiscount, discountAmount, projectedTransMargin, flightMargin, hotelMargin, carMargin, breakEvenFee, netMargin, healthLabel, basePrice };

    // Render
    const healthEl = document.getElementById('p_deal_health');
    healthEl.className = `px-3 py-1 rounded-full text-xs font-semibold ${healthClass}`;
    healthEl.textContent = healthLabel;

    document.getElementById('p_hero_amount').textContent = '$' + pfmt(recommendedPrice) + '/yr';
    document.getElementById('p_hero_detail').textContent = 'Total discount: ' + (totalDiscount * 100).toFixed(1) + '% | Net margin: ' + (netMargin >= 0 ? '$' : '-$') + pfmt(Math.abs(netMargin));

    document.getElementById('p_stat_price').textContent = '$' + pfmt(recommendedPrice);
    document.getElementById('p_stat_breakeven').textContent = '$' + pfmt(breakEvenFee);
    document.getElementById('p_stat_margin').textContent = (netMargin >= 0 ? '$' : '-$') + pfmt(Math.abs(netMargin));
    document.getElementById('p_stat_flight').textContent = '$' + pfmt(flightMargin);
    document.getElementById('p_stat_hotel').textContent = '$' + pfmt(hotelMargin);
    document.getElementById('p_stat_car').textContent = '$' + pfmt(carMargin);
    document.getElementById('p_stat_total_trans').textContent = '$' + pfmt(projectedTransMargin);

    // Charts
    renderPricingCharts(basePrice, logoDiscount, networkDiscount, recommendedPrice, breakEvenFee, projectedTransMargin, totalCostToServe, healthLabel);
}

function renderPricingCharts(basePrice, logoDiscount, networkDiscount, recommendedPrice, breakEvenFee, projectedTransMargin, totalCostToServe, healthLabel) {
    // Waterfall
    const wfLabels = ['Base Price'];
    const wfData = [basePrice];
    const wfColors = ['#6F57FF'];
    if (logoDiscount > 0) { wfLabels.push('After Logo'); wfData.push(Math.round(basePrice * (1 - logoDiscount))); wfColors.push('#8B7AFF'); }
    if (networkDiscount > 0) { wfLabels.push('After Network'); wfData.push(Math.round(basePrice * (1 - logoDiscount - networkDiscount))); wfColors.push('#A090FF'); }
    wfLabels.push('Final');
    wfData.push(recommendedPrice);
    wfColors.push(healthLabel === 'Below Break-Even' ? '#DC2626' : healthLabel === 'Thin Margin' ? '#D97706' : '#059669');

    const wfCanvas = document.getElementById('p_waterfall_chart');
    if (!wfCanvas) return;

    if (pWaterfallChart) {
        pWaterfallChart.data.labels = wfLabels;
        pWaterfallChart.data.datasets[0].data = wfData;
        pWaterfallChart.data.datasets[0].backgroundColor = wfColors;
        pWaterfallChart.data.datasets[1].data = wfLabels.map(() => breakEvenFee);
        pWaterfallChart.update();
    } else {
        pWaterfallChart = new Chart(wfCanvas, {
            type: 'bar',
            data: { labels: wfLabels, datasets: [{ label: 'Price', data: wfData, backgroundColor: wfColors, borderRadius: 4 }, { label: 'Break-Even', data: wfLabels.map(() => breakEvenFee), type: 'line', borderColor: '#DC2626', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + pfmt(ctx.raw) } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => '$' + pfmt(v) }, grid: { color: 'rgba(128,128,128,0.15)' } } } }
        });
    }

    // Margin projection
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthlyRev = (recommendedPrice + projectedTransMargin) / 12;
    const monthlyCost = totalCostToServe / 12;
    const cumRev = [], cumCost = [];
    let rr = 0, rc = 0;
    for (let m = 0; m < 12; m++) { rr += monthlyRev; rc += monthlyCost; cumRev.push(Math.round(rr)); cumCost.push(Math.round(rc)); }

    const mCanvas = document.getElementById('p_margin_chart');
    if (!mCanvas) return;

    if (pMarginChart) {
        pMarginChart.data.datasets[0].data = cumRev;
        pMarginChart.data.datasets[1].data = cumCost;
        pMarginChart.update();
    } else {
        pMarginChart = new Chart(mCanvas, {
            type: 'line',
            data: { labels: months, datasets: [{ label: 'Revenue', data: cumRev, borderColor: '#6F57FF', backgroundColor: 'rgba(111,87,255,0.08)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 }, { label: 'Cost', data: cumCost, borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,0.06)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2, borderDash: [6, 4] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + pfmt(ctx.raw) } } }, scales: { x: { grid: { color: 'rgba(128,128,128,0.1)' } }, y: { ticks: { callback: v => '$' + pfmt(v) }, grid: { color: 'rgba(128,128,128,0.15)' } } } }
        });
    }
}

// ---- Save Pricing & Continue to Contract ----

async function savePricingAndContinue() {
    if (!account) return;
    try {
        // Save pricing data to account
        const pricingData = {
            wizard_step: 'pricing',
            pricing_impl_fee: parseFloat(val('p_implementation_fee')) || 2000,
            pricing_num_users: parseInt(val('p_num_users')) || 1,
            pricing_recommended: pCalcResult.recommendedPrice || 2500,
            pricing_health: pCalcResult.healthLabel || 'N/A',
            pricing_discount: pCalcResult.totalDiscount || 0,
            pricing_trans_margin: pCalcResult.projectedTransMargin || 0,
        };
        account = await api('PATCH', `/accounts/${account.id}`, pricingData);

        // Auto-populate contract fields from pricing
        document.getElementById('implementation_fee').value = pricingData.pricing_impl_fee;
        document.getElementById('employee_count').value = pricingData.pricing_num_users;

        toast('Pricing saved');
        goToStep(2);
    } catch (e) { toast('Error: ' + e.message); }
}

// ---- Pricing Input Listeners ----

function initPricingListeners() {
    const ids = ['p_num_users', 'p_billing_cycle', 'p_custom_monthly', 'p_custom_annual', 'p_brand_tier', 'p_network_tier', 'p_trips_year', 'p_travelers_per_booking', 'p_travel_mix', 'p_avg_route_value', 'p_margin_rate', 'p_hotel_nights', 'p_avg_nightly_rate', 'p_hotel_commission', 'p_car_days', 'p_avg_daily_rental', 'p_car_commission', 'p_implementation_fee'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { pricingUpdateBasePrice(); });
    });
    ['p_logo_rights', 'p_referral_commit'].forEach(name => {
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', pricingRecalculate));
    });
}
