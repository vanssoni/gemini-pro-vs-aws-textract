const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, loadImage } = require('canvas');
const { pdfToPng } = require('pdf-to-png-converter');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Polyfills for fetch
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
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.1,
            },
        });
    }

    /**
     * Convert PDF pages to images and stitch 6 pages into 1 (2x3 grid)
     */
    async stitchPDFPages(pdfBuffer) {
        const tempDir = path.join(os.tmpdir(), `pdf-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });

        try {
            console.log('Converting PDF to PNG images...');

            // Convert PDF to PNG images
            const pngPages = await pdfToPng(pdfBuffer, {
                disableFontFace: false,
                useSystemFonts: false,
                viewportScale: 2.0,
                outputFolder: tempDir
            });

            console.log(`Converted ${pngPages.length} pages to images`);

            // Stitch pages (6 per image in 2x3 grid)
            const stitchedImages = [];
            const pagesPerImage = 6;
            const cols = 2;
            const rows = 3;

            for (let i = 0; i < pngPages.length; i += pagesPerImage) {
                const batch = pngPages.slice(i, i + pagesPerImage);

                if (batch.length === 0) continue;

                // Load images to get dimensions
                const images = await Promise.all(
                    batch.map(page => loadImage(page.content))
                );

                // Calculate cell size based on largest image
                const cellWidth = Math.max(...images.map(img => img.width));
                const cellHeight = Math.max(...images.map(img => img.height));

                // Create stitched canvas
                const stitchCanvas = createCanvas(cellWidth * cols, cellHeight * rows);
                const ctx = stitchCanvas.getContext('2d');

                // White background
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

                // Draw each page - scale to fit cell while maintaining aspect ratio
                for (let j = 0; j < images.length; j++) {
                    const img = images[j];
                    const col = j % cols;
                    const row = Math.floor(j / cols);

                    // Calculate scaling to fit within cell
                    const scale = Math.min(cellWidth / img.width, cellHeight / img.height);
                    const scaledWidth = img.width * scale;
                    const scaledHeight = img.height * scale;

                    // Center image in cell
                    const x = col * cellWidth + (cellWidth - scaledWidth) / 2;
                    const y = row * cellHeight + (cellHeight - scaledHeight) / 2;

                    ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
                }

                stitchedImages.push(stitchCanvas.toBuffer('image/png'));
            }

            console.log(`Created ${stitchedImages.length} stitched images`);

            // Create new PDF from stitched images
            const newPdf = await PDFDocument.create();

            for (const imageBuffer of stitchedImages) {
                const image = await newPdf.embedPng(imageBuffer);
                const page = newPdf.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height,
                });
            }

            const stitchedPdfBytes = await newPdf.save();

            // Cleanup
            await fs.rm(tempDir, { recursive: true, force: true });

            console.log(`Created stitched PDF with ${stitchedImages.length} pages from ${pngPages.length} original pages`);

            return {
                stitchedPdf: Buffer.from(stitchedPdfBytes),
                pageCount: stitchedImages.length
            };
        } catch (error) {
            // Cleanup on error
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (e) { }
            throw error;
        }
    }

    /**
     * Extract text from PDF using Google Gemini
     */
    async extractTextFromPDF(fileBuffer, mimeType = 'application/pdf') {
        try {
            const { stitchedPdf, pageCount } = await this.stitchPDFPages(fileBuffer);
            console.log(`Sending ${pageCount} stitched pages to Gemini`);

            const base64Data = stitchedPdf.toString('base64');

            const imagePart = {
                inlineData: {
                    data: base64Data,
                    mimeType: 'application/pdf'
                }
            };

            const prompt = "Extract all text from this PDF document which contains multiple pages stitched together (6 pages per image in 2x3 grid). Read all content from left to right, top to bottom. Return only the extracted text without any additional commentary or formatting.";

            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();

            return {
                text: text,
                stitchedPdf: base64Data
            };
        } catch (error) {
            console.error('Gemini extraction error:', error);
            throw new Error(`Gemini extraction failed: ${error.message}`);
        }
    }
}

module.exports = new GeminiHelper();
