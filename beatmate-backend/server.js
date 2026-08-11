const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const app = express();

/* =====================================================
   SERVER
===================================================== */

const PORT = Number(process.env.PORT) || 3000;

const IS_WINDOWS = process.platform === "win32";

/* =====================================================
   PATHS
===================================================== */

const ROOT = __dirname;

const PUBLIC_DIR = path.join(
    ROOT,
    "public"
);

/*
 * Render has an ephemeral filesystem.
 *
 * Linux / Render:
 *     /tmp/beatmate-downloads
 *
 * Windows:
 *     local downloads folder
 */

const DOWNLOAD_DIR = IS_WINDOWS
    ? path.join(ROOT, "downloads")
    : path.join(
        os.tmpdir(),
        "beatmate-downloads"
    );

/*
 * FFmpeg
 *
 * Render:
 *     ./bin/ffmpeg
 *
 * Windows:
 *     ./bin/ffmpeg.exe
 */

const FFMPEG = IS_WINDOWS
    ? path.join(
        ROOT,
        "bin",
        "ffmpeg.exe"
    )
    : path.join(
        ROOT,
        "bin",
        "ffmpeg"
    );

/*
 * yt-dlp
 *
 * Render:
 *     installed by pip
 *     available in PATH
 *
 * Windows:
 *     local executable
 */

const YTDLP = IS_WINDOWS
    ? path.join(
        ROOT,
        "bin",
        "yt-dlp.exe"
    )
    : "yt-dlp";

/* =====================================================
   CREATE DOWNLOAD DIRECTORY
===================================================== */

try {
    fs.mkdirSync(
        DOWNLOAD_DIR,
        {
            recursive: true
        }
    );

    console.log(
        "Download directory:",
        DOWNLOAD_DIR
    );
} catch (error) {
    console.error(
        "DOWNLOAD DIRECTORY ERROR:",
        error.message
    );
}

/* =====================================================
   EXPRESS
===================================================== */

app.disable(
    "x-powered-by"
);

app.use(
    express.json({
        limit: "1mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "1mb"
    })
);

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

        if (
            req.method === "OPTIONS"
        ) {
            return res.sendStatus(
                204
            );
        }

        next();
    }
);

/* =====================================================
   REQUEST LOGGER
===================================================== */

app.use(
    (req, res, next) => {

        console.log(
            new Date().toISOString(),
            req.method,
            req.url
        );

        next();
    }
);

/* =====================================================
   FRONTEND
===================================================== */

if (
    fs.existsSync(
        PUBLIC_DIR
    )
) {
    app.use(
        express.static(
            PUBLIC_DIR
        )
    );
}

/* =====================================================
   YOUTUBE URL CHECK
===================================================== */

function isYouTubeUrl(value) {

    try {

        const url =
            new URL(value);

        const host =
            url.hostname
                .toLowerCase()
                .replace(
                    /^www\./,
                    ""
                );

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
   CHECK EXECUTABLE
===================================================== */

function checkExecutable(
    command
) {

    return new Promise(
        (resolve) => {

            let finished = false;

            const finish =
                (result) => {

                    if (
                        finished
                    ) {
                        return;
                    }

                    finished = true;

                    resolve(
                        result
                    );

                };

            console.log(
                "Checking executable:",
                command
            );

            const child =
                spawn(
                    command,
                    [
                        "-version"
                    ],
                    IS_WINDOWS
                        ? {
                            windowsHide:
                                true
                        }
                        : {}
                );

            child.on(
                "error",
                (error) => {

                    console.error(
                        "Executable error:",
                        command,
                        error.message
                    );

                    finish(
                        false
                    );

                }
            );

            child.on(
                "close",
                (code) => {

                    console.log(
                        "Executable exit:",
                        command,
                        code
                    );

                    finish(
                        code === 0
                    );

                }
            );

        }
    );
}

/* =====================================================
   RUN YT-DLP
===================================================== */

function runYtDlp(
    args
) {

    return new Promise(
        (resolve, reject) => {

            let stdout = "";

            let stderr = "";

            let settled = false;

            const child =
                spawn(
                    YTDLP,
                    args,
                    IS_WINDOWS
                        ? {
                            windowsHide:
                                true
                        }
                        : {}
                );

            const fail =
                (error) => {

                    if (
                        settled
                    ) {
                        return;
                    }

                    settled = true;

                    reject(
                        error
                    );

                };

            const success =
                (output) => {

                    if (
                        settled
                    ) {
                        return;
                    }

                    settled = true;

                    resolve(
                        output
                    );

                };

            child.stdout.on(
                "data",
                (data) => {

                    stdout +=
                        data.toString();

                }
            );

            child.stderr.on(
                "data",
                (data) => {

                    stderr +=
                        data.toString();

                }
            );

            child.on(
                "error",
                (error) => {

                    fail(
                        error
                    );

                }
            );

            child.on(
                "close",
                (code) => {

                    if (
                        code === 0
                    ) {

                        success(
                            stdout
                        );

                        return;

                    }

                    const message =
                        stderr.trim() ||
                        (
                            "yt-dlp exited with code " +
                            code
                        );

                    fail(
                        new Error(
                            message
                        )
                    );

                }
            );

        }
    );
}

/* =====================================================
   SEND ERROR
===================================================== */

function sendError(
    res,
    status,
    message
) {

    return res
        .status(status)
        .json({
            success: false,
            error: message
        });

}

/* =====================================================
   DOWNLOAD JOBS
===================================================== */

const jobs =
    new Map();

/* =====================================================
   JOB CLEANUP
===================================================== */

const JOB_MAX_AGE =
    30 * 60 * 1000;

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                jobId,
                job
            ]
            of jobs.entries()
        ) {

            if (
                job.finished &&
                now -
                    job.createdAt >
                    JOB_MAX_AGE
            ) {

                jobs.delete(
                    jobId
                );

            }

        }

    },
    5 * 60 * 1000
);

/* =====================================================
   UPDATE PROGRESS
===================================================== */

function updateProgress(
    jobId,
    text
) {

    const job =
        jobs.get(
            jobId
        );

    if (!job) {
        return;
    }

    const clean =
        String(
            text || ""
        ).trim();

    if (clean) {

        console.log(
            "[" +
                jobId +
                "]",
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

    if (
        percentMatch
    ) {

        const percent =
            parseFloat(
                percentMatch[1]
            );

        job.progress =
            Math.min(
                99,
                Math.max(
                    0,
                    Math.round(
                        percent
                    )
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

    if (
        speedMatch
    ) {

        job.speed =
            speedMatch[1];

    }

    /* =========================================
       MERGING
    ========================================= */

    const lower =
        text.toLowerCase();

    if (
        lower.includes(
            "merging formats"
        ) ||
        lower.includes(
            "merging"
        )
    ) {

        job.status =
            "Merging video and audio...";

    }

    /* =========================================
       POST PROCESSING
    ========================================= */

    if (
        lower.includes(
            "postprocess"
        ) ||
        lower.includes(
            "post-processing"
        )
    ) {

        job.status =
            "Processing...";

    }

    /* =========================================
       AUDIO CONVERSION
    ========================================= */

    if (
        lower.includes(
            "extracting audio"
        )
    ) {

        job.status =
            "Converting to MP3...";

    }

    /* =========================================
       FINALIZING
    ========================================= */

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
   TEST API
===================================================== */

app.get(
    "/api/test",
    (req, res) => {

        return res.json({

            success: true,

            message:
                "BEATMATE API is working",

            platform:
                process.platform,

            nodeVersion:
                process.version,

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

            /* =========================================
               YT-DLP
            ========================================= */

            const ytDlpExists =
                await checkExecutable(
                    YTDLP
                );

            /* =========================================
               FFMPEG FILE CHECK
            ========================================= */

            const ffmpegFileExists =
                fs.existsSync(
                    FFMPEG
                );

            let ffmpegStats =
                null;

            if (
                ffmpegFileExists
            ) {

                try {

                    const stats =
                        fs.statSync(
                            FFMPEG
                        );

                    ffmpegStats = {

                        size:
                            stats.size,

                        mode:
                            stats.mode.toString(
                                8
                            ),

                        executable:
                            (
                                stats.mode &
                                0o111
                            ) !== 0

                    };

                } catch (
                    error
                ) {

                    ffmpegStats = {

                        error:
                            error.message

                    };

                }

            }

            /* =========================================
               FFMPEG EXECUTION
            ========================================= */

            const ffmpegExists =
                await checkExecutable(
                    FFMPEG
                );

            /* =========================================
               YT-DLP VERSION
            ========================================= */

            let ytDlpVersion =
                "Unavailable";

            if (
                ytDlpExists
            ) {

                try {

                    const output =
                        await runYtDlp([
                            "--version"
                        ]);

                    ytDlpVersion =
                        output.trim();

                } catch {

                    ytDlpVersion =
                        "Unavailable";

                }

            }

            /* =========================================
               FFMPEG VERSION
            ========================================= */

            let ffmpegVersion =
                "Unavailable";

            if (
                ffmpegExists
            ) {

                try {

                    const output =
                        await new Promise(
                            (
                                resolve,
                                reject
                            ) => {

                                let stdout =
                                    "";

                                let stderr =
                                    "";

                                const child =
                                    spawn(
                                        FFMPEG,
                                        [
                                            "-version"
                                        ],
                                        IS_WINDOWS
                                            ? {
                                                windowsHide:
                                                    true
                                            }
                                            : {}
                                    );

                                child.stdout.on(
                                    "data",
                                    (
                                        data
                                    ) => {

                                        stdout +=
                                            data.toString();

                                    }
                                );

                                child.stderr.on(
                                    "data",
                                    (
                                        data
                                    ) => {

                                        stderr +=
                                            data.toString();

                                    }
                                );

                                child.on(
                                    "error",
                                    reject
                                );

                                child.on(
                                    "close",
                                    (
                                        code
                                    ) => {

                                        if (
                                            code ===
                                            0
                                        ) {

                                            resolve(
                                                stdout ||
                                                stderr
                                            );

                                        } else {

                                            reject(
                                                new Error(
                                                    "FFmpeg failed."
                                                )
                                            );

                                        }

                                    }
                                );

                            }
                        );

                    const match =
                        output.match(
                            /ffmpeg version\s+([^\s]+)/i
                        );

                    if (
                        match
                    ) {

                        ffmpegVersion =
                            match[1];

                    }

                } catch {

                    ffmpegVersion =
                        "Unavailable";

                }

            }

            /* =========================================
               RESPONSE
            ========================================= */

            return res.json({

                success:
                    true,

                server:
                    true,

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

                ffmpegPath:
                    FFMPEG,

                ffmpegFileExists:
                    ffmpegFileExists,

                ffmpegStats:
                    ffmpegStats,

                downloadDirectory:
                    DOWNLOAD_DIR

            });

        } catch (
            error
        ) {

            console.error(
                "HEALTH ERROR:",
                error.message
            );

            return sendError(
                res,
                500,
                error.message
            );

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

            /* =========================================
               URL CHECK
            ========================================= */

            if (!url) {

                return sendError(
                    res,
                    400,
                    "YouTube URL is required."
                );

            }

            if (
                !isYouTubeUrl(
                    url
                )
            ) {

                return sendError(
                    res,
                    400,
                    "Please enter a valid YouTube URL."
                );

            }

            /* =========================================
               YT-DLP CHECK
            ========================================= */

            const ytDlpAvailable =
                await checkExecutable(
                    YTDLP
                );

            if (
                !ytDlpAvailable
            ) {

                return sendError(
                    res,
                    500,
                    "yt-dlp is not available on the server."
                );

            }

            /* =========================================
               GET INFO
            ========================================= */

            const output =
                await runYtDlp([

                    "--dump-single-json",

                    "--no-playlist",

                    "--skip-download",

                    "--no-warnings",

                    url

                ]);

            if (
                !output.trim()
            ) {

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

            /* =========================================
               RESPONSE
            ========================================= */

            return res.json({

                success:
                    true,

                id:
                    info.id ||
                    "",

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

        } catch (
            error
        ) {

            console.error(
                "INFO ERROR:",
                error.message
            );

            return sendError(
                res,
                500,
                error.message
            );

        }

    }
);

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
                String(
                    req.body.type ||
                    "video"
                );

            const quality =
                String(
                    req.body.quality ||
                    "best"
                );

            console.log(
                "================================"
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

            console.log(
                "================================"
            );

            /* =========================================
               VALIDATION
            ========================================= */

            if (!url) {

                return sendError(
                    res,
                    400,
                    "YouTube URL is required."
                );

            }

            if (
                !isYouTubeUrl(
                    url
                )
            ) {

                return sendError(
                    res,
                    400,
                    "Invalid YouTube URL."
                );

            }

            if (
                type !== "video" &&
                type !== "audio"
            ) {

                return sendError(
                    res,
                    400,
                    "Invalid download type."
                );

            }

            /* =========================================
               CHECK YT-DLP
            ========================================= */

            const ytDlpAvailable =
                await checkExecutable(
                    YTDLP
                );

            if (
                !ytDlpAvailable
            ) {

                return sendError(
                    res,
                    500,
                    "yt-dlp is not installed or cannot be executed."
                );

            }

            /* =========================================
               CHECK FFMPEG
            ========================================= */

            const ffmpegAvailable =
                await checkExecutable(
                    FFMPEG
                );

            if (
                !ffmpegAvailable
            ) {

                return sendError(
                    res,
                    500,
                    "FFmpeg is not installed or cannot be executed."
                );

            }

            /* =========================================
               JOB ID
            ========================================= */

            const jobId =
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .substring(
                        2,
                        10
                    );

            /* =========================================
               OUTPUT
            ========================================= */

            const output =
                path.join(
                    DOWNLOAD_DIR,
                    jobId +
                    "-%(title)s.%(ext)s"
                );

            /* =========================================
               FORMAT
            ========================================= */

            let format;

            if (
                type === "audio"
            ) {

                format =
                    "bestaudio/best";

            } else {

                switch (
                    quality
                ) {

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

                "--no-warnings",

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

            if (
                type === "audio"
            ) {

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

            if (
                type === "video"
            ) {

                args.push(

                    "--merge-output-format",
                    "mp4"

                );

            }

            /* =========================================
               URL LAST
            ========================================= */

            args.push(
                url
            );

            /* =========================================
               CREATE JOB
            ========================================= */

            const job = {

                progress:
                    0,

                status:
                    "Starting...",

                speed:
                    "",

                finished:
                    false,

                file:
                    null,

                error:
                    null,

                createdAt:
                    Date.now(),

                process:
                    null

            };

            jobs.set(
                jobId,
                job
            );

            console.log(
                "JOB CREATED:",
                jobId
            );

            /* =========================================
               START YT-DLP
            ========================================= */

            let child;

            try {

                child =
                    spawn(
                        YTDLP,
                        args,
                        IS_WINDOWS
                            ? {
                                windowsHide:
                                    true
                            }
                            : {}
                    );

            } catch (
                error
            ) {

                jobs.delete(
                    jobId
                );

                return sendError(
                    res,
                    500,
                    error.message
                );

            }

            job.process =
                child;

            /* =========================================
               STDOUT
            ========================================= */

            child.stdout.on(
                "data",
                (data) => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            /* =========================================
               STDERR
            ========================================= */

            child.stderr.on(
                "data",
                (data) => {

                    updateProgress(
                        jobId,
                        data.toString()
                    );

                }
            );

            /* =========================================
               PROCESS ERROR
            ========================================= */

            child.on(
                "error",
                (error) => {

                    console.error(
                        "YT-DLP PROCESS ERROR:",
                        error.message
                    );

                    const current =
                        jobs.get(
                            jobId
                        );

                    if (
                        !current
                    ) {
                        return;
                    }

                    current.error =
                        error.message;

                    current.status =
                        "Failed";

                    current.finished =
                        true;

                    current.process =
                        null;

                }
            );

            /* =========================================
               PROCESS CLOSED
            ========================================= */

            child.on(
                "close",
                (code) => {

                    console.log(
                        "YT-DLP EXIT:",
                        code
                    );

                    const current =
                        jobs.get(
                            jobId
                        );

                    if (
                        !current
                    ) {
                        return;
                    }

                    current.process =
                        null;

                    /* =================================
                       FAILED
                    ================================= */

                    if (
                        code !== 0
                    ) {

                        current.error =
                            "yt-dlp download failed with exit code " +
                            code;

                        current.status =
                            "Failed";

                        current.finished =
                            true;

                        return;

                    }

                    /* =================================
                       FIND FILE
                    ================================= */

                    let files;

                    try {

                        files =
                            fs.readdirSync(
                                DOWNLOAD_DIR
                            );

                    } catch (
                        error
                    ) {

                        current.error =
                            error.message;

                        current.status =
                            "Failed";

                        current.finished =
                            true;

                        return;

                    }

                    const fileName =
                        files.find(
                            (
                                file
                            ) =>
                                file.startsWith(
                                    jobId +
                                    "-"
                                )
                        );

                    /* =================================
                       FILE NOT FOUND
                    ================================= */

                    if (
                        !fileName
                    ) {

                        current.error =
                            "Downloaded file was not found.";

                        current.status =
                            "Failed";

                        current.finished =
                            true;

                        return;

                    }

                    /* =================================
                       SUCCESS
                    ================================= */

                    current.progress =
                        100;

                    current.status =
                        "Completed";

                    current.file =
                        fileName;

                    current.finished =
                        true;

                    console.log(
                        "DOWNLOAD COMPLETE:",
                        fileName
                    );

                }
            );

            /* =========================================
               RETURN JOB ID
            ========================================= */

            return res.json({

                success:
                    true,

                jobId:
                    jobId

            });

        } catch (
            error
        ) {

            console.error(
                "DOWNLOAD START ERROR:",
                error.message
            );

            return sendError(
                res,
                500,
                error.message
            );

        }

    }
);

/* =====================================================
   DOWNLOAD STATUS
===================================================== */

app.get(
    "/api/download/status/:jobId",
    (req, res) => {

        const jobId =
            req.params.jobId;

        const job =
            jobs.get(
                jobId
            );

        if (
            !job
        ) {

            return sendError(
                res,
                404,
                "Download job not found."
            );

        }

        return res.json({

            success:
                true,

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
   SEND DOWNLOADED FILE
===================================================== */

app.get(
    "/api/download/file/:jobId",
    (req, res) => {

        const jobId =
            req.params.jobId;

        const job =
            jobs.get(
                jobId
            );

        if (
            !job
        ) {

            return res
                .status(404)
                .send(
                    "Download job not found."
                );

        }

        if (
            !job.finished
        ) {

            return res
                .status(400)
                .send(
                    "Download is not finished."
                );

        }

        if (
            job.error
        ) {

            return res
                .status(500)
                .send(
                    job.error
                );

        }

        if (
            !job.file
        ) {

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

        /* =========================================
           SECURITY CHECK
        ========================================= */

        const resolvedPath =
            path.resolve(
                filePath
            );

        const resolvedDir =
            path.resolve(
                DOWNLOAD_DIR
            );

        if (
            !resolvedPath.startsWith(
                resolvedDir +
                path.sep
            )
        ) {

            return res
                .status(403)
                .send(
                    "Invalid file path."
                );

        }

        /* =========================================
           FILE EXISTS
        ========================================= */

        if (
            !fs.existsSync(
                filePath
            )
        ) {

            return res
                .status(404)
                .send(
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

                if (
                    error
                ) {

                    console.error(
                        "SEND ERROR:",
                        error.message
                    );

                }

                /* =================================
                   DELETE FILE
                ================================= */

                fs.unlink(
                    filePath,
                    (unlinkError) => {

                        if (
                            unlinkError &&
                            unlinkError.code !==
                                "ENOENT"
                        ) {

                            console.error(
                                "FILE DELETE ERROR:",
                                unlinkError.message
                            );

                        }

                    }
                );

                /* =================================
                   DELETE JOB
                ================================= */

                jobs.delete(
                    jobId
                );

            }
        );

    }
);

/* =====================================================
   CANCEL DOWNLOAD
===================================================== */

app.post(
    "/api/download/cancel/:jobId",
    (req, res) => {

        const jobId =
            req.params.jobId;

        const job =
            jobs.get(
                jobId
            );

        if (
            !job
        ) {

            return sendError(
                res,
                404,
                "Download job not found."
            );

        }

        if (
            job.finished
        ) {

            return res.json({

                success:
                    true,

                message:
                    "Download already finished."

            });

        }

        if (
            job.process
        ) {

            try {

                job.process.kill(
                    "SIGTERM"
                );

            } catch {
                /* Ignore */
            }

        }

        job.status =
            "Cancelled";

        job.error =
            "Download cancelled.";

        job.finished =
            true;

        job.process =
            null;

        return res.json({

            success:
                true,

            message:
                "Download cancelled."

        });

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
            !fs.existsSync(
                indexPath
            )
        ) {

            return res
                .status(404)
                .send(
                    "index.html not found inside public folder."
                );

        }

        return res.sendFile(
            indexPath
        );

    }
);

/* =====================================================
   UNKNOWN API / ROUTES
===================================================== */

app.use(
    (req, res) => {

        console.log(
            "UNKNOWN REQUEST:",
            req.method,
            req.url
        );

        if (
            req.url.startsWith(
                "/api/"
            )
        ) {

            return res
                .status(404)
                .json({

                    success:
                        false,

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
   GLOBAL ERROR HANDLER
===================================================== */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );

        }

        return res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message ||
                    "Internal server error."

            });

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
            "Node:",
            process.version
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Environment:",
            process.env.NODE_ENV ||
                "production"
        );

        console.log("");

        console.log(
            "Public:",
            PUBLIC_DIR
        );

        console.log(
            "Downloads:",
            DOWNLOAD_DIR
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
            FFMPEG
        );

        console.log("");

        console.log(
            "Test API:"
        );

        console.log(
            "/api/test"
        );

        console.log("");

        console.log(
            "Health API:"
        );

        console.log(
            "/api/health"
        );

        console.log("");

        console.log(
            "======================================"
        );

        console.log("");

    }
);
