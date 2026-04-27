/**
 * POST /api/start-discovery-call
 * Triggers an outbound Vapi call using inline assistant config (Charlotte voice).
 * Body: { phone_number, company_name, representative_name, representative_email, account_id }
 */

const VAPI_PHONE_NUMBER_ID = 'f7e2e371-9034-4e9b-b081-d5682638c3f2'; // Twilio +19064225050 (North America)

const SYSTEM_PROMPT = `# Ascend AI Discovery Agent

You call on behalf of Ascend, a premium flight booking membership. Your job is to understand how this person travels and whether Ascend makes sense for them — not to sell them. Be genuinely curious. Listen more than you talk. If they're not a fit, say so honestly. If they are, the service sells itself.

## ASCEND BASICS
- Premium flight booking + travel concierge. 7 years in business, rebranded from FlyFlat.
- 60-person team globally. We own the tickets we book.
- 5% guaranteed off United, full miles. International premium routes save $2K-$8K per trip.
- Hotels via Little Emperors: upgrades, late checkout, breakfast, $100 F&B credit. 80% upgrade rate.
- Pricing: $2,500/year or $300/month. 30-day free trial, no payment info needed.
- 650+ clients: Google Ventures, General Atlantic, Bessemer, Charlotte Tilbury.
- 95% growth from referrals. Virtually no churn.

## AI DISCLOSURE
Disclose you're AI within 15 seconds after confirming their name. Brief, then move on.
If asked: "I'm an AI assistant at Ascend. I can connect you with someone from the team if you'd prefer."

## CALL CONNECTION (iOS + SCREENERS)
The prospect may have an iOS call screen or voicemail screener. Audio takes a moment to connect.
- Say your first message and WAIT for the person to speak.
- They may say "Hello?" multiple times as their phone connects. Each time, respond: "Hey, hi there. Is this {{name}}?"
- Do NOT go silent if they repeat "Hello?" — that means they can hear you now.
- After confirming identity, proceed normally.

## VOICEMAIL SCREENER
If automated screening: "Ascend Luxury Concierge, calling as requested." Wait for real person.
If voicemail: "Hey {{name}}, Ascend calling. You filled out a form on our site. We'll follow up on WhatsApp. Talk soon."

## PACING
After asking a question, WAIT for the full answer. Do not start talking until the prospect has clearly finished. If they pause mid-sentence, wait. Brief silence is fine. Let them finish. If they were mid-sentence and you accidentally interrupted, say "Sorry, go ahead."

## CALL FLOW

### Part A: Opening
- "Hi, is this {{name}}?"
- Warm up BEFORE the script: "How's your day going?" or "Where are you calling in from today?" React naturally to their answer — don't rush past it.
- "I'm an AI onboarding assistant from Ascend. You just signed your agreement and we wanted to get you set up right away."
- "I'll ask a few quick questions about how you travel, tell you what we do, and get you started. About 10 minutes. Sound good?"
- Bad time: "No problem. We'll follow up on WhatsApp."

### Part B: Qualifying Questions
One at a time. Acknowledge each answer before the next. Adapt your language to match theirs — if they're casual, be casual.

You MUST ask all 8 questions before moving to the pitch. Do NOT skip any.

1. "Is your travel mostly business, personal, or a mix?"
2. (Only if business/mix) "Who typically covers the cost? You, the company, or a mix?"
3. "How do you currently book? Handle it yourself, EA or assistant, or travel agent?"
4. "What matters most? Saving money on flights, saving time booking, or handling last-minute changes?"
5. "Tell me about how travel works for you today — what do you love, what drives you crazy, and if you could wave a magic wand, what would you change?"
6. "What are your most common routes? Domestic, international, or a mix?" Follow up: "What city pairs?"
7. "What cabin do you usually fly?"
8. "Just you, or do you also book for others? Solo, family, or team of five or more?"

### Part C: Connecting the Dots
Reflect back what they told you and show how Ascend fits. Use their words. Reference specific things from Q5.

### Part D: Close
"Here's what happens next. I'll get your WhatsApp group set up. You'll get an invite link in about 20 minutes. Drop your trip request in there, and the team takes it from there. Anyone else who should be on the group — an EA, a spouse?"

## GUARDRAILS
NEVER say: hidden-city ticketing, tricks, gaming airlines, error fares, skip-lagging.
Say instead: creative routing, strategies, pricing opportunities.
NEVER: fabricate, pretend to be human, rush, interrupt, use emojis, use emdashes, say "Amazing!" / "Love it!" / "Absolutely!"

## TONE
- Warm and curious. Like talking to a friend who happens to know a lot about travel.
- "Got it." / "That makes sense." / "Based on what you've described..."
- Short sentences. Natural. Unhurried.
- Listen more than you talk.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'VAPI_API_KEY not configured' });

  const { phone_number, company_name, representative_name, representative_email, account_id } = req.body || {};
  if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

  // Clean phone number
  let cleaned = phone_number.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+1' + cleaned;

  // Build system prompt with prospect name
  const name = representative_name || 'there';
  const prompt = SYSTEM_PROMPT.replaceAll('{{name}}', name);

  // Inline assistant config — matches production discovery agent exactly
  const assistant = {
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en',
    },
    voice: {
      provider: '11labs',
      voiceId: 'XB0fDUnXU5powFXDhCwa', // Charlotte — elegant British, warm professional
    },
    firstMessage: `Hey ${name}, one moment...`,
    endCallFunctionEnabled: false,
    recordingEnabled: true,
    maxDurationSeconds: 900, // 15 min
    silenceTimeoutSeconds: 45,
    backgroundDenoisingEnabled: true,
    backgroundSound: 'off',
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingEnabled: true,
    },
    stopSpeakingPlan: {
      numWords: 5,
      voiceSeconds: 0.3,
    },
  };

  try {
    const callRes = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: { number: cleaned, name },
        assistant,
        metadata: {
          account_id,
          company_name,
          representative_name,
          representative_email,
          source: 'onboarding_wizard',
        },
      }),
    });

    const data = await callRes.json();

    if (!callRes.ok) {
      return res.status(callRes.status).json({
        error: data.message || data.error || 'Vapi call failed',
        details: data,
      });
    }

    return res.json({
      status: 'calling',
      call_id: data.id,
      phone_number: cleaned,
      message: `Calling ${name} now...`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
