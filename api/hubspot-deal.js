/**
 * Vercel serverless function: /api/hubspot-deal
 *
 * GET ?search=<name>  — Search HubSpot companies by name, include associated deals
 * GET ?deal_id=<id>   — Pull a single deal with properties
 * POST { account }    — Create or update a deal in Sales Pipeline v.1 with contract data
 */

const HUBSPOT_API = 'https://api.hubapi.com';
const PIPELINE_ID = '872357555';          // Sales Pipeline v.1
const STAGE_TRIAL = '1307153335';         // Trial stage

function headers() {
  const token = process.env.HUBSPOT_PAT;
  if (!token) throw new Error('HUBSPOT_PAT not configured');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function hs(method, path, body) {
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(HUBSPOT_API + path, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`HubSpot ${res.status}: ${data.message || JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- Search companies by name, return companies + their first associated deal ----

async function searchCompanies(query) {
  const result = await hs('POST', '/crm/v3/objects/companies/search', {
    query,
    properties: ['name', 'domain', 'phone', 'address', 'city', 'state', 'zip', 'country'],
    limit: 10,
  });

  const companies = result.results || [];
  if (companies.length === 0) return [];

  // For each company, fetch associated deals
  const enriched = await Promise.all(companies.map(async (co) => {
    try {
      const assocRes = await hs(
        'GET',
        `/crm/v4/objects/companies/${co.id}/associations/deals?limit=5`
      );
      const dealIds = (assocRes.results || []).map(r => r.toObjectId);

      let deals = [];
      if (dealIds.length > 0) {
        // Batch read deals
        const dealRes = await hs('POST', '/crm/v3/objects/deals/batch/read', {
          inputs: dealIds.map(id => ({ id: String(id) })),
          properties: ['dealname', 'dealstage', 'pipeline', 'amount', 'closedate', 'description'],
        });
        deals = (dealRes.results || [])
          .filter(d => d.properties.pipeline === PIPELINE_ID)
          .map(d => ({
            id: d.id,
            name: d.properties.dealname,
            stage: d.properties.dealstage,
            amount: d.properties.amount,
            closedate: d.properties.closedate,
          }));
      }

      // Also fetch associated contacts for rep info
      let contact = null;
      try {
        const contactAssoc = await hs(
          'GET',
          `/crm/v4/objects/companies/${co.id}/associations/contacts?limit=1`
        );
        const contactIds = (contactAssoc.results || []).map(r => r.toObjectId);
        if (contactIds.length > 0) {
          const contactRes = await hs(
            'GET',
            `/crm/v3/objects/contacts/${contactIds[0]}?properties=firstname,lastname,email,phone`
          );
          const cp = contactRes.properties;
          contact = {
            id: contactRes.id,
            name: [cp.firstname, cp.lastname].filter(Boolean).join(' '),
            email: cp.email,
            phone: cp.phone,
          };
        }
      } catch (_) { /* no contacts, fine */ }

      const addr = [co.properties.address, co.properties.city, co.properties.state, co.properties.zip]
        .filter(Boolean).join(', ');

      return {
        id: co.id,
        name: co.properties.name,
        domain: co.properties.domain,
        address: addr,
        deals,
        contact,
      };
    } catch (_) {
      return { id: co.id, name: co.properties.name, domain: co.properties.domain, deals: [], contact: null };
    }
  }));

  return enriched;
}

// ---- Search contacts by name or email, return contact + primary company ----

async function searchContacts(query) {
  const q = query.trim();
  const looksLikeEmail = q.includes('@');

  const filterGroups = looksLikeEmail
    ? [{ filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: q }] }]
    : [
        { filters: [{ propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: q }] },
        { filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: q }] },
        { filters: [{ propertyName: 'email', operator: 'CONTAINS_TOKEN', value: q }] },
      ];

  const result = await hs('POST', '/crm/v3/objects/contacts/search', {
    filterGroups,
    properties: ['firstname', 'lastname', 'email', 'phone', 'jobtitle', 'company'],
    limit: 10,
  });

  const contacts = result.results || [];
  if (contacts.length === 0) return [];

  const enriched = await Promise.all(contacts.map(async (c) => {
    const cp = c.properties;
    let company = null;
    try {
      const assoc = await hs('GET', `/crm/v4/objects/contacts/${c.id}/associations/companies?limit=1`);
      const companyIds = (assoc.results || []).map(r => r.toObjectId);
      if (companyIds.length > 0) {
        const coRes = await hs(
          'GET',
          `/crm/v3/objects/companies/${companyIds[0]}?properties=name,domain,address,city,state,zip`
        );
        const cop = coRes.properties;
        const addr = [cop.address, cop.city, cop.state, cop.zip].filter(Boolean).join(', ');
        company = { id: coRes.id, name: cop.name, domain: cop.domain, address: addr };
      }
    } catch (_) { /* no company assoc, fine */ }

    return {
      id: c.id,
      name: [cp.firstname, cp.lastname].filter(Boolean).join(' ') || cp.email,
      firstname: cp.firstname,
      lastname: cp.lastname,
      email: cp.email,
      phone: cp.phone,
      jobtitle: cp.jobtitle,
      company,
    };
  }));

  return enriched;
}

// ---- Get a single deal ----

async function getDeal(dealId) {
  return hs('GET', `/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,pipeline,amount,closedate,description,ff_deal_type,ff_source_channel`);
}

// ---- Create or update a deal with contract data ----

async function pushDeal(data) {
  const annualValue = (data.implementation_fee || 0) + (data.monthly_fee || 0) * 12;

  const billingLabel = data.billing_method === 'retainer'
    ? 'Monthly Retainer ($10K balance)'
    : data.billing_method === 'payasyougo'
    ? 'Pay-as-You-Go (credit card)'
    : 'Not selected';

  const desc = [
    `Onboarded via wizard by ${data.created_by || 'unknown AE'}.`,
    `Employees: ${data.employee_count || '?'}`,
    `Implementation: $${Number(data.implementation_fee || 0).toLocaleString()}`,
    `Monthly: $${Number(data.monthly_fee || 0).toLocaleString()}/mo`,
    `Billing: ${billingLabel}`,
    `Travelers: ${data.traveler_count || 0}`,
  ].join(' | ');

  const properties = {
    dealname: `${data.company_name} — Onboarding`,
    pipeline: PIPELINE_ID,
    dealstage: STAGE_TRIAL,
    amount: String(annualValue),
    description: desc,
    ff_deal_type: 'new_business',
  };
  if (data.effective_date) {
    // HubSpot wants midnight UTC for date properties
    properties.closedate = new Date(data.effective_date + 'T00:00:00Z').toISOString();
  }

  let deal;
  let updated = false;

  if (data.hubspot_deal_id) {
    // Update existing deal
    deal = await hs('PATCH', `/crm/v3/objects/deals/${data.hubspot_deal_id}`, { properties });
    updated = true;
  } else {
    // Create new deal
    deal = await hs('POST', '/crm/v3/objects/deals', { properties });

    // Associate with company if we have a HubSpot company ID
    if (data.hubspot_company_id) {
      try {
        await hs(
          'PUT',
          `/crm/v3/objects/deals/${deal.id}/associations/companies/${data.hubspot_company_id}/deal_to_company`,
          {}
        );
      } catch (_) { /* non-fatal */ }
    }
  }

  return { deal_id: deal.id, deal_name: deal.properties.dealname, updated };
}

// ---- Handler ----

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { search, contact, deal_id } = req.query;

      if (search) {
        const results = await searchCompanies(search);
        return res.json({ results });
      }

      if (contact) {
        const results = await searchContacts(contact);
        return res.json({ results });
      }

      if (deal_id) {
        const deal = await getDeal(deal_id);
        return res.json({ deal });
      }

      return res.status(400).json({ error: 'Provide ?search=, ?contact=, or ?deal_id=' });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !body.company_name) {
        return res.status(400).json({ error: 'company_name is required' });
      }
      const result = await pushDeal(body);
      return res.status(result.updated ? 200 : 201).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('hubspot-deal error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}
