const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();

const PORT = 3000;

// =====================================================
// PATHS
// =====================================================

const ROOT = __dirname;

const PUBLIC_DIR =
path.join(
ROOT,
"public"
);

const DOWNLOAD_DIR =
path.join(
ROOT,
"downloads"
);

const YTDLP =
path.join(
ROOT,
"bin",
"yt-dlp.exe"
);

const FFMPEG =
path.join(
ROOT,
"bin",
"ffmpeg.exe"
);

// =====================================================
// CREATE DOWNLOAD DIRECTORY
// =====================================================

if (
!fs.existsSync(
DOWNLOAD_DIR
)
) {

fs.mkdirSync(
    DOWNLOAD_DIR,
    {
        recursive: true
    }
);

}

// =====================================================
// EXPRESS
// =====================================================

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

app.use(
express.static(
PUBLIC_DIR
)
);

// =====================================================
// CHECK YOUTUBE URL
// =====================================================

function isYouTubeUrl(value) {

try {

    const url =
        new URL(value);

    const hostname =
        url.hostname.toLowerCase();

    return (
        hostname === "youtube.com" ||
        hostname === "www.youtube.com" ||
        hostname === "m.youtube.com" ||
        hostname === "youtu.be" ||
        hostname === "www.youtu.be"
    );

}

catch {

    return false;

}

}

// =====================================================
// CLEAN URL
// =====================================================

function cleanUrl(value) {

let url =
    String(
        value || ""
    ).trim();


const markdownMatch =
    url.match(
        /^\[.*?\]\((https?:\/\/[^)]+)\)$/
    );


if (markdownMatch) {

    url =
        markdownMatch[1];

}


url =
    url.replace(
        /^["']|["']$/g,
        ""
    );


return url.trim();

}

// =====================================================
// RUN YT-DLP
// =====================================================

function runYtDlp(args) {

return new Promise(
    (resolve, reject) => {

        if (
            !fs.existsSync(
                YTDLP
            )
        ) {

            reject(
                new Error(
                    "yt-dlp.exe was not found at:\n" +
                    YTDLP
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

                reject(
                    error
                );

            }
        );


        child.on(
            "close",
            code => {

                if (
                    code === 0
                ) {

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

// =====================================================
// HEALTH
// =====================================================

app.get(
"/api/health",
async (req, res) => {

    try {

        if (
            !fs.existsSync(
                YTDLP
            )
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "yt-dlp.exe was not found."

                });

        }


        if (
            !fs.existsSync(
                FFMPEG
            )
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "ffmpeg.exe was not found."

                });

        }


        const version =
            await runYtDlp([
                "--version"
            ]);


        return res.json({

            success:
                true,

            version:
                version.trim(),

            cookies:
                false

        });

    }

    catch (error) {

        console.error(
            "HEALTH ERROR:",
            error.message
        );


        return res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message

            });

    }

}

);

// =====================================================
// VIDEO INFORMATION
// =====================================================

app.post(
"/api/info",
async (req, res) => {

    try {

        const url =
            cleanUrl(
                req.body.url
            );


        console.log(
            "INFO REQUEST:",
            url
        );


        if (
            !isYouTubeUrl(url)
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Please enter a valid YouTube URL."

                });

        }


        const args = [

            "--dump-single-json",

            "--no-playlist",

            "--skip-download",

            "--no-warnings",

            url

        ];


        const output =
            await runYtDlp(
                args
            );


        if (
            !output.trim()
        ) {

            throw new Error(
                "yt-dlp returned an empty response."
            );

        }


        let info;


        try {

            info =
                JSON.parse(
                    output
                );

        }

        catch {

            throw new Error(
                "Could not parse yt-dlp information."
            );

        }


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

            duration:
                info.duration ||
                0,

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

                success:
                    false,

                error:
                    error.message

            });

    }

}

);

// =====================================================
// DOWNLOAD JOBS
// =====================================================

const jobs = {};

// =====================================================
// START DOWNLOAD
// =====================================================

app.post(
"/api/download/start",
async (req, res) => {

    try {

        const url =
            cleanUrl(
                req.body.url
            );


        const type =
            req.body.type ||
            "video";


        const quality =
            req.body.quality ||
            "best";


        if (
            !isYouTubeUrl(url)
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

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

                    success:
                        false,

                    error:
                        "Invalid download type."

                });

        }


        if (
            !fs.existsSync(
                YTDLP
            )
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "yt-dlp.exe was not found."

                });

        }


        if (
            !fs.existsSync(
                FFMPEG
            )
        ) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        "ffmpeg.exe was not found."

                });

        }


        const jobId =
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .substring(2, 10);


        const output =
            path.join(
                DOWNLOAD_DIR,
                `${jobId}-%(title)s.%(ext)s`
            );


        let format;


        // =========================================
        // AUDIO
        // =========================================

        if (
            type === "audio"
        ) {

            format =
                "bestaudio/best";

        }


        // =========================================
        // VIDEO
        // =========================================

        else {

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


        // =========================================
        // AUDIO SETTINGS
        // =========================================

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


        // =========================================
        // VIDEO SETTINGS
        // =========================================

        else {

            args.push(

                "--merge-output-format",
                "mp4"

            );

        }


        // URL MUST BE LAST

        args.push(
            url
        );


        jobs[jobId] = {

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
                null

        };


        console.log(
            "DOWNLOAD START:",
            jobId
        );


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


                if (
                    jobs[jobId]
                ) {

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
                    "YT-DLP EXIT CODE:",
                    code
                );


                if (
                    !jobs[jobId]
                ) {

                    return;

                }


                if (
                    code !== 0
                ) {

                    jobs[jobId].error =
                        jobs[jobId].error ||
                        "yt-dlp download failed.";

                    jobs[jobId].status =
                        "Failed";

                    jobs[jobId].finished =
                        true;

                    return;

                }


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


                if (
                    !fileName
                ) {

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


        return res.json({

            success:
                true,

            jobId:
                jobId

        });

    }

    catch (error) {

        console.error(
            "DOWNLOAD START ERROR:",
            error.message
        );


        return res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message

            });

    }

}

);

// =====================================================
// UPDATE PROGRESS
// =====================================================

function updateProgress(
jobId,
text
) {

const job =
    jobs[jobId];


if (!job) {

    return;

}


console.log(
    text.trim()
);


// =========================================
// PERCENTAGE
// =========================================

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


// =========================================
// SPEED
// =========================================

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


// =========================================
// MERGING
// =========================================

if (
    text.includes(
        "Merging"
    )
) {

    job.status =
        "Merging video and audio...";

}


if (
    text.includes(
        "Deleting original"
    )
) {

    job.status =
        "Finalizing...";

}

}

// =====================================================
// DOWNLOAD STATUS
// =====================================================

app.get(
"/api/download/status/",
(req, res) => {

    const job =
        jobs[
            req.params.jobId
        ];


    if (!job) {

        return res
            .status(404)
            .json({

                success:
                    false,

                error:
                    "Download job not found."

            });

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

// =====================================================
// DOWNLOAD COMPLETED FILE
// =====================================================

app.get(
"/api/download/file/",
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
        error => {

            if (
                error
            ) {

                console.error(
                    "SEND ERROR:",
                    error.message
                );

            }


            // Delete file

            fs.unlink(
                filePath,
                () => {}
            );


            // Remove job

            delete jobs[
                req.params.jobId
            ];

        }
    );

}

);

// =====================================================
// API 404
// =====================================================

app.use(
"/api",
(req, res) => {

    return res
        .status(404)
        .json({

            success:
                false,

            error:
                "API endpoint not found."

        });

}

);

// =====================================================
// START SERVER
// =====================================================

app.listen(
PORT,
() => {

    console.log("");

    console.log(
        "===================================="
    );

    console.log(
        "        BEATMATE DOWNLOADER"
    );

    console.log(
        "===================================="
    );

    console.log("");

    console.log(
        `Open: http://localhost:${PORT}`
    );

    console.log("");

    console.log(
        `Health: http://localhost:${PORT}/api/health`
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