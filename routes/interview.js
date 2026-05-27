const path = require('path');
const mammoth = require('mammoth');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const mongoose = require('mongoose');

const Session = mongoose.model('Session');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const { PDFParse } = require('pdf-parse');

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } else {
    throw new Error('Unsupported file type');
  }
}

router.post('/upload', upload.single('resume'), async (req, res) => {
  try {
    const { name, role } = req.body;
    const resumeText = await extractTextFromFile(req.file.path);
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `You are an expert interviewer. Based on this resume, generate 5 technical and 5 HR interview questions for the role of ${role}. 
            Resume: ${resumeText.substring(0, 2000)}
            
            Return ONLY a JSON array of 10 questions like this:
            ["question1", "question2", ...]`
          }]
        }]
      }
    );

    const rawText = response.data.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const questions = JSON.parse(cleaned);

    const session = new Session({ name, role, resumeText, questions });
    await session.save();

    res.json({ sessionId: session._id, questions });
  } catch (err) {
    console.error('UPLOAD ERROR:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/submit', async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    const session = await Session.findById(sessionId);

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `You are an expert interviewer. Score each answer out of 10 and give overall feedback.
            
            Questions and Answers:
            ${session.questions.map((q, i) => `Q${i+1}: ${q}\nA${i+1}: ${answers[i]}`).join('\n\n')}
            
            Return ONLY JSON like this:
            {
              "scores": [7, 8, 6, 9, 7, 8, 6, 7, 8, 9],
              "totalScore": 75,
              "feedback": "Overall feedback here"
            }`
          }]
        }]
      }
    );

    const rawText = response.data.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const result = JSON.parse(cleaned);

    session.answers = answers;
    session.scores = result.scores;
    session.totalScore = result.totalScore;
    session.feedback = result.feedback;
    await session.save();

    res.json(result);
  } catch (err) {
    console.error('SUBMIT ERROR:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

module.exports = router;