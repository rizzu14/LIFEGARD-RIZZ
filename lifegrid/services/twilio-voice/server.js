const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: true }));

app.post('/voice', (req, res) => {
  res.setHeader('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">LIFEGRID emergency. What is your situation?</Say>
  <Pause length="5"/>
  <Say voice="Polly.Joanna">Please stay on the line. Help is being arranged.</Say>
</Response>`);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LIFEGRID Twilio Voice', time: new Date().toISOString() });
});

app.listen(3000, () => {
  console.log('LIFEGRID voice server running on port 3000');
  console.log('Webhook endpoint: POST http://localhost:3000/voice');
});
