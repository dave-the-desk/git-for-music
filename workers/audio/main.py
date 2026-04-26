"""Audio processing worker — placeholder.

Connects to Redis and polls the BullMQ-compatible queue for processing jobs.
Actual audio processing (waveform generation, transcoding, stem splitting)
is not implemented yet.
"""

import os
import json
import time
import logging
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = os.environ.get("AUDIO_QUEUE", "audio-processing")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL_SECONDS", "2"))


def process_job(job: dict) -> None:
    job_id = job.get("id", "unknown")
    job_type = job.get("type", "unknown")
    log.info("Processing job %s (type=%s) — not yet implemented", job_id, job_type)
    # TODO: dispatch to handler based on job_type:
    #   WAVEFORM   → generate peak data
    #   TRANSCODE  → re-encode to target codec
    #   NORMALIZE  → apply loudness normalization
    #   STEM_SPLIT → run stem separation model


def main() -> None:
    log.info("Audio worker starting. REDIS_URL=%s QUEUE=%s", REDIS_URL, QUEUE_NAME)
    try:
        import redis
        r = redis.from_url(REDIS_URL)
        r.ping()
        log.info("Connected to Redis.")
    except Exception as exc:
        log.error("Cannot connect to Redis: %s", exc)
        return

    log.info("Polling queue '%s' every %.1fs…", QUEUE_NAME, POLL_INTERVAL)
    while True:
        try:
            raw = r.lpop(f"bull:{QUEUE_NAME}:wait")
            if raw:
                job = json.loads(raw)
                process_job(job)
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            log.info("Shutting down.")
            break
        except Exception as exc:
            log.exception("Unexpected error: %s", exc)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
