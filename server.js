const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const REPORT_EMAIL = 'dnegri1@gmail.com';
const TEMPLATE_PATH = path.join(__dirname, 'report_template.pptx');

function populatePptx(data) {
  const zip = new AdmZip(TEMPLATE_PATH);
  const entries = zip.getEntries();

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

  entries.forEach(entry => {
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

    // Generate populated PPTX
    const reportData = { ...analysis, companyName, ownerName, ownerEmail };
    
    try {
      const pptxBuffer = populatePptx(reportData);
      const filename = `${companyName.replace(/[^a-z0-9]/gi, '_')}_Revenue_Report.pptx`;

      if (GMAIL_USER && GMAIL_PASS) {
        const transporter = nodemailer.createTransporter({
          service: 'gmail',
          auth: { user: GMAIL_USER, pass: GMAIL_PASS }
        });

        await transporter.sendMail({
          from: GMAIL_USER,
          to: REPORT_EMAIL,
          subject: `Report Ready — ${companyName} (${ownerName})`,
          html: `<p>New report for <strong>${companyName}</strong>.</p>
                 <p><strong>Dormant Revenue:</strong> ${analysis.totalDormantRevenue}</p>
                 <p><strong>Dormant Customers:</strong> ${analysis.dormantCount}</p>
                 <p><strong>30% Reactivation:</strong> ${analysis.reactivationRevenue}</p>
                 <p><strong>Client Email:</strong> ${ownerEmail}</p>
                 <p><strong>AI Summary:</strong> ${summary}</p>
                 <p>PPTX report attached. Open in PowerPoint, export as PDF, record Loom.</p>`,
          attachments: [{
            filename,
            content: pptxBuffer
          }]
        });
        console.log('PPTX emailed to', REPORT_EMAIL);
      }
    } catch (pptxErr) {
      console.error('PPTX error:', pptxErr.message);
    }

    // Send to Make
    const makePayload = {
      ownerName, companyName, ownerEmail,
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

    await fetch(MAKE_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload)
    });

    res.json({ success: true, summary });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('HVAC Analysis Server Running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
