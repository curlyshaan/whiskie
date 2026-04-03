import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

async function testEmail() {
  console.log('🧪 Testing email configuration...\n');
  console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
  console.log('📧 ALERT_EMAIL:', process.env.ALERT_EMAIL);
  console.log('🔑 EMAIL_PASS:', process.env.EMAIL_PASS ? '***SET***' : '❌ NOT SET');
  console.log('');

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.ALERT_EMAIL) {
    console.error('❌ Missing email configuration!');
    console.error('Please set EMAIL_USER, EMAIL_PASS, and ALERT_EMAIL in .env or Railway');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  try {
    console.log('📤 Sending test email...');

    const info = await transporter.sendMail({
      from: `"Whiskie Bot" <${process.env.EMAIL_USER}>`,
      to: process.env.ALERT_EMAIL,
      subject: '✅ Whiskie Email Test - ' + new Date().toLocaleString(),
      html: `
        <h2>✅ Email Configuration Test</h2>
        <p>If you're reading this, email alerts are working correctly! 🎉</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <p><strong>From:</strong> ${process.env.EMAIL_USER}</p>
        <p><strong>To:</strong> ${process.env.ALERT_EMAIL}</p>

        <hr>
        <p style="color: #666; font-size: 0.9em;">
          This is a test email from Whiskie Trading Bot to verify email notifications are working.
        </p>
      `
    });

    console.log('✅ Email sent successfully!');
    console.log('📬 Message ID:', info.messageId);
    console.log('📧 Check your inbox:', process.env.ALERT_EMAIL);
    console.log('');
    console.log('✅ Email configuration is working correctly!');

  } catch (error) {
    console.error('❌ Email failed!');
    console.error('Error:', error.message);
    console.error('');
    console.error('Common issues:');
    console.error('1. Gmail App Password is invalid or expired');
    console.error('2. Less secure apps are blocked');
    console.error('3. Two-factor authentication not enabled');
    console.error('');
    console.error('Solution:');
    console.error('1. Go to: https://myaccount.google.com/apppasswords');
    console.error('2. Generate a new App Password');
    console.error('3. Update EMAIL_PASS in Railway environment variables');
    console.error('');
    console.error('Full error:', error);
    process.exit(1);
  }
}

testEmail();
