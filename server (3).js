const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
const REPORT_EMAIL = 'dnegri1@gmail.com';

app.post('/analyze', async (req, res) => {
  try {
    const { ownerName, companyName, ownerEmail, analysis } = req.body;

    // Default summary
    let summary = `${companyName} has ${analysis.dormantCount} dormant customers representing ${analysis.totalDormantRevenue} in recoverable revenue. A 30% reactivation rate would generate ${analysis.reactivationRevenue}. Immediate action on the ${analysis.highPriorityCount} HIGH priority customers is recommended.`;

    // Try Anthropic API
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

    // Generate PPTX
    const reportData = {
      ...analysis,
      companyName,
      ownerName,
      ownerEmail,
      executiveSummary: summary
    };

    const pptxPath = `/tmp/report_${Date.now()}.pptx`;
    const pdfPath = pptxPath.replace('.pptx', '.pdf');

    try {
      execSync(`python3 ${path.join(__dirname, 'populate_report.py')} '${JSON.stringify(reportData).replace(/'/g, "\\'")}' '${pptxPath}'`);
      execSync(`libreoffice --headless --convert-to pdf --outdir /tmp ${pptxPath}`);
      console.log('PDF generated:', pdfPath);

      // Email PDF to Dave
      if (GMAIL_USER && GMAIL_PASS && fs.existsSync(pdfPath)) {
        const transporter = nodemailer.createTransporter({
          service: 'gmail',
          auth: { user: GMAIL_USER, pass: GMAIL_PASS }
        });

        await transporter.sendMail({
          from: GMAIL_USER,
          to: REPORT_EMAIL,
          subject: `Report Ready — ${companyName} (${ownerName})`,
          html: `<p>New report generated for <strong>${companyName}</strong>.</p>
                 <p><strong>Dormant Revenue:</strong> ${analysis.totalDormantRevenue}</p>
                 <p><strong>Dormant Customers:</strong> ${analysis.dormantCount}</p>
                 <p><strong>Reactivation Target:</strong> ${analysis.reactivationRevenue}</p>
                 <p><strong>Client Email:</strong> ${ownerEmail}</p>
                 <p>PDF report attached. Record your Loom and send to: ${ownerEmail}</p>`,
          attachments: [{
            filename: `${companyName}_Revenue_Report.pdf`,
            path: pdfPath
          }]
        });
        console.log('PDF emailed to', REPORT_EMAIL);
      }

      // Cleanup
      try { fs.unlinkSync(pptxPath); fs.unlinkSync(pdfPath); } catch(e) {}

    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr.message);
    }

    // Send to Make webhook
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
