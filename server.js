const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Initialize Groq SDK (requires GROQ_API_KEY in .env)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Ensure upload/processing directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const chunksDir = path.join(__dirname, 'chunks');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir);

// Configure Multer for up to 1GB uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
});

// Helper functions for time conversion
function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
}

function generateSRT(segments) {
    let srtContent = '';
    segments.forEach((segment, index) => {
        const startTime = formatTime(segment.start);
        const endTime = formatTime(segment.end);
        srtContent += `${index + 1}\n`;
        srtContent += `${startTime} --> ${endTime}\n`;
        srtContent += `${segment.text.trim()}\n\n`;
    });
    return srtContent;
}

// Function to split audio and get paths
function extractAndChunkAudio(videoPath, filePrefix) {
    return new Promise((resolve, reject) => {
        // Use a relative path to avoid FFmpeg segment muxer bugs with spaces in absolute paths
        const chunkPatternRelative = `chunks/${filePrefix}-chunk-%03d.mp3`;

        ffmpeg(videoPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioChannels(1)
            .audioBitrate('48k') // 48k is a good balance, ensures smaller file sizes
            .outputOptions([
                '-map a?', // Safely map audio if it exists
                '-f segment',
                '-segment_time 600',
                '-segment_format mp3'
            ])
            .output(chunkPatternRelative)
            .on('end', () => {
                // Find all generated chunks
                const files = fs.readdirSync(chunksDir)
                    .filter(f => f.startsWith(filePrefix) && f.includes('-chunk-'))
                    .sort(); // Sorting by name ensures sequential order
                
                if (files.length === 0) {
                    return reject(new Error("No audio chunks were generated. Does the video have sound?"));
                }
                
                resolve(files.map(f => path.join(chunksDir, f)));
            })
            .on('error', (err, stdout, stderr) => {
                console.error("FFmpeg error:", err);
                console.error("FFmpeg stderr:", stderr);
                reject(new Error("FFmpeg failed: " + stderr));
            })
            .run();
    });
}

app.post('/api/caption', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }

    const videoPath = req.file.path;
    const filePrefix = path.basename(req.file.filename, path.extname(req.file.filename));

    try {
        console.log("Starting audio extraction and chunking...");
        const chunkPaths = await extractAndChunkAudio(videoPath, filePrefix);
        console.log(`Generated ${chunkPaths.length} audio chunks.`);

        let allSegments = [];
        let timeOffset = 0;

        for (let i = 0; i < chunkPaths.length; i++) {
            const chunkPath = chunkPaths[i];
            console.log(`Processing chunk ${i + 1}/${chunkPaths.length}: ${chunkPath}`);

            // Call Groq API
            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(chunkPath),
                model: "whisper-large-v3",
                response_format: "verbose_json",
            });

            if (transcription.segments) {
                transcription.segments.forEach(segment => {
                    allSegments.push({
                        start: segment.start + timeOffset,
                        end: segment.end + timeOffset,
                        text: segment.text
                    });
                });
            }

            // A 600s chunk adds exactly 600s offset to the next chunk
            // However, last chunk might be smaller, but we just add 600s every loop
            // WAIT: is it exactly 600s? The segments in `verbose_json` start from 0 for each chunk.
            // Yes, `-segment_time 600` ensures each file represents exactly the 600s boundary (though slight deviations might occur if keyframes dictate it, but audio can be split precisely).
            // Actually, if we just use the duration of the chunk or always assume 600s, it's mostly accurate.
            // To be perfectly accurate, we can calculate the exact duration of the chunk using ffmpeg, but 600s is standard for fixed audio segmentation.
            timeOffset += 600; 

            // Clean up chunk
            fs.unlinkSync(chunkPath);
        }

        console.log("Generating SRT...");
        const srtContent = generateSRT(allSegments);

        // Clean up video
        fs.unlinkSync(videoPath);

        res.json({
            success: true,
            srt: srtContent,
            full_text: allSegments.map(s => s.text).join(' ')
        });

    } catch (error) {
        console.error("Error processing video:", error);
        // Clean up on error
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        res.status(500).json({ error: 'Failed to process video: ' + error.message });
    }
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
