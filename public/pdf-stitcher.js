// PDF Stitching Helper - Client Side
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let stitchedPdfBlob = null;

/**
 * Convert PDF to images and stitch 6 pages into 1 (2x3 grid)
 * @param {File} pdfFile - PDF file to process
 * @returns {Promise<{blob: Blob, images: string[]}>} Stitched PDF blob and image data URLs
 */
async function stitchPDFPages(pdfFile) {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pageImages = [];
    const scale = 2; // Higher quality

    // Convert all pages to images
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        pageImages.push(canvas.toDataURL('image/png'));
    }

    // Stitch pages (6 per image in 2x3 grid)
    const stitchedImages = [];
    const pagesPerImage = 6;
    const cols = 2;
    const rows = 3;

    for (let i = 0; i < pageImages.length; i += pagesPerImage) {
        const batch = pageImages.slice(i, i + pagesPerImage);

        // Create canvas for stitched image
        const stitchCanvas = document.createElement('canvas');
        const ctx = stitchCanvas.getContext('2d');

        // Load first image to get dimensions
        const firstImg = await loadImage(batch[0]);
        const cellWidth = firstImg.width;
        const cellHeight = firstImg.height;

        stitchCanvas.width = cellWidth * cols;
        stitchCanvas.height = cellHeight * rows;

        // Fill white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

        // Draw each page
        for (let j = 0; j < batch.length; j++) {
            const img = await loadImage(batch[j]);
            const col = j % cols;
            const row = Math.floor(j / cols);
            ctx.drawImage(img, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
        }

        stitchedImages.push(stitchCanvas.toDataURL('image/png'));
    }

    // Create PDF from stitched images
    const { jsPDF } = window.jspdf;
    const pdfDoc = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4'
    });

    for (let i = 0; i < stitchedImages.length; i++) {
        if (i > 0) pdfDoc.addPage();

        const img = await loadImage(stitchedImages[i]);
        const pdfWidth = pdfDoc.internal.pageSize.getWidth();
        const pdfHeight = pdfDoc.internal.pageSize.getHeight();

        // Calculate scaling to fit page
        const scale = Math.min(pdfWidth / img.width, pdfHeight / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;

        pdfDoc.addImage(stitchedImages[i], 'PNG', 0, 0, scaledWidth, scaledHeight);
    }

    const pdfBlob = pdfDoc.output('blob');
    return { blob: pdfBlob, images: stitchedImages };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
