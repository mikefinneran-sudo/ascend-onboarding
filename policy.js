/**
 * Ascend — Client-facing Travel Policy & Preferences form
 * Sent to client after contract is signed.
 * GitHub Pages demo uses localStorage.
 */

const STORAGE_KEY = 'ascend_policy';
let members = [];
let activeTab = null;

// Pre-fill demo members (from the onboarding wizard)
function loadDemo() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            members = data.members || [];
            if (data.policy) populatePolicy(data.policy);
        } catch (e) {}
    }
    // If no saved data, seed with demo travelers from onboarding
    if (members.length === 0) {
        const onboarding = localStorage.getItem('ascend_onboarding');
        if (onboarding) {
            try {
                const ob = JSON.parse(onboarding);
                const accounts = Object.values(ob.accounts || {});
                if (accounts.length > 0) {
                    const acct = accounts[accounts.length - 1];
                    members = (acct.travelers || []).map(t => ({
                        id: t.id,
                        name: t.name,
                        email: t.email || '',
                        phone: t.phone || '',
                        prefs: {},
                    }));
                }
            } catch (e) {}
        }
    }
    // Still empty — seed with demo
    if (members.length === 0) {
        members = [
            { id: uid(), name: 'Mark DeBolt', email: 'mdebolt@intel471.com', phone: '+1 555 867 5309', prefs: {} },
            { id: uid(), name: 'Sarah Chen', email: 'schen@intel471.com', phone: '', prefs: {} },
            { id: uid(), name: 'James Park', email: 'jpark@intel471.com', phone: '', prefs: {} },
        ];
    }
}

function uid() { return 'id-' + Math.random().toString(36).slice(2, 14); }

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ members, policy: collectPolicy() }));
}


// ---- Init ----

document.addEventListener('DOMContentLoaded', () => {
    loadDemo();
    renderMembers();
    renderPrefTabs();
    renderCallBooking();
});

// ---- Toast ----

function toast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), duration);
}

// ---- Team Members ----

function renderMembers() {
    const list = document.getElementById('member-list');
    list.replaceChildren();
    if (members.length === 0) {
        const p = document.createElement('p');
        p.className = 'text-sm text-txt-muted';
        p.textContent = 'No team members added yet.';
        list.appendChild(p);
        return;
    }
    members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-surface-alt rounded-lg p-3.5 border border-border';

        const left = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'font-medium text-txt text-sm';
        name.textContent = m.name;
        left.appendChild(name);

        if (m.email) {
            const email = document.createElement('span');
            email.className = 'text-txt-muted text-xs ml-3';
            email.textContent = m.email;
            left.appendChild(email);
        }
        if (m.phone) {
            const phone = document.createElement('span');
            phone.className = 'text-txt-muted text-xs ml-3';
            phone.textContent = m.phone;
            left.appendChild(phone);
        }

        const right = document.createElement('div');
        right.className = 'flex items-center gap-3';

        const prefStatus = document.createElement('span');
        const hasPref = m.prefs && Object.values(m.prefs).some(v => v);
        prefStatus.className = `text-xs ${hasPref ? 'text-green-600' : 'text-txt-muted'}`;
        prefStatus.textContent = hasPref ? 'Prefs saved' : 'No prefs';
        right.appendChild(prefStatus);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'text-red-400 hover:text-red-600 text-sm px-1';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => { members = members.filter(x => x.id !== m.id); save(); renderMembers(); renderPrefTabs(); renderCallBooking(); toast('Removed'); });
        right.appendChild(removeBtn);

        row.append(left, right);
        list.appendChild(row);
    });
}

function addMember() {
    const name = val('new_member_name');
    if (!name) { toast('Name is required'); return; }

    members.push({
        id: uid(),
        name,
        email: val('new_member_email'),
        phone: val('new_member_phone'),
        prefs: {},
    });
    save();
    renderMembers();
    renderPrefTabs();
    renderCallBooking();

    document.getElementById('new_member_name').value = '';
    document.getElementById('new_member_email').value = '';
    document.getElementById('new_member_phone').value = '';
    toast(`Added ${name}`);
}

// ---- Traveler Preferences ----

function renderPrefTabs() {
    const tabs = document.getElementById('pref-tabs');
    const form = document.getElementById('pref-form');
    tabs.replaceChildren();

    if (members.length === 0) {
        form.replaceChildren();
        const p = document.createElement('p');
        p.className = 'text-sm text-txt-muted';
        p.textContent = 'Add team members above first.';
        form.appendChild(p);
        return;
    }

    if (!activeTab || !members.find(m => m.id === activeTab)) {
        activeTab = members[0].id;
    }

    members.forEach(m => {
        const btn = document.createElement('button');
        btn.className = `tab-btn px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${m.id === activeTab ? 'active' : ''}`;
        btn.textContent = m.name;
        const hasPref = m.prefs && Object.values(m.prefs).some(v => v);
        if (hasPref) {
            const check = document.createElement('span');
            check.className = 'ml-1.5 text-xs';
            check.textContent = '\u2713';
            btn.appendChild(check);
        }
        btn.addEventListener('click', () => { savePrefFromForm(); activeTab = m.id; renderPrefTabs(); });
        tabs.appendChild(btn);
    });

    renderPrefForm();
}

function renderPrefForm() {
    const member = members.find(m => m.id === activeTab);
    if (!member) return;

    const p = member.prefs || {};
    const form = document.getElementById('pref-form');
    form.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-4';

    grid.append(
        makeSelect('pref_cabin', 'Cabin Preference', [['', 'Select...'], ['economy', 'Economy'], ['business', 'Business'], ['first', 'First']], p.cabin_preference),
        makeSelect('pref_seating', 'Seating', [['', 'No preference'], ['window', 'Window'], ['aisle', 'Aisle']], p.seating_preference),
        makeInput('pref_routes', 'Common Routes', 'e.g. NYC-LON, SFO-NRT', p.common_routes, true),
        makeInput('pref_loyalty', 'Loyalty Programs', 'e.g. United MileagePlus, Marriott Bonvoy', p.loyalty_programs, true),
        makeInput('pref_dietary', 'Dietary Restrictions', 'e.g. Kosher, Vegetarian', p.dietary),
        makeSelect('pref_gender', 'Gender (for booking)', [['', 'Select...'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']], p.gender),
        makeSelect('pref_miles', 'Miles Importance', [['', 'Select...'], ['not_important', 'Not important'], ['somewhat', 'Somewhat'], ['very_important', 'Very important']], p.miles_importance),
        makeSelect('pref_separated', 'Separated Segments OK?', [['', 'Select...'], ['yes', 'Yes'], ['no', 'No']], p.separated_segments_ok),
        makeSelect('pref_ancillary', 'Ancillary Services?', [['', 'Select...'], ['yes', 'Yes (hotels, trains, cars)'], ['no', 'No']], p.ancillary_services),
        makeSelect('pref_risk', 'Creative Routing OK?', [['', 'Select...'], ['yes', 'Yes (bigger savings)'], ['no', 'No (standard only)']], p.higher_risk_tickets_ok),
    );
    form.appendChild(grid);

    const btnRow = document.createElement('div');
    btnRow.className = 'flex justify-end mt-4';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-pri px-4 py-2 rounded-md text-sm font-semibold';
    saveBtn.textContent = 'Save Preferences';
    saveBtn.addEventListener('click', () => { savePrefFromForm(); renderPrefTabs(); toast('Preferences saved for ' + member.name); });
    btnRow.appendChild(saveBtn);
    form.appendChild(btnRow);
}

function savePrefFromForm() {
    const member = members.find(m => m.id === activeTab);
    if (!member) return;
    member.prefs = {
        cabin_preference: val('pref_cabin') || null,
        seating_preference: val('pref_seating') || null,
        common_routes: val('pref_routes') || null,
        loyalty_programs: val('pref_loyalty') || null,
        dietary: val('pref_dietary') || null,
        gender: val('pref_gender') || null,
        miles_importance: val('pref_miles') || null,
        separated_segments_ok: val('pref_separated') || null,
        ancillary_services: val('pref_ancillary') || null,
        higher_risk_tickets_ok: val('pref_risk') || null,
    };
    save();
}

// ---- Travel Policy ----

const POLICY_FIELDS = ['pol_cabin', 'pol_advance', 'pol_approval', 'pol_hotel', 'pol_international', 'pol_creative_routing', 'pol_separated', 'pol_ancillary'];

function collectPolicy() {
    const policy = {};
    POLICY_FIELDS.forEach(id => { const v = val(id); if (v) policy[id.replace('pol_', '')] = v; });
    const airlines = val('pol_airlines'); if (airlines) policy.preferred_airlines = airlines;
    const custom = val('pol_custom'); if (custom) policy.custom_notes = custom;
    return policy;
}

function populatePolicy(policy) {
    POLICY_FIELDS.forEach(id => {
        const key = id.replace('pol_', '');
        const el = document.getElementById(id);
        if (el && policy[key]) el.value = policy[key];
    });
    if (policy.preferred_airlines) document.getElementById('pol_airlines').value = policy.preferred_airlines;
    if (policy.custom_notes) document.getElementById('pol_custom').value = policy.custom_notes;
}

// ---- Preferences Call Booking ----

function renderCallBooking() {
    const list = document.getElementById('call-booking-list');
    list.replaceChildren();
    if (members.length === 0) {
        const p = document.createElement('p');
        p.className = 'text-sm text-txt-muted';
        p.textContent = 'Add team members above first.';
        list.appendChild(p);
        return;
    }
    members.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between bg-surface-alt rounded-lg p-4 border border-border';

        const nameEl = document.createElement('span');
        nameEl.className = 'font-medium text-txt text-sm';
        nameEl.textContent = m.name;

        const options = document.createElement('div');
        options.className = 'flex gap-2';

        const currentChoice = m.preferences_call || '';
        [['ai_agent', 'AI Agent'], ['person', 'A Person'], ['skip', 'Skip']].forEach(([value, label]) => {
            const btn = document.createElement('button');
            btn.className = currentChoice === value
                ? 'px-3 py-1.5 rounded-md text-xs font-semibold border border-pri bg-pri-light text-pri transition-colors'
                : 'px-3 py-1.5 rounded-md text-xs font-semibold border border-border text-txt-secondary hover:border-pri/50 transition-colors';
            btn.textContent = label;
            btn.addEventListener('click', () => {
                m.preferences_call = value;
                save();
                renderCallBooking();
            });
            options.appendChild(btn);
        });

        row.append(nameEl, options);
        list.appendChild(row);
    });
}

// ---- Submit ----

function submitAll() {
    savePrefFromForm();
    save();

    // Hide form sections, show success
    document.querySelectorAll('main > .card, main > .flex').forEach(el => el.classList.add('hidden'));
    document.getElementById('welcome-banner').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    toast('Submitted successfully');
}

// ---- DOM Helpers ----

function makeSelect(id, label, options, selected) {
    const wrap = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.className = 'block text-sm font-medium text-txt mb-1.5';
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.id = id;
    sel.className = 'w-full border border-border rounded-md px-3.5 py-2.5 text-sm';
    options.forEach(([value, text]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        if (value === selected) opt.selected = true;
        sel.appendChild(opt);
    });
    wrap.append(lbl, sel);
    return wrap;
}

function makeInput(id, label, placeholder, value, fullWidth) {
    const wrap = document.createElement('div');
    if (fullWidth) wrap.className = 'col-span-2';
    const lbl = document.createElement('label');
    lbl.className = 'block text-sm font-medium text-txt mb-1.5';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = id;
    inp.className = 'w-full border border-border rounded-md px-3.5 py-2.5 text-sm';
    inp.placeholder = placeholder;
    if (value) inp.value = value;
    wrap.append(lbl, inp);
    return wrap;
}

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
