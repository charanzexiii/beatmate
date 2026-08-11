const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

const PORT = 3000;

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

const YTDLP = path.join(
    ROOT,
    "bin",
    "yt-dlp.exe"
);

const FFMPEG = path.join(
    ROOT,
    "bin",
    "ffmpeg.exe"
);


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
   RUN YT-DLP
===================================================== */

function runYtDlp(args) {

    return new Promise(
        (resolve, reject) => {

            if (!fs.existsSync(YTDLP)) {

                reject(
                    new Error(
                        "yt-dlp.exe not found."
                    )
                );

                return;
            }


            const child =
                spawn(
                    YTDLP,
                    args,
                    {
                        windowsHide: true
                    }
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
                "BEATMATE API is working"

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

            /*
             * Backend is alive even if
             * yt-dlp or ffmpeg is missing.
             */

            const ytDlpExists =
                fs.existsSync(YTDLP);

            const ffmpegExists =
                fs.existsSync(FFMPEG);


            let version = "Unavailable";


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

                version: version,

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


            if (!fs.existsSync(YTDLP)) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        error:
                            "yt-dlp.exe not found."

                    });

            }


            if (!fs.existsSync(FFMPEG)) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        error:
                            "ffmpeg.exe not found."

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
                    {
                        windowsHide: true
                    }
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

                    const files =
                        fs.readdirSync(
                            DOWNLOAD_DIR
                        );


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
            fs.existsSync(YTDLP)
                ? "OK"
                : "NOT FOUND"
        );

        console.log(
            "FFmpeg:",
            fs.existsSync(FFMPEG)
                ? "OK"
                : "NOT FOUND"
        );

        console.log("");

    }
);