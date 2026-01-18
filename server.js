require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const geminiHelper = require('./gemini-helper');
const textractHelper = require('./textract-helper');

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads (store in memory)
// Note: New uploads use direct S3 upload to bypass Vercel's 4.5MB limit
// This is kept for backward compatibility
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB limit
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
            const text = await geminiHelper.extractTextFromPDF(fileBuffer, req.file.mimetype);
            const time = Date.now() - startTime;

            res.json({
                success: true,
                service: 'gemini',
                text: text,
                time: time,
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

// Generate presigned URL for direct S3 upload
app.post('/api/upload/presigned-url', async (req, res) => {
    try {
        const { filename, contentType } = req.body;

        if (!filename || contentType !== 'application/pdf') {
            return res.status(400).json({ error: 'Invalid request. PDF filename required.' });
        }

        const key = `uploads/${uuidv4()}-${filename}`;
        const params = {
            Bucket: process.env.AWS_REPORT_BUCKET,
            Key: key,
            ContentType: contentType,
            Expires: 300 // URL expires in 5 minutes
        };

        const uploadUrl = await s3.getSignedUrlPromise('putObject', params);

        res.json({
            success: true,
            uploadUrl,
            key,
            bucket: process.env.AWS_REPORT_BUCKET
        });
    } catch (error) {
        console.error('Presigned URL error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Process file from S3 with Gemini
app.post('/api/extract/gemini-s3', async (req, res) => {
    try {
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'S3 key required' });
        }

        const startTime = Date.now();

        try {
            // Download from S3
            const s3Object = await s3.getObject({
                Bucket: process.env.AWS_REPORT_BUCKET,
                Key: key
            }).promise();

            const fileBuffer = s3Object.Body;
            const text = await geminiHelper.extractTextFromPDF(fileBuffer, 'application/pdf');
            const time = Date.now() - startTime;

            // Clean up S3 file
            await s3.deleteObject({
                Bucket: process.env.AWS_REPORT_BUCKET,
                Key: key
            }).promise();

            res.json({
                success: true,
                service: 'gemini',
                text: text,
                time: time,
                error: null
            });
        } catch (error) {
            console.error('Gemini S3 error:', error);

            // Try to clean up on error
            try {
                await s3.deleteObject({
                    Bucket: process.env.AWS_REPORT_BUCKET,
                    Key: key
                }).promise();
            } catch (deleteError) {
                // Ignore cleanup errors
            }

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

// Process file from S3 with Textract
app.post('/api/extract/textract-s3', async (req, res) => {
    try {
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'S3 key required' });
        }

        const startTime = Date.now();

        try {
            // Download from S3
            const s3Object = await s3.getObject({
                Bucket: process.env.AWS_REPORT_BUCKET,
                Key: key
            }).promise();

            const fileBuffer = s3Object.Body;
            const filename = key.split('/').pop();
            const text = await textractHelper.extractTextFromPDF(fileBuffer, filename);
            const time = Date.now() - startTime;

            // Clean up S3 file
            await s3.deleteObject({
                Bucket: process.env.AWS_REPORT_BUCKET,
                Key: key
            }).promise();

            res.json({
                success: true,
                service: 'textract',
                text: text,
                time: time,
                error: null
            });
        } catch (error) {
            console.error('Textract S3 error:', error);

            // Try to clean up on error
            try {
                await s3.deleteObject({
                    Bucket: process.env.AWS_REPORT_BUCKET,
                    Key: key
                }).promise();
            } catch (deleteError) {
                // Ignore cleanup errors
            }

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
