/**
 * Vercel serverless function: GET /api/hubspot-owner?deal_id=123
 * Looks up the HubSpot deal owner and returns their name + Calendly link.
 */

// AE name → Calendly URL mapping
const AE_CALENDLY = {
  'mike finneran':   'https://calendly.com/mikefinneran',
  'chloe calandra':  'https://calendly.com/chloe-joinascend',
  'cam':             'https://calendly.com/cam-joinascend',
  'zach resnick':    'https://calendly.com/zach-joinascend',
};

// Fallback if owner not in map
const DEFAULT_CALENDLY = 'https://calendly.com/mikefinneran';

function matchAE(ownerName) {
  if (!ownerName) return null;
  const lower = ownerName.toLowerCase().trim();
  // Exact match first
  if (AE_CALENDLY[lower]) return { name: ownerName, calendly: AE_CALENDLY[lower] };
  // Partial match (first name)
  for (const [key, url] of Object.entries(AE_CALENDLY)) {
    if (lower.includes(key.split(' ')[0]) || key.includes(lower.split(' ')[0])) {
      return { name: ownerName, calendly: url };
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { deal_id } = req.query;
  if (!deal_id) {
    return res.status(400).json({ error: 'deal_id is required' });
  }

  const token = process.env.HUBSPOT_PAT;
  if (!token) {
    return res.status(500).json({ error: 'HubSpot PAT not configured' });
  }

  try {
    // 1. Get deal with owner ID
    const dealRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${deal_id}?properties=dealname,hubspot_owner_id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!dealRes.ok) {
      const err = await dealRes.text();
      return res.status(dealRes.status).json({ error: `HubSpot deal lookup failed: ${err}` });
    }
    const deal = await dealRes.json();
    const ownerId = deal.properties?.hubspot_owner_id;

    if (!ownerId) {
      return res.json({ ae_name: null, calendly: DEFAULT_CALENDLY, source: 'no_owner' });
    }

    // 2. Get owner details
    const ownerRes = await fetch(
      `https://api.hubapi.com/crm/v3/owners/${ownerId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!ownerRes.ok) {
      return res.json({ ae_name: null, calendly: DEFAULT_CALENDLY, source: 'owner_lookup_failed' });
    }
    const owner = await ownerRes.json();
    const ownerName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
    const ownerEmail = owner.email;

    // 3. Match to Calendly
    const match = matchAE(ownerName);
    return res.json({
      ae_name: ownerName,
      ae_email: ownerEmail,
      calendly: match ? match.calendly : DEFAULT_CALENDLY,
      source: match ? 'hubspot' : 'hubspot_unmapped',
      deal_name: deal.properties?.dealname,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
