const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK;

app.post('/analyze', async (req, res) => {
  try {
    const { ownerName, companyName, ownerEmail, analysis, csvData } = req.body;

    // Call Anthropic API
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are analyzing an HVAC company's dormant customer database. Write a 3-sentence executive summary of their revenue opportunity. Company: ${companyName}. Owner: ${ownerName}. Total dormant revenue: ${analysis.totalDormantRevenue}. Dormant customers: ${analysis.dormantCount}. Reactivation target: ${analysis.reactivationRevenue}. Plain text only, no formatting.`
        }]
      })
    });

    const aiData = await aiResponse.json();
    const summary = aiData.content[0].text;

    // Send to Make webhook
    await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerName,
        companyName,
        ownerEmail,
        reportEmail: 'dave@profitablebusinesssolutions.com',
        analysis,
        executiveSummary: summary
      })
    });

    res.json({ success: true, summary });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('HVAC Analysis Server Running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
