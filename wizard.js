/**
 * Ascend Enterprise Onboarding Wizard — GitHub Pages version
 * Uses localStorage instead of API backend for standalone testing.
 */

const STORAGE_KEY = 'ascend_onboarding';
let currentStep = -1;
let account = null;
let travelers = [];

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

    // POST /accounts/:id/send-contract
    if (method === 'POST' && (match = path.match(/^\/accounts\/([^/]+)\/send-contract$/))) {
        const id = match[1];
        const envelope = 'placeholder-' + uid();
        store.accounts[id].contract_status = 'sent';
        store.accounts[id].docusign_envelope_id = envelope;
        db_save(store);
        return { status: 'sent', envelope_id: envelope, message: 'DocuSign placeholder — contract marked as sent.', recipient: store.accounts[id].representative_email };
    }

    // PATCH /accounts/:id/policy
    if (method === 'PATCH' && (match = path.match(/^\/accounts\/([^/]+)\/policy$/))) {
        const id = match[1];
        Object.assign(store.accounts[id], body, { updated_at: Date.now() / 1000 });
        db_save(store);
        return { ...store.accounts[id] };
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
    loadAccounts();
    document.getElementById('effective_date').valueAsDate = new Date();
});

// ---- Toast ----

function toast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), duration);
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
        populateContractForm();
        renderTravelers();
        const stepMap = { company: 0, contract: 1, travelers: 2, review: 3, complete: 3 };
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
    if (n === 1) updateContractSummary();
    if (n === 2) renderTravelers();
    if (n === 3) renderReview();
}

// ---- Step 0: Company ----

function clearCompanyForm() {
    ['company_name', 'company_address', 'representative_name', 'representative_email', 'representative_phone', 'hubspot_deal_id', 'created_by'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('employee_count').value = '3';
    document.getElementById('account_notes').value = '';
}

function populateCompanyForm() {
    if (!account) return;
    const fields = { company_name: account.company_name, company_address: account.company_address, representative_name: account.representative_name, representative_email: account.representative_email, representative_phone: account.representative_phone, employee_count: account.employee_count, hubspot_deal_id: account.hubspot_deal_id, created_by: account.created_by, account_notes: account.notes };
    for (const [id, v] of Object.entries(fields)) { const el = document.getElementById(id); if (el && v != null) el.value = v; }
}

async function saveCompany() {
    const data = { company_name: val('company_name'), company_address: val('company_address'), representative_name: val('representative_name'), representative_email: val('representative_email'), representative_phone: val('representative_phone'), employee_count: parseInt(val('employee_count')) || 3, hubspot_deal_id: val('hubspot_deal_id') || null, created_by: val('created_by') || null, notes: val('account_notes') || null };
    if (!data.company_name || !data.representative_name) { toast('Company name and representative name are required'); return; }
    try {
        if (account) { account = await api('PATCH', `/accounts/${account.id}`, data); } else { account = await api('POST', '/accounts', data); }
        travelers = account.travelers || [];
        toast('Company info saved');
        goToStep(1);
    } catch (e) { toast('Error: ' + e.message); }
}

// ---- Step 1: Contract ----

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
    if (!account) return;
    try {
        const result = await api('POST', `/accounts/${account.id}/send-contract`);
        account.contract_status = 'sent';
        account.docusign_envelope_id = result.envelope_id;
        updateContractBadge(); updateReviewBadge();
        toast(result.message);
    } catch (e) { toast('Error sending contract: ' + e.message); }
}

async function saveContractFields() {
    if (!account) return;
    account = await api('PATCH', `/accounts/${account.id}`, { effective_date: val('effective_date') || null, billing_method: val('billing_method') || null, implementation_fee: parseFloat(val('implementation_fee')) || 2500, monthly_fee: parseFloat(val('monthly_fee')) || 300, wizard_step: 'contract' });
}

async function saveContractAndContinue() {
    try { await saveContractFields(); toast('Contract details saved'); goToStep(2); } catch (e) { toast('Error: ' + e.message); }
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
    const billingLabels = { retainer: 'Monthly Retainer', payasyougo: 'Pay-as-You-Go' };
    container.appendChild(makeReviewSection('Contract Terms', 1, [['Effective Date', account.effective_date], ['Implementation Fee', account.implementation_fee ? `$${Number(account.implementation_fee).toLocaleString()}` : null], ['Monthly Fee', account.monthly_fee ? `$${Number(account.monthly_fee).toLocaleString()}/mo` : null], ['Billing Method', billingLabels[account.billing_method] || account.billing_method]]));
    const travelerLines = travelers.length > 0 ? travelers.map(t => { let line = t.name; if (t.is_representative) line += ' (REP)'; if (t.email) line += ` \u2014 ${t.email}`; return ['', line]; }) : [['', 'No travelers added']];
    container.appendChild(makeReviewSection(`Travelers (${travelers.length})`, 2, travelerLines));
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

    function formatDate(dateStr) { if (!dateStr) return '___________'; const d = new Date(dateStr + 'T12:00:00'); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }

    const title = _el('h1', 'text-xl font-bold text-center mb-6 tracking-tight', 'ASCEND SERVICES AGREEMENT');
    const preamble = document.createElement('p'); preamble.className = 'mb-4';
    preamble.append('THIS SERVICES AGREEMENT (which, including any attachments and exhibits hereto shall be known as the "', _el('strong', '', 'Agreement'), '") is entered into as of ', _el('strong', 'underline', formatDate(a.effective_date)), ' (the "', _el('strong', '', 'Effective Date'), '") by and between EasyPoint, Inc. DBA Ascend, a Delaware corporation (hereafter "', _el('strong', '', 'Ascend'), '"), and ', _el('strong', 'underline', companyName), ', an entity located at ', _el('strong', 'underline', companyAddr), ' (hereafter "', _el('strong', '', 'Customer'), '"). The parties hereby agree as follows:');
    container.append(title, preamble);

    const sections = [
        { title: 'SERVICES', text: 'Ascend agrees to provide to Customer the services outlined here: https://www.joinascend.com/#ac-pricing (collectively the \u201cServices\u201d).' },
        { title: 'FEES', parts: ['Customer shall incur a one-time implementation fee of ', { bold: true, text: `$${implFee} USD` }, ' and a monthly recurring service fee of ', { bold: true, text: `$${monthlyFee} USD` }, '. This fee provides access to one year of Services, beginning on the Effective Date, for ', { bold: true, text: `${employees} Customer employee${employees > 1 ? 's' : ''}` }, '.'] },
        { title: 'BOOKINGS & PAYMENT', text: 'Customer may choose between two billing methods:\n\nOption 1: Monthly Retainer. Customer may maintain a retainer account with Ascend ($10,000 USD balance by the 5th of each month). A 1.5% discount applies for same-day ACH or wire.\n\nOption 2: Pay-as-You-Go. Each booking charged in real-time to credit card on file.', highlight: true },
        { title: 'COMMUNICATIONS', parts: ['The initial Representative under this Agreement is ', { bold: true, text: repName }, '. The primary communication channel will be WhatsApp, unless otherwise agreed in writing.'] },
        { title: 'RELATIONSHIP BETWEEN THE PARTIES', text: 'The parties will be acting as independent contractors.' },
        { title: 'TERM & TERMINATION', text: 'This Agreement continues until terminated with thirty (30) days\u2019 written notice.' },
        { title: 'CONFIDENTIAL INFORMATION; IP', text: 'Each party shall keep confidential and protect the Confidential Information of the other party.' },
        { title: 'ASCEND TERMS', text: 'Customer agrees to be bound by Ascend\u2019s Terms of Service, Privacy Policy, and Change and Cancellation Policy.' },
        { title: 'LIMITATION OF LIABILITY', text: 'IN NO EVENT WILL EITHER PARTY\u2019S LIABILITY EXCEED THE TOTAL AMOUNT OF FEES PAID BY CUSTOMER IN THE 12 MONTHS PRIOR TO THE CLAIM.' },
        { title: 'INDEMNIFICATION', text: 'Each party will indemnify the other from claims arising from any violation of this Agreement.' },
        { title: 'NON-DISPARAGEMENT', text: 'Neither party shall disparage the other during the term and for twelve (12) months after termination.' },
        { title: 'FORCE MAJEURE', text: 'Neither party shall be liable for delays from acts beyond reasonable control.' },
        { title: 'MARKETING RIGHTS', text: 'Customer grants Ascend the right to use Customer\u2019s name and logo in marketing materials.' },
        { title: 'MISCELLANEOUS PROVISIONS', text: 'This Agreement is the entire agreement and may be executed in counterparts.' },
    ];

    const ol = document.createElement('ol'); ol.className = 'space-y-4 list-decimal pl-5';
    sections.forEach(sec => {
        const li = document.createElement('li'); li.className = 'leading-relaxed';
        const b = document.createElement('strong'); b.textContent = sec.title + '. '; li.appendChild(b);
        if (sec.parts) { sec.parts.forEach(part => { if (typeof part === 'string') li.append(part); else { const s = document.createElement('strong'); s.className = 'underline decoration-pri/30'; s.textContent = part.text; li.appendChild(s); } }); }
        else if (sec.text) { sec.text.split('\n\n').forEach((line, i) => { if (i > 0) { li.appendChild(document.createElement('br')); li.appendChild(document.createElement('br')); } li.append(line); }); }
        if (sec.highlight) {
            const box = document.createElement('div'); box.className = 'mt-3 p-3 rounded-md bg-pri-light border border-border-light text-sm';
            const icon = document.createElement('span'); icon.className = 'font-semibold text-pri'; icon.textContent = 'Selected: '; box.appendChild(icon);
            const span = document.createElement('span');
            if (a.billing_method === 'retainer') span.textContent = 'Option 1: Monthly Retainer.';
            else if (a.billing_method === 'payasyougo') span.textContent = 'Option 2: Pay-as-You-Go.';
            else { span.className = 'italic text-txt-muted'; span.textContent = 'Not yet selected.'; }
            box.appendChild(span); li.appendChild(box);
        }
        ol.appendChild(li);
    });
    container.appendChild(ol);

    // Signature block
    const sigBlock = document.createElement('div'); sigBlock.className = 'mt-10 pt-6 border-t border-border';
    const sigTitle = document.createElement('p'); sigTitle.className = 'text-sm text-txt-secondary italic mb-6'; sigTitle.textContent = 'IN WITNESS WHEREOF, the parties hereto have executed this Agreement as of the Effective Date.';
    sigBlock.appendChild(sigTitle);
    const sigGrid = document.createElement('div'); sigGrid.className = 'grid grid-cols-2 gap-12';
    const ascendSig = document.createElement('div'); ascendSig.className = 'space-y-3';
    const at = document.createElement('p'); at.className = 'font-bold text-sm'; at.textContent = 'Ascend'; ascendSig.appendChild(at);
    ['Signature: ___________________', 'Print Name: Zachary Resnick', 'Title: CEO', 'Date: ___________________'].forEach(line => { const p = document.createElement('p'); p.className = 'text-sm text-txt-secondary'; p.textContent = line; ascendSig.appendChild(p); });
    const custSig = document.createElement('div'); custSig.className = 'space-y-3';
    const ct = document.createElement('p'); ct.className = 'font-bold text-sm underline'; ct.textContent = companyName; custSig.appendChild(ct);
    ['Signature: ___________________', 'Print Name: ___________________', 'Title: ___________________', 'Date: ___________________'].forEach(line => { const p = document.createElement('p'); p.className = 'text-sm text-txt-secondary'; p.textContent = line; custSig.appendChild(p); });
    sigGrid.append(ascendSig, custSig); sigBlock.appendChild(sigGrid); container.appendChild(sigBlock);
}

function _el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; }

// ---- Complete ----

async function completeOnboarding() {
    if (!account) return;
    try {
        const result = await api('POST', `/accounts/${account.id}/complete`);
        document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('account-picker').classList.add('hidden');
        document.getElementById('complete-screen').classList.remove('hidden');
        document.getElementById('complete-message').textContent = `${result.company} onboarded with ${result.travelers} traveler(s).`;
        document.querySelectorAll('.step-dot').forEach(d => { d.classList.remove('active', 'pending'); d.classList.add('done'); });
        document.querySelectorAll('.step-label').forEach(l => { l.classList.remove('active', 'pending'); l.classList.add('done'); });
        document.querySelectorAll('.step-line').forEach(l => { l.classList.remove('pending'); l.classList.add('done'); });
    } catch (e) { toast('Error: ' + e.message); }
}

function resetWizard() { account = null; travelers = []; clearCompanyForm(); goToStep(-1); }

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
