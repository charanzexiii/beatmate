const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

/* =====================================================
   SERVER PORT
===================================================== */

const PORT = process.env.PORT || 3000;

/* =====================================================
   PATHS
===================================================== */

const ROOT = __dirname;

const PUBLIC_DIR = path.join(
    ROOT,
    "public"
);

const DOWNLOAD_DIR = path.join(
    ROOT,
    "downloads"
);

/* =====================================================
   PLATFORM / DOWNLOADER
===================================================== */

const IS_WINDOWS =
    process.platform === "win32";

/*
 * Windows:
 *   Use files from /bin
 *
 * Render/Linux:
 *   Use yt-dlp and ffmpeg installed in PATH
 */

const YTDLP = IS_WINDOWS
    ? path.join(
        ROOT,
        "bin",
        "yt-dlp.exe"
    )
    : "yt-dlp";

const FFMPEG = IS_WINDOWS
    ? path.join(
        ROOT,
        "bin",
        "ffmpeg.exe"
    )
    : "ffmpeg";

/* =====================================================
   CREATE DOWNLOAD FOLDER
===================================================== */

if (!fs.existsSync(DOWNLOAD_DIR)) {

    fs.mkdirSync(
        DOWNLOAD_DIR,
        {
            recursive: true
        }
    );

}

/* =====================================================
   CORS
===================================================== */

app.use(
    (req, res, next) => {

        res.header(
            "Access-Control-Allow-Origin",
            "*"
        );

        res.header(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,DELETE,OPTIONS"
        );

        res.header(
            "Access-Control-Allow-Headers",
            "Content-Type"
        );

        if (req.method === "OPTIONS") {
            return res.sendStatus(200);
        }

        next();

    }
);

/* =====================================================
   EXPRESS
===================================================== */

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
   REQUEST LOGGER
===================================================== */

app.use(
    (req, res, next) => {

        console.log(
            new Date().toLocaleTimeString(),
            req.method,
            req.url
        );

        next();

    }
);

/* =====================================================
   FRONTEND
===================================================== */

app.use(
    express.static(
        PUBLIC_DIR
    )
);

/* =====================================================
   YOUTUBE URL CHECK
===================================================== */

function isYouTubeUrl(value) {

    try {

        const url = new URL(value);

        const host =
            url.hostname.toLowerCase();

        return (
            host === "youtube.com" ||
            host === "www.youtube.com" ||
            host === "m.youtube.com" ||
            host === "youtu.be" ||
            host === "www.youtu.be"
        );

    }

    catch {

        return false;

    }

}

/* =====================================================
   CHECK EXECUTABLE
===================================================== */

function checkExecutable(command) {

    return new Promise(
        (resolve) => {

            const child =
                spawn(
                    command,
                    ["--version"],
                    IS_WINDOWS
                        ? {
                            windowsHide: true
                        }
                        : {}
                );

            let finished = false;

            child.on(
                "error",
                () => {

                    if (!finished) {

                        finished = true;
                        resolve(false);

                    }

                }
            );

            child.on(
                "close",
                code => {

                    if (!finished) {

                        finished = true;

                        resolve(
                            code === 0
                        );

                    }

                }
            );

        }
    );

}

/* =====================================================
   RUN YT-DLP
===================================================== */

function runYtDlp(args) {

    return new Promise(
        (resolve, reject) => {

            /*
             * On Windows check that the file exists.
             *
             * On Linux/Render, yt-dlp is expected
             * to be available in PATH.
             */

            if (IS_WINDOWS) {

                if (!fs.existsSync(YTDLP)) {

                    reject(
                        new Error(
                            "yt-dlp.exe not found in bin folder."
                        )
                    );

                    return;

                }

            }

            const child =
                spawn(
                    YTDLP,
                    args,
                    IS_WINDOWS
                        ? {
                            windowsHide: true
                        }
                        : {}
                );

            let stdout = "";

            let stderr = "";

            child.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();

                }
            );

            child.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

                }
            );

            child.on(
                "error",
                error => {

                    reject(error);

                }
            );

            child.on(
                "close",
                code => {

                    if (code === 0) {

                        resolve(
                            stdout
                        );

                    }

                    else {

                        reject(
                            new Error(
                                stderr ||
                                `yt-dlp exited with code ${code}`
                            )
                        );

                    }

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

            message:
                "BEATMATE API is working",

            platform:
                process.platform,

            port:
                PORT

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
                await checkExecutable(
                    YTDLP
                );

            const ffmpegExists =
                await checkExecutable(
                    FFMPEG
                );

            let version =
                "Unavailable";

            if (ytDlpExists) {

                try {

                    const output =
                        await runYtDlp([
                            "--version"
                        ]);

                    version =
                        output.trim();

                }

                catch {

                    version =
                        "Unavailable";

                }

            }

            return res.json({

                success: true,

                server: true,

                platform:
                    process.platform,

                version:
                    version,

                ytDlp:
                    ytDlpExists,

                ffmpeg:
                    ffmpegExists

            });

        }

        catch (error) {

            return res
                .status(500)
                .json({

                    success: false,

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
                    req.body.url ||
                    ""
                ).trim();

            console.log(
                "Getting video:",
                url
            );

            if (!isYouTubeUrl(url)) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Please enter a valid YouTube URL."

                    });

            }

            const output =
                await runYtDlp([

                    "--dump-single-json",

                    "--no-playlist",

                    "--skip-download",

                    "--no-warnings",

                    url

                ]);

            if (!output.trim()) {

                throw new Error(
                    "yt-dlp returned empty information."
                );

            }

            const info =
                JSON.parse(output);

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

                url:
                    info.webpage_url ||
                    url

            });

        }

        catch (error) {

            console.error(
                "INFO ERROR:",
                error.message
            );

            return res
                .status(500)
                .json({

                    success: false,

                    error:
                        error.message

                });

        }

    }
);

/* =====================================================
   DOWNLOAD JOBS
===================================================== */

const jobs = {};

/* =====================================================
   START DOWNLOAD
===================================================== */

app.post(
    "/api/download/start",
    async (req, res) => {

        try {

            const url =
                String(
                    req.body.url ||
                    ""
                ).trim();

            const type =
                req.body.type ||
                "video";

            const quality =
                req.body.quality ||
                "best";

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

            /* =========================================
               VALIDATION
            ========================================= */

            if (!isYouTubeUrl(url)) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Invalid YouTube URL."

                    });

            }

            if (
                type !== "video" &&
                type !== "audio"
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Invalid download type."

                    });

            }

            /* =========================================
               CHECK YT-DLP
            ========================================= */

            const ytDlpAvailable =
                await checkExecutable(
                    YTDLP
                );

            if (!ytDlpAvailable) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        error:
                            "yt-dlp is not installed or cannot be executed."

                    });

            }

            /* =========================================
               CHECK FFMPEG
            ========================================= */

            const ffmpegAvailable =
                await checkExecutable(
                    FFMPEG
                );

            if (!ffmpegAvailable) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        error:
                            "FFmpeg is not installed or cannot be executed."

                    });

            }

            /* =========================================
               JOB ID
            ========================================= */

            const jobId =
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .substring(2, 10);

            /* =========================================
               OUTPUT
            ========================================= */

            const output =
                path.join(
                    DOWNLOAD_DIR,
                    `${jobId}-%(title)s.%(ext)s`
                );

            /* =========================================
               FORMAT
            ========================================= */

            let format;

            if (type === "audio") {

                format =
                    "bestaudio/best";

            }

            else {

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

            /* =========================================
               YT-DLP ARGUMENTS
            ========================================= */

            const args = [

                "--no-playlist",

                "--newline",

                "--progress",

                "--ffmpeg-location",
                FFMPEG,

                "-f",
                format,

                "-o",
                output

            ];

            /* =========================================
               AUDIO
            ========================================= */

            if (type === "audio") {

                args.push(

                    "-x",

                    "--audio-format",
                    "mp3",

                    "--audio-quality",
                    "192K"

                );

            }

            /* =========================================
               VIDEO
            ========================================= */

            else {

                args.push(

                    "--merge-output-format",
                    "mp4"

                );

            }

            /* =========================================
               URL LAST
            ========================================= */

            args.push(url);

            /* =========================================
               CREATE JOB
            ========================================= */

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
                "JOB:",
                jobId
            );

            /* =========================================
               START YT-DLP
            ========================================= */

            const child =
                spawn(
                    YTDLP,
                    args,
                    IS_WINDOWS
                        ? {
                            windowsHide: true
                        }
                        : {}
                );

            child.stdout.on(
                "data",
                data => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            child.stderr.on(
                "data",
                data => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            child.on(
                "error",
                error => {

                    console.error(
                        "PROCESS ERROR:",
                        error.message
                    );

                    if (jobs[jobId]) {

                        jobs[jobId].error =
                            error.message;

                        jobs[jobId].status =
                            "Failed";

                        jobs[jobId].finished =
                            true;

                    }

                }
            );

            child.on(
                "close",
                code => {

                    console.log(
                        "YT-DLP EXIT:",
                        code
                    );

                    if (!jobs[jobId]) {
                        return;
                    }

                    if (code !== 0) {

                        jobs[jobId].error =
                            "yt-dlp download failed.";

                        jobs[jobId].status =
                            "Failed";

                        jobs[jobId].finished =
                            true;

                        return;

                    }

                    /* =================================
                       FIND FILE
                    ================================= */

                    let files = [];

                    try {

                        files =
                            fs.readdirSync(
                                DOWNLOAD_DIR
                            );

                    }

                    catch (error) {

                        jobs[jobId].error =
                            error.message;

                        jobs[jobId].status =
                            "Failed";

                        jobs[jobId].finished =
                            true;

                        return;

                    }

                    const fileName =
                        files.find(
                            file =>
                                file.startsWith(
                                    jobId + "-"
                                )
                        );

                    if (!fileName) {

                        jobs[jobId].error =
                            "Downloaded file was not found.";

                        jobs[jobId].status =
                            "Failed";

                        jobs[jobId].finished =
                            true;

                        return;

                    }

                    jobs[jobId].progress =
                        100;

                    jobs[jobId].status =
                        "Completed";

                    jobs[jobId].file =
                        fileName;

                    jobs[jobId].finished =
                        true;

                    console.log(
                        "DOWNLOAD COMPLETE:",
                        fileName
                    );

                }
            );

            /* =========================================
               SEND JOB ID
            ========================================= */

            return res.json({

                success: true,

                jobId:
                    jobId

            });

        }

        catch (error) {

            console.error(
                "DOWNLOAD ERROR:",
                error.message
            );

            return res
                .status(500)
                .json({

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
            jobId,
            clean
        );

    }

    /* =========================================
       PERCENTAGE
    ========================================= */

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

    /* =========================================
       SPEED
    ========================================= */

    const speedMatch =
        text.match(
            /\bat\s+([^\s]+)/i
        );

    if (speedMatch) {

        job.speed =
            speedMatch[1];

    }

    /* =========================================
       MERGING
    ========================================= */

    if (
        text.toLowerCase()
            .includes("merging")
    ) {

        job.status =
            "Merging video and audio...";

    }

    /* =========================================
       FINALIZING
    ========================================= */

    if (
        text.toLowerCase()
            .includes("deleting original")
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

            return res
                .status(404)
                .json({

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
   SEND FILE
===================================================== */

app.get(
    "/api/download/file/:jobId",
    (req, res) => {

        const job =
            jobs[
                req.params.jobId
            ];

        if (!job) {

            return res
                .status(404)
                .send(
                    "Download job not found."
                );

        }

        if (!job.finished) {

            return res
                .status(400)
                .send(
                    "Download is not finished."
                );

        }

        if (job.error) {

            return res
                .status(500)
                .send(
                    job.error
                );

        }

        if (!job.file) {

            return res
                .status(404)
                .send(
                    "Downloaded file not found."
                );

        }

        const filePath =
            path.join(
                DOWNLOAD_DIR,
                job.file
            );

        if (!fs.existsSync(filePath)) {

            return res
                .status(404)
                .send(
                    "File no longer exists."
                );

        }

        console.log(
            "SENDING:",
            job.file
        );

        res.download(
            filePath,
            job.file,
            error => {

                if (error) {

                    console.error(
                        "SEND ERROR:",
                        error.message
                    );

                }

                /* Delete downloaded file */

                fs.unlink(
                    filePath,
                    () => {}
                );

                /* Delete job */

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

        if (!fs.existsSync(indexPath)) {

            return res
                .status(404)
                .send(
                    "index.html not found inside public folder."
                );

        }

        res.sendFile(indexPath);

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

            return res
                .status(404)
                .json({

                    success: false,

                    error:
                        "API endpoint not found.",

                    requested:
                        req.method +
                        " " +
                        req.url

                });

        }

        return res
            .status(404)
            .send(
                "BEATMATE page not found."
            );

    }
);

/* =====================================================
   START SERVER
===================================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

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
            "Port:",
            PORT
        );

        console.log("");

        console.log(
            "Website:"
        );

        console.log(
            `http://localhost:${PORT}`
        );

        console.log("");

        console.log(
            "Test API:"
        );

        console.log(
            `http://localhost:${PORT}/api/test`
        );

        console.log("");

        console.log(
            "Health API:"
        );

        console.log(
            `http://localhost:${PORT}/api/health`
        );

        console.log("");

        console.log(
            "yt-dlp:",
            IS_WINDOWS
                ? YTDLP
                : "PATH: yt-dlp"
        );

        console.log(
            "FFmpeg:",
            IS_WINDOWS
                ? FFMPEG
                : "PATH: ffmpeg"
        );

        console.log("");

    }
);
