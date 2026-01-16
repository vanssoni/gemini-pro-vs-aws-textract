const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

// Polyfills for fetch, Headers, and Response in Node.js < 18
if (!globalThis.fetch) {
    const fetch = require('node-fetch');
    globalThis.fetch = fetch;
    globalThis.Headers = fetch.Headers;
    globalThis.Response = fetch.Response;
    globalThis.Request = fetch.Request;
}

class GeminiHelper {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Using Gemini 3 Pro Preview - generally available in Google AI Studio (2026)
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.1, // Lower temperature for more consistent extraction
            },
        });
    }

    /**
     * Extract text from PDF using Google Gemini
     * Converts PDF pages to images and stitches 6 pages into 1 image
     * @param {Buffer} fileBuffer - PDF file buffer
     * @param {string} mimeType - File MIME type
     * @returns {Promise<string>} Extracted text
     */
    async extractTextFromPDF(fileBuffer, mimeType = 'application/pdf') {
        const fs = require('fs').promises;
        const path = require('path');
        const { convert } = require('pdf-poppler');
        const sharp = require('sharp');
        const os = require('os');

        const tempDir = path.join(os.tmpdir(), `pdf-${Date.now()}`);
        const pdfPath = path.join(tempDir, 'input.pdf');

        try {
            // Create temp directory
            await fs.mkdir(tempDir, { recursive: true });

            // Save PDF to temp file
            await fs.writeFile(pdfPath, fileBuffer);

            // Convert PDF pages to images
            const opts = {
                format: 'png',
                out_dir: tempDir,
                out_prefix: 'page',
                page: null // Convert all pages
            };

            await convert(pdfPath, opts);

            // Get all generated page images
            const files = await fs.readdir(tempDir);
            const pageImages = files
                .filter(f => f.startsWith('page-') && f.endsWith('.png'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/page-(\d+)/)[1]);
                    const numB = parseInt(b.match(/page-(\d+)/)[1]);
                    return numA - numB;
                })
                .map(f => path.join(tempDir, f));

            // Stitch pages (6 pages per image in 2x3 grid)
            const stitchedImages = [];
            const pagesPerImage = 6;

            for (let i = 0; i < pageImages.length; i += pagesPerImage) {
                const batch = pageImages.slice(i, i + pagesPerImage);

                // Load images
                const images = await Promise.all(
                    batch.map(async (imgPath) => {
                        const img = sharp(imgPath);
                        const metadata = await img.metadata();
                        return { buffer: await img.toBuffer(), width: metadata.width, height: metadata.height };
                    })
                );

                // Calculate grid dimensions (2 columns x 3 rows)
                const cols = 2;
                const rows = Math.ceil(batch.length / cols);
                const cellWidth = Math.max(...images.map(img => img.width));
                const cellHeight = Math.max(...images.map(img => img.height));

                // Create composite image
                const composites = [];
                for (let j = 0; j < images.length; j++) {
                    const col = j % cols;
                    const row = Math.floor(j / cols);
                    composites.push({
                        input: images[j].buffer,
                        top: row * cellHeight,
                        left: col * cellWidth
                    });
                }

                const stitchedPath = path.join(tempDir, `stitched-${i / pagesPerImage}.png`);
                await sharp({
                    create: {
                        width: cellWidth * cols,
                        height: cellHeight * rows,
                        channels: 4,
                        background: { r: 255, g: 255, b: 255, alpha: 1 }
                    }
                })
                    .composite(composites)
                    .png()
                    .toFile(stitchedPath);

                stitchedImages.push(stitchedPath);
            }

            // Send stitched images to Gemini
            const imageParts = await Promise.all(
                stitchedImages.map(async (imgPath) => {
                    const imageBuffer = await fs.readFile(imgPath);
                    return {
                        inlineData: {
                            data: imageBuffer.toString('base64'),
                            mimeType: 'image/png'
                        }
                    };
                })
            );

            const prompt = "Extract all text from these images which contain multiple PDF pages stitched together. Read all pages from left to right, top to bottom. Return only the extracted text without any additional commentary or formatting.";

            const result = await this.model.generateContent([prompt, ...imageParts]);
            const response = await result.response;
            const text = response.text();

            // Cleanup temp directory
            await fs.rm(tempDir, { recursive: true, force: true });

            return text;
        } catch (error) {
            // Cleanup on error
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                // Ignore cleanup errors
            }

            console.error('Gemini extraction error:', error);
            throw new Error(`Gemini extraction failed: ${error.message}`);
        }
    }
}
module.exports = new GeminiHelper();
