const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const REPORT_RECIPIENT = 'dnegri1@gmail.com';
const TEMPLATE_PATH = path.join(__dirname, 'report_template.pptx');

console.log('GMAIL_USER configured as:', GMAIL_USER);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD
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

    let pptxBuffer = null;
    const pptxFilename = `${companyName.replace(/[^a-z0-9]/gi, '_')}_Revenue_Report.pptx`;

    try {
      pptxBuffer = populatePptx({ ...analysis, companyName, ownerName });
      console.log('PPTX generated successfully');
    } catch (pptxErr) {
      console.error('PPTX error:', pptxErr.message);
    }

    try {
      const info = await transporter.sendMail({
        from: GMAIL_USER,
        to: REPORT_RECIPIENT,
        subject: `New HVAC Report Ready — ${companyName}`,
        html: `
          <h2>New HVAC Dormant Revenue Report</h2>
          <p><strong>Owner:</strong> ${ownerName}</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>Email:</strong> ${ownerEmail}</p>
          <hr>
          <p><strong>Total Customers:</strong> ${analysis.totalCustomers}</p>
          <p><strong>Dormant Customers:</strong> ${analysis.dormantCount}</p>
          <p><strong>Total Dormant Revenue:</strong> ${analysis.totalDormantRevenue}</p>
          <p><strong>30% Reactivation Target:</strong> ${analysis.reactivationRevenue}</p>
          <p><strong>Month 1:</strong> ${analysis.month1Revenue}</p>
          <p><strong>Month 2:</strong> ${analysis.month2Revenue}</p>
          <p><strong>Month 3:</strong> ${analysis.month3Revenue}</p>
          <hr>
          <p><strong>Executive Summary:</strong></p>
          <p>${summary}</p>
          <hr>
          <p><em>PPTX report generated — attachment delivery coming soon.</em></p>
        `
      });
      console.log('Email sent successfully');
      console.log('Message ID:', info.messageId);
      console.log('Accepted:', JSON.stringify(info.accepted));
      console.log('Rejected:', JSON.stringify(info.rejected));
    } catch (emailErr) {
      console.error('Email error:', emailErr.message);
    }

    const makePayload = {
      ownerName,
      companyName,
      ownerEmail,
      executiveSummary: summary,
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
