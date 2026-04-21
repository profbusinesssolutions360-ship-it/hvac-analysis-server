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

    let summary = `${companyName} has ${analysis.dormantCount} dormant customers representing ${analysis.totalDormantRevenue} in recoverable revenue. A 30% reactivation rate would generate ${analysis.reactivationRevenue} in the next 90 days. Immediate action on the ${analysis.highPriorityCount} HIGH priority customers is recommended.`;

    // Try Anthropic API but don't fail if it errors
    try {
      const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Write a 3-sentence executive summary of this HVAC company dormant customer opportunity. Company: ${companyName}. Owner: ${ownerName}. Dormant revenue: ${analysis.totalDormantRevenue}. Dormant customers: ${analysis.dormantCount}. Reactivation target: ${analysis.reactivationRevenue}. Plain text only.`
          }]
        })
      });

      const aiData = await aiResponse.json();
      console.log('Anthropic response:', JSON.stringify(aiData));
      
      if (aiData && aiData.content && aiData.content[0] && aiData.content[0].text) {
        summary = aiData.content[0].text;
      }
    } catch (aiErr) {
      console.log('AI call failed, using default summary:', aiErr.message);
    }

    // Send to Make webhook
    const makePayload = {
      ownerName,
      companyName,
      ownerEmail,
      reportEmail: 'dave@profitablebusinesssolutions.com',
      executiveSummary: summary,
      totalCustomers: analysis.totalCustomers,
      dormantCount: analysis.dormantCount,
      atRiskCount: analysis.atRiskCount,
      activeCount: analysis.activeCount,
      totalDormantRevenue: analysis.totalDormantRevenue,
      reactivationRevenue: analysis.reactivationRevenue,
      avgTicket: analysis.avgTicket,
      highPriorityCount: analysis.highPriorityCount,
      month1Revenue: analysis.month1Revenue,
      month2Revenue: analysis.month2Revenue,
      month3Revenue: analysis.month3Revenue,
      sunkCostLow: analysis.sunkCostLow,
      sunkCostHigh: analysis.sunkCostHigh,
      reportDate: analysis.reportDate,
      topTargets: JSON.stringify(analysis.topTargets)
    };

    console.log('Sending to Make:', JSON.stringify(makePayload));

    const makeResponse = await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload)
    });

    console.log('Make response status:', makeResponse.status);

    res.json({ success: true, summary });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('HVAC Analysis Server Running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
