const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const removeBtn = document.getElementById('remove-btn');
const generateBtn = document.getElementById('generate-btn');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');
const uploadCard = document.querySelector('.upload-card');
const resultCard = document.getElementById('result-card');
const srtPreview = document.getElementById('srt-preview');
const downloadSrtBtn = document.getElementById('download-srt');

let currentFile = null;
let generatedSrtContent = null;

// File Upload Handlers
browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/')) {
            handleFile(file);
        } else {
            alert('Please upload a valid video file.');
        }
    }
});

removeBtn.addEventListener('click', () => {
    currentFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    generateBtn.classList.add('hidden');
    dropZone.classList.remove('hidden');
});

function handleFile(file) {
    // Check if file is <= 1GB
    if (file.size > 1024 * 1024 * 1024) {
        alert('File size exceeds 1GB limit.');
        return;
    }
    
    currentFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    
    dropZone.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    generateBtn.classList.remove('hidden');
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Generate Captions
generateBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    const formData = new FormData();
    formData.append('video', currentFile);

    // UI Updates
    fileInfo.classList.add('hidden');
    generateBtn.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    
    // Animate progress to show it's working
    let progress = 0;
    const interval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 5;
            progressFill.style.width = `${Math.min(progress, 90)}%`;
            
            if (progress < 30) statusText.textContent = "Uploading video...";
            else if (progress < 60) statusText.textContent = "Extracting audio...";
            else statusText.textContent = "Generating AI captions...";
        }
    }, 1000);

    try {
        const response = await fetch('/api/caption', {
            method: 'POST',
            body: formData
        });

        clearInterval(interval);
        progressFill.style.width = '100%';
        statusText.textContent = "Finishing up...";

        const result = await response.json();
        
        if (response.ok) {
            generatedSrtContent = result.srt;
            showResult(result.srt);
        } else {
            throw new Error(result.error || 'Failed to generate captions');
        }
    } catch (error) {
        clearInterval(interval);
        alert(error.message);
        // Reset UI
        progressContainer.classList.add('hidden');
        fileInfo.classList.remove('hidden');
        generateBtn.classList.remove('hidden');
    }
});

function showResult(srt) {
    setTimeout(() => {
        uploadCard.classList.add('hidden');
        resultCard.classList.remove('hidden');
        srtPreview.textContent = srt;
    }, 500);
}

downloadSrtBtn.addEventListener('click', () => {
    if (!generatedSrtContent) return;
    
    const blob = new Blob([generatedSrtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") + '.srt' : 'captions.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});
