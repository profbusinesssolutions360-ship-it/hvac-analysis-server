const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK;
const TEMPLATE_PATH = path.join(__dirname, 'report_template.pptx');

// Serve generated PPTX files for download
app.get('/reports/:filename', (req, res) => {
  const filePath = `/tmp/${req.params.filename}`;
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('Report not found or expired.');
  }
});

function populatePptx(data) {
  const zip = new AdmZip(TEMPLATE_PATH);
  const replacements = {
    '[COMPANY NAME]': data.companyName || '',
    '[Owner Name]': data.ownerName || '',
    'January 21, 2026': data.reportDate || '',
    '[YOUR EMAIL]': 'dave@profitablebusinesssolutions.com',
    '[YOUR PHONE]': '',
    '$47,000+': data.totalDormantRevenue || '',
    '$47,000': data.totalDormantRevenue || '',
    '1,440 customers': (data.dormantCount || '') + ' customers',
    '1,440': data.dormantCount || '',
    '3,200': data.totalCustomers || '',
    '$288k': data.sunkCostLow || '',
    '$720k': data.sunkCostHigh || '',
    '$117,822': data.reactivationRevenue || '',
    '$8,400': data.month1Revenue || '',
    '$15,600': data.month2Revenue || '',
    '$23,800': data.month3Revenue || '',
    '$47,800': data.reactivationRevenue || '',
  };

  zip.getEntries().forEach(entry => {
    if (entry.entryName.startsWith('ppt/slides/') && entry.entryName.endsWith('.xml')) {
      let content = zip.readAsText(entry);
      for (const [old, newVal] of Object.entries(replacements)) {
        content = content.split(old).join(newVal);
      }
      zip.updateFile(entry.entryName, Buffer.from(content, 'utf8'));
    }
  });

  return zip.toBuffer();
}

app.post('/analyze', async (req, res) => {
  try {
    const { ownerName, companyName, ownerEmail, analysis } = req.body;

    let summary = `${companyName} has ${analysis.dormantCount} dormant customers representing ${analysis.totalDormantRevenue} in recoverable revenue. A 30% reactivation rate would generate ${analysis.reactivationRevenue}. Immediate action on the ${analysis.highPriorityCount} HIGH priority customers is recommended.`;

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
      if (aiData?.content?.[0]?.text) summary = aiData.content[0].text;
    } catch (aiErr) {
      console.log('AI fallback used:', aiErr.message);
    }

    let reportUrl = '';
    const pptxFilename = `${companyName.replace(/[^a-z0-9]/gi, '_')}_Revenue_Report.pptx`;

    try {
      const pptxBuffer = populatePptx({ ...analysis, companyName, ownerName });
      const tmpPath = `/tmp/${pptxFilename}`;
      fs.writeFileSync(tmpPath, pptxBuffer);
      reportUrl = `https://hvac-analysis-server.onrender.com/reports/${pptxFilename}`;
      console.log('PPTX saved and available at:', reportUrl);
    } catch (pptxErr) {
      console.error('PPTX error:', pptxErr.message);
    }

    const makePayload = {
      ownerName,
      companyName,
      ownerEmail,
      executiveSummary: summary,
      reportUrl,
      pptxFilename,
      totalCustomers: analysis.totalCustomers,
      dormantCount: analysis.dormantCount,
      totalDormantRevenue: analysis.totalDormantRevenue,
      reactivationRevenue: analysis.reactivationRevenue,
      month1Revenue: analysis.month1Revenue,
      month2Revenue: analysis.month2Revenue,
      month3Revenue: analysis.month3Revenue
    };

    await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload)
    });

    console.log('Sent to Make successfully');
    res.json({ success: true, summary });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('HVAC Analysis Server Running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
