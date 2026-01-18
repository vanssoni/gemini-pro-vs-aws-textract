// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadButton = document.getElementById('uploadButton');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeButton = document.getElementById('removeButton');
const processButton = document.getElementById('processButton');
const uploadSection = document.getElementById('uploadSection');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const newUploadButton = document.getElementById('newUploadButton');

const geminiText = document.getElementById('geminiText');
const geminiTime = document.getElementById('geminiTime');
const geminiCharCount = document.getElementById('geminiCharCount');
const copyGemini = document.getElementById('copyGemini');

const textractText = document.getElementById('textractText');
const textractTime = document.getElementById('textractTime');
const textractCharCount = document.getElementById('textractCharCount');
const copyTextract = document.getElementById('copyTextract');

let selectedFile = null;

// Event Listeners
uploadButton.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});
fileInput.addEventListener('change', handleFileSelect);
removeButton.addEventListener('click', clearFile);
processButton.addEventListener('click', processFile);
newUploadButton.addEventListener('click', resetToUpload);

// Drag and Drop
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

dropzone.addEventListener('click', (e) => {
    // Don't trigger if clicking on the button
    if (e.target !== uploadButton && !uploadButton.contains(e.target)) {
        fileInput.click();
    }
});

// Copy buttons
copyGemini.addEventListener('click', () => copyToClipboard(geminiText.textContent, copyGemini));
copyTextract.addEventListener('click', () => copyToClipboard(textractText.textContent, copyTextract));

// Functions
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert('Please select a PDF file');
        return;
    }

    if (file.size > 20 * 1024 * 1024) {
        alert('File size must be less than 20MB');
        return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);

    dropzone.style.display = 'none';
    fileInfo.style.display = 'block';
}

function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropzone.style.display = 'block';
    fileInfo.style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function processFile() {
    if (!selectedFile) return;

    // Show loading briefly
    uploadSection.style.display = 'none';
    loadingSection.style.display = 'block';
    resultsSection.style.display = 'none';

    // Show results section immediately
    setTimeout(() => {
        loadingSection.style.display = 'none';
        resultsSection.style.display = 'block';
    }, 100);

    // Reset results to loading state
    geminiText.innerHTML = '<p class="placeholder-text">Processing with Gemini...</p>';
    textractText.innerHTML = '<p class="placeholder-text">Processing with Textract...</p>';
    geminiTime.querySelector('.time-value').textContent = '...';
    textractTime.querySelector('.time-value').textContent = '...';

    try {
        // Step 1: Get presigned URL
        const presignedResponse = await fetch('/api/upload/presigned-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: selectedFile.name,
                contentType: selectedFile.type
            })
        });

        if (!presignedResponse.ok) {
            throw new Error('Failed to get upload URL');
        }

        const { uploadUrl, key } = await presignedResponse.json();

        // Step 2: Upload directly to S3
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: selectedFile,
            headers: {
                'Content-Type': selectedFile.type
            }
        });

        if (!uploadResponse.ok) {
            throw new Error('Failed to upload file to S3');
        }

        // Step 3: Process with both services in parallel
        const geminiPromise = fetch('/api/extract/gemini-s3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key })
        }).then(res => res.json()).then(data => {
            displayGeminiResult(data);
        }).catch(error => {
            console.error('Gemini request error:', error);
            displayGeminiResult({
                success: false,
                error: error.message
            });
        });

        const textractPromise = fetch('/api/extract/textract-s3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ key })
        }).then(res => res.json()).then(data => {
            displayTextractResult(data);
        }).catch(error => {
            console.error('Textract request error:', error);
            displayTextractResult({
                success: false,
                error: error.message
            });
        });

        // Wait for both to complete
        await Promise.allSettled([geminiPromise, textractPromise]);

    } catch (error) {
        console.error('Upload error:', error);
        displayGeminiResult({
            success: false,
            error: 'Upload failed: ' + error.message
        });
        displayTextractResult({
            success: false,
            error: 'Upload failed: ' + error.message
        });
    }
}

function displayGeminiResult(data) {
    if (!data.success || data.error) {
        geminiText.innerHTML = `<p style="color: #f5576c;">Error: ${data.error || 'Processing failed'}</p>`;
        geminiTime.querySelector('.time-value').textContent = 'Failed';
        geminiTime.querySelector('.time-value').style.color = '#f5576c';
        geminiCharCount.textContent = '0 characters';
    } else {
        geminiText.textContent = data.text || 'No text extracted';
        geminiTime.querySelector('.time-value').textContent = formatTime(data.time);
        geminiTime.querySelector('.time-value').style.color = '#48bb78';
        geminiCharCount.textContent = `${data.text.length.toLocaleString()} characters`;
    }
}

function displayTextractResult(data) {
    if (!data.success || data.error) {
        textractText.innerHTML = `<p style="color: #f5576c;">Error: ${data.error || 'Processing failed'}</p>`;
        textractTime.querySelector('.time-value').textContent = 'Failed';
        textractTime.querySelector('.time-value').style.color = '#f5576c';
        textractCharCount.textContent = '0 characters';
    } else {
        textractText.textContent = data.text || 'No text extracted';
        textractTime.querySelector('.time-value').textContent = formatTime(data.time);
        textractTime.querySelector('.time-value').style.color = '#48bb78';
        textractCharCount.textContent = `${data.text.length.toLocaleString()} characters`;
    }
}



function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function resetToUpload() {
    clearFile();
    uploadSection.style.display = 'block';
    loadingSection.style.display = 'none';
    resultsSection.style.display = 'none';

    // Reset results
    geminiText.innerHTML = '<p class="placeholder-text">Extracted text will appear here...</p>';
    textractText.innerHTML = '<p class="placeholder-text">Extracted text will appear here...</p>';
    geminiTime.querySelector('.time-value').textContent = '-';
    textractTime.querySelector('.time-value').textContent = '-';
    geminiCharCount.textContent = '0 characters';
    textractCharCount.textContent = '0 characters';
}

async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);

        const originalHTML = button.innerHTML;
        button.innerHTML = '<span class="copy-icon">✓</span><span>Copied!</span>';
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
        alert('Failed to copy text to clipboard');
    }
}
