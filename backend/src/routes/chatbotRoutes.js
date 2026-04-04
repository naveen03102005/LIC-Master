const express = require('express');
const axios = require('axios');
const ChatMessage = require('../models/ChatMessage');
const authMiddleware = require('../middleware/authMiddleware');
const Claim = require('../models/Claim');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function generateBotReplyWithGemini(prompt, file = null) {
  if (!GEMINI_API_KEY) {
    return null;
  }

  try {
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        systemInstruction: {
          parts: [{
            text: `You are a helpful AI assistant for LIC (Life Insurance Corporation of India) policyholders. You help users with insurance claim filing, required documents, claim status tracking, and general policy-related queries. Be concise, accurate, and professional. If a question is outside the scope of LIC insurance, politely redirect the user.

LIC Policy Details & Knowledge Base:

POPULAR PLANS:
- LIC Jeevan Anand (Plan 915): Endowment + whole life combo. Premium paying term 15-35 years. Min SA ₹1,00,000. Provides maturity benefit + life cover continues after maturity.
- LIC Jeevan Labh (Plan 936): Limited premium endowment. Premium terms 10/13/16 years, policy terms 16/21/25 years. Min SA ₹2,00,000.
- LIC Tech Term (Plan 954): Pure online term plan. Cover ₹50 lakh to ₹25 crore. Age 18-65. Premiums are non-refundable.
- LIC Jeevan Umang (Plan 945): Whole life plan with annual survival benefits (8% of SA yearly after premium term). Premium terms 15/20/25/30 years.
- LIC New Endowment Plan (Plan 914): Traditional savings + protection. Policy terms 12-35 years. Min SA ₹1,00,000.
- LIC Dhan Varsha (Plan 966): Single premium plan. Policy term 10 years. Min SA ₹1,25,000.
- LIC SIIP (Plan 952): Unit-linked plan with systematic investment. Premium ₹5,000-₹1,00,000/month. Market-linked returns.

CLAIM TYPES:
- Maturity Claim: On policy term completion. Documents: original policy bond, ID proof, cancelled cheque, discharge form.
- Death Claim: On policyholder's demise. Documents: death certificate, policy bond, claimant's ID, NEFT details, hospital records (if applicable), FIR (if accidental).
- Survival Benefit: Periodic payouts under money-back plans. Auto-credited if NEFT registered, else cheque issued.
- Surrender Claim: Early policy termination (after 3+ years of premium payment). Surrender value = Guaranteed SV + Special Addition SV.
- Accident Benefit Claim: Additional payout under DAB rider. Documents: FIR, post-mortem report, medical records.
- Health/Rider Claim: Under health riders attached to base plan. Documents: hospital bills, discharge summary, prescriptions.

CLAIM PROCESS:
1. Intimate the claim at nearest LIC branch or via portal (licindia.in).
2. Fill the claim form (Form 3783 for maturity, Form 3784 for death claim).
3. Submit required documents.
4. LIC verifies documents and processes within 30 days (maturity) or 90 days (death).
5. Payment via NEFT to registered bank account.

PREMIUM PAYMENT OPTIONS:
- Online: licindia.in, LIC PayDirect app, net banking, UPI
- Offline: LIC branch, authorized agents, ECS/NACH mandate
- Modes: Yearly, Half-yearly, Quarterly, Monthly (SSS)
- Grace period: 30 days (yearly/half-yearly/quarterly), 15 days (monthly)

POLICY SERVICING:
- Revival: Lapsed policies can be revived within 5 years by paying arrears + interest.
- Loan: Up to 90% of surrender value. Interest ~9-10% p.a.
- Assignment/Nomination: Can be updated at any LIC branch with Form 3760/3752.
- Address/Contact Update: Online via portal or at branch with ID proof.

CONTACT:
- Customer care: 022-68276827
- Email: co_csd@licindia.com
- Portal: www.licindia.in
- Nearest branch locator on LIC website`
          }]
        },
        contents: [{
          parts: [
            { text: prompt },
            ...(file ? [{
              inlineData: {
                mimeType: file.mimetype,
                data: file.buffer.toString('base64')
              }
            }] : [])
          ]
        }],
      },
      {
        params: { key: GEMINI_API_KEY },
      }
    );

    const text =
      res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    return text;
  } catch (err) {
    console.error('Gemini API error:', err.response?.data || err.message);
    return null;
  }
}

function generateFallbackReply(text) {
  const lower = text.toLowerCase();

  if (lower.includes('status')) {
    return 'To check your claim status, go to the Claim Status page and enter your policy number or claim ID.';
  }

  if (lower.includes('document') || lower.includes('docs')) {
    return 'For most claims you need: identity proof, policy document, and depending on claim type, medical reports or death certificate.';
  }

  if (lower.includes('how') && lower.includes('claim')) {
    return 'To file a new claim, open the New Claim page from the dashboard, fill in the details, and upload required documents.';
  }

  return 'I can help with claim filing, required documents, and status tracking. Please ask a specific question about your LIC claim.';
}

router.post('/message', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const userId = req.user.userId;

    const userMsg = await ChatMessage.create({
      userId,
      sender: 'user',
      message,
    });

    // First, try Gemini
    let botText = await generateBotReplyWithGemini(message, req.file);

    // Fallback to rule-based reply if Gemini is not available or fails
    if (!botText) {
      botText = generateFallbackReply(message);
    }

    // Special handling for "my claims" queries
    if (message.toLowerCase().includes('my claims')) {
      const claims = await Claim.find({ policyNumber: req.user.policyNumber }).sort({ createdAt: -1 });
      if (!claims.length) {
        botText = 'I did not find any claims for your policy yet.';
      } else {
        const latest = claims[0];
        botText = `Your latest claim is currently "${latest.status}". Reason: ${latest.reason}.`;
      }
    }

    const botMsg = await ChatMessage.create({
      userId,
      sender: 'bot',
      message: botText,
    });

    res.json({ user: userMsg, bot: botMsg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to process message' });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ userId: req.user.userId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
});

module.exports = router;

