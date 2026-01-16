const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, loadImage } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

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
     * Convert PDF pages to images using pdfjs and stitch 6 pages into 1 (2x3 grid)
     * @param {Buffer} pdfBuffer - PDF file buffer
     * @returns {Promise<{stitchedPdf: Buffer, pageCount: number}>}
     */
    async stitchPDFPages(pdfBuffer) {
        console.log(`Loading PDF...`);

        // Load PDF with pdfjs
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
        const pdfDoc = await loadingTask.promise;
        const pageCount = pdfDoc.numPages;

        console.log(`Processing ${pageCount} pages...`);

        // Render each page to image
        const pageImages = [];
        const scale = 2; // Higher quality

        for (let i = 1; i <= pageCount; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale });

            // Create canvas
            const canvas = createCanvas(viewport.width, viewport.height);
            const ctx = canvas.getContext('2d');

            // Render PDF page to canvas
            await page.render({
                canvasContext: ctx,
                viewport: viewport
            }).promise;

            pageImages.push({
                width: canvas.width,
                height: canvas.height,
                buffer: canvas.toBuffer('image/png')
            });
        }

        console.log(`Rendered ${pageCount} pages to images`);

        // Stitch pages (6 per image in 2x3 grid)
        const stitchedImages = [];
        const pagesPerImage = 6;
        const cols = 2;
        const rows = 3;

        for (let i = 0; i < pageImages.length; i += pagesPerImage) {
            const batch = pageImages.slice(i, i + pagesPerImage);

            if (batch.length === 0) continue;

            // Get max dimensions
            const cellWidth = Math.max(...batch.map(p => p.width));
            const cellHeight = Math.max(...batch.map(p => p.height));

            // Create stitched canvas
            const stitchCanvas = createCanvas(cellWidth * cols, cellHeight * rows);
            const ctx = stitchCanvas.getContext('2d');

            // White background
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

            // Draw each page
            for (let j = 0; j < batch.length; j++) {
                const img = await loadImage(batch[j].buffer);
                const col = j % cols;
                const row = Math.floor(j / cols);
                ctx.drawImage(img, col * cellWidth, row * cellHeight, batch[j].width, batch[j].height);
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

        console.log(`Created stitched PDF with ${stitchedImages.length} pages from ${pageCount} original pages`);

        return {
            stitchedPdf: Buffer.from(stitchedPdfBytes),
            pageCount: stitchedImages.length
        };
    }

    /**
     * Extract text from PDF using Google Gemini
     * Stitches 6 pages into 1 before sending
     * @param {Buffer} fileBuffer - PDF file buffer  
     * @param {string} mimeType - File MIME type
     * @returns {Promise<{text: string, stitchedPdf: string}>} Extracted text and stitched PDF base64
     */
    async extractTextFromPDF(fileBuffer, mimeType = 'application/pdf') {
        try {
            // Stitch PDF pages
            const { stitchedPdf, pageCount } = await this.stitchPDFPages(fileBuffer);
            console.log(`Sending ${pageCount} stitched pages to Gemini`);

            // Convert stitched PDF to base64
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

            // Return both text and stitched PDF
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
