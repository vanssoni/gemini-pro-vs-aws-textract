require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const geminiHelper = require('./gemini-helper');
const textractHelper = require('./textract-helper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads (store in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 20MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

// Upload and process with Gemini endpoint
app.post('/api/extract/gemini', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const fileBuffer = req.file.buffer;
        const startTime = Date.now();

        try {
            const result = await geminiHelper.extractTextFromPDF(fileBuffer, req.file.mimetype);
            const time = Date.now() - startTime;

            res.json({
                success: true,
                service: 'gemini',
                text: result.text,
                time: time,
                stitchedPdf: result.stitchedPdf, // Base64 encoded stitched PDF
                error: null
            });
        } catch (error) {
            console.error('Gemini error:', error);
            res.json({
                success: false,
                service: 'gemini',
                text: '',
                time: Date.now() - startTime,
                error: error.message
            });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            service: 'gemini',
            error: error.message
        });
    }
});

// Upload and process with Textract endpoint
app.post('/api/extract/textract', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const fileBuffer = req.file.buffer;
        const startTime = Date.now();

        try {
            const text = await textractHelper.extractTextFromPDF(fileBuffer, req.file.originalname);
            const time = Date.now() - startTime;

            res.json({
                success: true,
                service: 'textract',
                text: text,
                time: time,
                error: null
            });
        } catch (error) {
            console.error('Textract error:', error);
            res.json({
                success: false,
                service: 'textract',
                text: '',
                time: Date.now() - startTime,
                error: error.message
            });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            service: 'textract',
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size too large. Maximum 20MB allowed.' });
        }
    }
    res.status(500).json({ error: error.message });
});


app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📄 Upload PDFs to compare Gemini 2.0 Flash vs AWS Textract`);
});

// Export for Vercel serverless
module.exports = app;
