const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

/* =====================================================
   SERVER
===================================================== */

const PORT = process.env.PORT || 3000;

/* =====================================================
   PATHS
===================================================== */

const ROOT = __dirname;

const PUBLIC_DIR = path.join(ROOT, "public");

// Render filesystem is temporary.
// /tmp is appropriate for downloaded files.
const DOWNLOAD_DIR = path.join(
    "/tmp",
    "beatmate-downloads"
);

/* =====================================================
   PLATFORM
===================================================== */

const IS_WINDOWS = process.platform === "win32";

/* =====================================================
   EXECUTABLE PATHS
===================================================== */

/*
    Windows:
      bin/yt-dlp.exe
      bin/ffmpeg.exe

    Render/Linux:
      yt-dlp is installed using pip
      ffmpeg is copied into ./bin/ffmpeg
*/

const YTDLP = IS_WINDOWS
    ? path.join(ROOT, "bin", "yt-dlp.exe")
    : "yt-dlp";

const FFMPEG = IS_WINDOWS
    ? path.join(ROOT, "bin", "ffmpeg.exe")
    : path.join(ROOT, "bin", "ffmpeg");

/* =====================================================
   CREATE DOWNLOAD DIRECTORY
===================================================== */

try {
    fs.mkdirSync(DOWNLOAD_DIR, {
        recursive: true
    });
} catch (error) {
    console.error(
        "Could not create download directory:",
        error.message
    );
}

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use((req, res, next) => {
    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

/* =====================================================
   LOGGER
===================================================== */

app.use((req, res, next) => {
    console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.url}`
    );

    next();
});

/* =====================================================
   STATIC FRONTEND
===================================================== */

if (fs.existsSync(PUBLIC_DIR)) {
    app.use(
        express.static(PUBLIC_DIR)
    );
}

/* =====================================================
   YOUTUBE URL VALIDATION
===================================================== */

function isYouTubeUrl(value) {
    try {
        const url = new URL(value);

        const host =
            url.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        return (
            host === "youtube.com" ||
            host === "m.youtube.com" ||
            host === "youtu.be"
        );
    } catch {
        return false;
    }
}

/* =====================================================
   EXECUTABLE CHECK
===================================================== */

function checkExecutable(command) {
    return new Promise((resolve) => {
        let finished = false;

        const child = spawn(
            command,
            ["--version"],
            {
                windowsHide: IS_WINDOWS
            }
        );

        const finish = (result) => {
            if (finished) {
                return;
            }

            finished = true;
            resolve(result);
        };

        child.on("error", () => {
            finish(false);
        });

        child.on("close", (code) => {
            finish(code === 0);
        });
    });
}

/* =====================================================
   GET YT-DLP VERSION
===================================================== */

function getYtDlpVersion() {
    return new Promise((resolve) => {
        let output = "";
        let finished = false;

        const child = spawn(
            YTDLP,
            ["--version"],
            {
                windowsHide: IS_WINDOWS
            }
        );

        child.stdout.on("data", (data) => {
            output += data.toString();
        });

        const finish = (value) => {
            if (finished) {
                return;
            }

            finished = true;
            resolve(value);
        };

        child.on("error", () => {
            finish(null);
        });

        child.on("close", (code) => {
            if (code === 0) {
                finish(output.trim() || null);
            } else {
                finish(null);
            }
        });
    });
}

/* =====================================================
   GET FFMPEG VERSION
===================================================== */

function getFfmpegVersion() {
    return new Promise((resolve) => {
        let output = "";
        let finished = false;

        const child = spawn(
            FFMPEG,
            ["-version"],
            {
                windowsHide: IS_WINDOWS
            }
        );

        child.stdout.on("data", (data) => {
            output += data.toString();
        });

        const finish = (value) => {
            if (finished) {
                return;
            }

            finished = true;
            resolve(value);
        };

        child.on("error", () => {
            finish(null);
        });

        child.on("close", (code) => {
            if (code === 0) {
                const firstLine =
                    output
                        .trim()
                        .split("\n")[0];

                finish(firstLine || null);
            } else {
                finish(null);
            }
        });
    });
}

/* =====================================================
   RUN YT-DLP
===================================================== */

function runYtDlp(args) {
    return new Promise(
        (resolve, reject) => {

            const child = spawn(
                YTDLP,
                args,
                {
                    windowsHide: IS_WINDOWS
                }
            );

            let stdout = "";
            let stderr = "";

            child.stdout.on(
                "data",
                (data) => {
                    stdout += data.toString();
                }
            );

            child.stderr.on(
                "data",
                (data) => {
                    stderr += data.toString();
                }
            );

            child.on(
                "error",
                (error) => {
                    reject(error);
                }
            );

            child.on(
                "close",
                (code) => {

                    if (code === 0) {
                        resolve(stdout);
                        return;
                    }

                    reject(
                        new Error(
                            stderr.trim() ||
                            `yt-dlp exited with code ${code}`
                        )
                    );
                }
            );
        }
    );
}

/* =====================================================
   TEST API
===================================================== */

app.get(
    "/api/test",
    (req, res) => {

        res.json({
            success: true,
            message: "BEATMATE API is working",
            platform: process.platform,
            nodeVersion: process.version,
            port: PORT
        });
    }
);

/* =====================================================
   HEALTH API
===================================================== */

app.get(
    "/api/health",
    async (req, res) => {

        try {

            const ytDlpExists =
                await checkExecutable(YTDLP);

            const ffmpegExists =
                await checkExecutable(FFMPEG);

            let ytDlpVersion = null;
            let ffmpegVersion = null;

            if (ytDlpExists) {
                ytDlpVersion =
                    await getYtDlpVersion();
            }

            if (ffmpegExists) {
                ffmpegVersion =
                    await getFfmpegVersion();
            }

            return res.json({

                success: true,

                server: true,

                platform:
                    process.platform,

                nodeVersion:
                    process.version,

                ytDlp:
                    ytDlpExists,

                ytDlpVersion:
                    ytDlpVersion,

                ffmpeg:
                    ffmpegExists,

                ffmpegVersion:
                    ffmpegVersion,

                downloadDirectory:
                    DOWNLOAD_DIR

            });

        } catch (error) {

            console.error(
                "HEALTH ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,

                server: true,

                ytDlp: false,

                ffmpeg: false,

                error:
                    error.message

            });
        }
    }
);

/* =====================================================
   VIDEO INFO
===================================================== */

app.post(
    "/api/info",
    async (req, res) => {

        try {

            const url =
                String(
                    req.body.url || ""
                ).trim();

            console.log(
                "INFO REQUEST:",
                url
            );

            /* -----------------------------
               Validate URL
            ----------------------------- */

            if (!isYouTubeUrl(url)) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Please enter a valid YouTube URL."

                });
            }

            /* -----------------------------
               Check yt-dlp
            ----------------------------- */

            const ytDlpAvailable =
                await checkExecutable(YTDLP);

            if (!ytDlpAvailable) {

                return res.status(503).json({

                    success: false,

                    error:
                        "yt-dlp is not available on the server."

                });
            }

            /* -----------------------------
               Get information
            ----------------------------- */

            const output =
                await runYtDlp([

                    "--dump-single-json",

                    "--no-playlist",

                    "--skip-download",

                    "--no-warnings",

                    "--no-check-certificates",

                    url

                ]);

            if (!output.trim()) {

                throw new Error(
                    "yt-dlp returned empty information."
                );
            }

            let info;

            try {

                info =
                    JSON.parse(
                        output
                    );

            } catch {

                throw new Error(
                    "Could not parse yt-dlp response."
                );
            }

            return res.json({

                success: true,

                id:
                    info.id || "",

                title:
                    info.title ||
                    "YouTube Video",

                channel:
                    info.uploader ||
                    info.channel ||
                    "YouTube",

                thumbnail:
                    info.thumbnail ||
                    "",

                duration:
                    info.duration ||
                    0,

                url:
                    info.webpage_url ||
                    url

            });

        } catch (error) {

            console.error(
                "INFO ERROR:",
                error.message
            );

            const message =
                error.message || "";

            /* -----------------------------
               YouTube bot detection
            ----------------------------- */

            if (
                message.includes(
                    "Sign in to confirm"
                ) ||
                message.includes(
                    "not a bot"
                )
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "YouTube is currently requiring verification for this request. Please try another video later."

                });
            }

            return res.status(500).json({

                success: false,

                error:
                    message ||
                    "Unable to get video information."

            });
        }
    }
);

/* =====================================================
   DOWNLOAD JOBS
===================================================== */

const jobs = {};

/* =====================================================
   GENERATE JOB ID
===================================================== */

function createJobId() {

    return (
        Date.now() +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 10)
    );
}

/* =====================================================
   START DOWNLOAD
===================================================== */

app.post(
    "/api/download/start",
    async (req, res) => {

        try {

            const url =
                String(
                    req.body.url || ""
                ).trim();

            const type =
                String(
                    req.body.type || "video"
                );

            const quality =
                String(
                    req.body.quality || "best"
                );

            console.log(
                "DOWNLOAD REQUEST"
            );

            console.log(
                "URL:",
                url
            );

            console.log(
                "TYPE:",
                type
            );

            console.log(
                "QUALITY:",
                quality
            );

            /* -----------------------------
               Validate URL
            ----------------------------- */

            if (!isYouTubeUrl(url)) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid YouTube URL."

                });
            }

            /* -----------------------------
               Validate type
            ----------------------------- */

            if (
                type !== "video" &&
                type !== "audio"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid download type."

                });
            }

            /* -----------------------------
               Check yt-dlp
            ----------------------------- */

            const ytDlpAvailable =
                await checkExecutable(YTDLP);

            if (!ytDlpAvailable) {

                return res.status(503).json({

                    success: false,

                    error:
                        "yt-dlp is not available on the server."

                });
            }

            /* -----------------------------
               Check FFmpeg
            ----------------------------- */

            const ffmpegAvailable =
                await checkExecutable(FFMPEG);

            if (!ffmpegAvailable) {

                return res.status(503).json({

                    success: false,

                    error:
                        "FFmpeg is not available on the server."

                });
            }

            /* -----------------------------
               Job ID
            ----------------------------- */

            const jobId =
                createJobId();

            /* -----------------------------
               Output file
            ----------------------------- */

            const output =
                path.join(
                    DOWNLOAD_DIR,
                    `${jobId}-%(title)s.%(ext)s`
                );

            /* -----------------------------
               Select format
            ----------------------------- */

            let format;

            if (type === "audio") {

                format =
                    "bestaudio/best";

            } else {

                switch (quality) {

                    case "1080":

                        format =
                            "bestvideo[height<=1080]+bestaudio/best";

                        break;

                    case "720":

                        format =
                            "bestvideo[height<=720]+bestaudio/best";

                        break;

                    case "480":

                        format =
                            "bestvideo[height<=480]+bestaudio/best";

                        break;

                    case "360":

                        format =
                            "bestvideo[height<=360]+bestaudio/best";

                        break;

                    default:

                        format =
                            "bestvideo*+bestaudio/best";

                        break;
                }
            }

            /* -----------------------------
               yt-dlp arguments
            ----------------------------- */

            const args = [

                "--no-playlist",

                "--newline",

                "--progress",

                "--no-warnings",

                "--no-check-certificates",

                "--ffmpeg-location",
                FFMPEG,

                "-f",
                format,

                "-o",
                output

            ];

            /* -----------------------------
               Audio options
            ----------------------------- */

            if (type === "audio") {

                args.push(

                    "-x",

                    "--audio-format",
                    "mp3",

                    "--audio-quality",
                    "192K"

                );

            } else {

                /* -------------------------
                   Video options
                ------------------------- */

                args.push(

                    "--merge-output-format",
                    "mp4"

                );
            }

            /* -----------------------------
               URL must be last
            ----------------------------- */

            args.push(url);

            /* -----------------------------
               Create job
            ----------------------------- */

            jobs[jobId] = {

                progress: 0,

                status:
                    "Starting...",

                speed: "",

                finished: false,

                file: null,

                error: null

            };

            console.log(
                "JOB STARTED:",
                jobId
            );

            /* -----------------------------
               Start yt-dlp
            ----------------------------- */

            const child =
                spawn(
                    YTDLP,
                    args,
                    {
                        windowsHide:
                            IS_WINDOWS
                    }
                );

            child.stdout.on(
                "data",
                (data) => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            child.stderr.on(
                "data",
                (data) => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            child.on(
                "error",
                (error) => {

                    console.error(
                        "PROCESS ERROR:",
                        error.message
                    );

                    if (!jobs[jobId]) {
                        return;
                    }

                    jobs[jobId].error =
                        error.message;

                    jobs[jobId].status =
                        "Failed";

                    jobs[jobId].finished =
                        true;
                }
            );

            child.on(
                "close",
                (code) => {

                    console.log(
                        "YT-DLP EXIT:",
                        code
                    );

                    const job =
                        jobs[jobId];

                    if (!job) {
                        return;
                    }

                    if (code !== 0) {

                        job.error =
                            "yt-dlp download failed. YouTube may be requiring verification.";

                        job.status =
                            "Failed";

                        job.finished =
                            true;

                        return;
                    }

                    /* -------------------------
                       Find downloaded file
                    ------------------------- */

                    let files;

                    try {

                        files =
                            fs.readdirSync(
                                DOWNLOAD_DIR
                            );

                    } catch (error) {

                        job.error =
                            error.message;

                        job.status =
                            "Failed";

                        job.finished =
                            true;

                        return;
                    }

                    const fileName =
                        files.find(
                            (file) =>
                                file.startsWith(
                                    jobId + "-"
                                )
                        );

                    if (!fileName) {

                        job.error =
                            "Downloaded file was not found.";

                        job.status =
                            "Failed";

                        job.finished =
                            true;

                        return;
                    }

                    /* -------------------------
                       Complete
                    ------------------------- */

                    job.progress = 100;

                    job.status =
                        "Completed";

                    job.file =
                        fileName;

                    job.finished =
                        true;

                    console.log(
                        "DOWNLOAD COMPLETE:",
                        fileName
                    );
                }
            );

            /* -----------------------------
               Return job ID immediately
            ----------------------------- */

            return res.json({

                success: true,

                jobId:
                    jobId

            });

        } catch (error) {

            console.error(
                "DOWNLOAD ERROR:",
                error.message
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message

            });
        }
    }
);

/* =====================================================
   UPDATE PROGRESS
===================================================== */

function updateProgress(
    jobId,
    text
) {

    const job =
        jobs[jobId];

    if (!job) {
        return;
    }

    const clean =
        text.trim();

    if (clean) {

        console.log(
            `[${jobId}]`,
            clean
        );
    }

    /* -----------------------------
       Percentage
    ----------------------------- */

    const percentMatch =
        text.match(
            /(\d+(?:\.\d+)?)%/
        );

    if (percentMatch) {

        const percent =
            parseFloat(
                percentMatch[1]
            );

        job.progress =
            Math.min(
                99,
                Math.max(
                    0,
                    Math.round(percent)
                )
            );

        job.status =
            "Downloading...";
    }

    /* -----------------------------
       Speed
    ----------------------------- */

    const speedMatch =
        text.match(
            /\bat\s+([^\s]+)/i
        );

    if (speedMatch) {

        job.speed =
            speedMatch[1];
    }

    /* -----------------------------
       Merging
    ----------------------------- */

    const lower =
        text.toLowerCase();

    if (
        lower.includes("merging") ||
        lower.includes("merging formats")
    ) {

        job.status =
            "Merging video and audio...";
    }

    /* -----------------------------
       Post processing
    ----------------------------- */

    if (
        lower.includes(
            "post-process"
        )
    ) {

        job.status =
            "Processing...";
    }

    /* -----------------------------
       Finalizing
    ----------------------------- */

    if (
        lower.includes(
            "deleting original"
        )
    ) {

        job.status =
            "Finalizing...";
    }
}

/* =====================================================
   DOWNLOAD STATUS
===================================================== */

app.get(
    "/api/download/status/:jobId",
    (req, res) => {

        const job =
            jobs[
                req.params.jobId
            ];

        if (!job) {

            return res.status(404).json({

                success: false,

                error:
                    "Download job not found."

            });
        }

        return res.json({

            success: true,

            progress:
                job.progress,

            status:
                job.status,

            speed:
                job.speed,

            finished:
                job.finished,

            error:
                job.error

        });
    }
);

/* =====================================================
   DOWNLOAD FILE
===================================================== */

app.get(
    "/api/download/file/:jobId",
    (req, res) => {

        const job =
            jobs[
                req.params.jobId
            ];

        if (!job) {

            return res.status(404).send(
                "Download job not found."
            );
        }

        if (!job.finished) {

            return res.status(400).send(
                "Download is not finished."
            );
        }

        if (job.error) {

            return res.status(500).send(
                job.error
            );
        }

        if (!job.file) {

            return res.status(404).send(
                "Downloaded file not found."
            );
        }

        const filePath =
            path.join(
                DOWNLOAD_DIR,
                job.file
            );

        /* -----------------------------
           Security check
        ----------------------------- */

        const resolvedDownload =
            path.resolve(
                DOWNLOAD_DIR
            );

        const resolvedFile =
            path.resolve(
                filePath
            );

        if (
            !resolvedFile.startsWith(
                resolvedDownload +
                path.sep
            )
        ) {

            return res.status(403).send(
                "Invalid file path."
            );
        }

        /* -----------------------------
           Check file
        ----------------------------- */

        if (!fs.existsSync(filePath)) {

            return res.status(404).send(
                "File no longer exists."
            );
        }

        console.log(
            "SENDING FILE:",
            job.file
        );

        res.download(
            filePath,
            job.file,
            (error) => {

                if (error) {

                    console.error(
                        "SEND ERROR:",
                        error.message
                    );
                }

                /* -------------------------
                   Delete temporary file
                ------------------------- */

                fs.unlink(
                    filePath,
                    () => {}
                );

                /* -------------------------
                   Delete job
                ------------------------- */

                delete jobs[
                    req.params.jobId
                ];
            }
        );
    }
);

/* =====================================================
   HOME PAGE
===================================================== */

app.get(
    "/",
    (req, res) => {

        const indexPath =
            path.join(
                PUBLIC_DIR,
                "index.html"
            );

        if (
            !fs.existsSync(indexPath)
        ) {

            return res.status(404).send(
                "index.html not found inside public folder."
            );
        }

        res.sendFile(
            indexPath
        );
    }
);

/* =====================================================
   UNKNOWN API
===================================================== */

app.use(
    (req, res) => {

        console.log(
            "UNKNOWN REQUEST:",
            req.method,
            req.url
        );

        if (
            req.url.startsWith("/api/")
        ) {

            return res.status(404).json({

                success: false,

                error:
                    "API endpoint not found.",

                requested:
                    `${req.method} ${req.url}`

            });
        }

        return res.status(404).send(
            "BEATMATE page not found."
        );
    }
);

/* =====================================================
   CLEANUP OLD FILES
===================================================== */

function cleanupOldFiles() {

    try {

        if (
            !fs.existsSync(
                DOWNLOAD_DIR
            )
        ) {
            return;
        }

        const files =
            fs.readdirSync(
                DOWNLOAD_DIR
            );

        const now =
            Date.now();

        const MAX_AGE =
            60 * 60 * 1000;

        for (
            const file of files
        ) {

            const filePath =
                path.join(
                    DOWNLOAD_DIR,
                    file
                );

            try {

                const stats =
                    fs.statSync(
                        filePath
                    );

                if (
                    now -
                    stats.mtimeMs >
                    MAX_AGE
                ) {

                    fs.unlinkSync(
                        filePath
                    );

                    console.log(
                        "Cleaned old file:",
                        file
                    );
                }

            } catch {
                // Ignore individual files
            }
        }

    } catch (error) {

        console.error(
            "CLEANUP ERROR:",
            error.message
        );
    }
}

/* =====================================================
   START SERVER
===================================================== */

app.listen(
    PORT,
    "0.0.0.0",
    async () => {

        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            "          BEATMATE SERVER"
        );
        console.log(
            "======================================"
        );
        console.log("");

        console.log(
            "Platform:",
            process.platform
        );

        console.log(
            "Node:",
            process.version
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Download directory:",
            DOWNLOAD_DIR
        );

        console.log("");

        console.log(
            "yt-dlp:",
            YTDLP
        );

        console.log(
            "FFmpeg:",
            FFMPEG
        );

        console.log("");

        const ytDlpOK =
            await checkExecutable(
                YTDLP
            );

        const ffmpegOK =
            await checkExecutable(
                FFMPEG
            );

        console.log(
            "yt-dlp available:",
            ytDlpOK
        );

        console.log(
            "FFmpeg available:",
            ffmpegOK
        );

        if (ytDlpOK) {

            console.log(
                "yt-dlp version:",
                await getYtDlpVersion()
            );
        }

        if (ffmpegOK) {

            console.log(
                "FFmpeg version:",
                await getFfmpegVersion()
            );
        }

        console.log("");

        console.log(
            "Server ready."
        );

        console.log("");
    }
);

/* =====================================================
   PERIODIC CLEANUP
===================================================== */

setInterval(
    cleanupOldFiles,
    15 * 60 * 1000
);
