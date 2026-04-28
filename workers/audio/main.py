"""Local audio processing worker.

Polls the ProcessingJob table directly and runs deterministic DSP jobs:
tempo analysis, key analysis, time-stretching, and project re-tempo.
"""

from __future__ import annotations

import logging
import os
import time

from dotenv import load_dotenv

from db import claim_next_job, connect
from jobs import process_job

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL_SECONDS', '2'))


def main() -> None:
    log.info('Audio worker starting. DATABASE_URL=%s', os.environ.get('DATABASE_URL', 'unset'))
    try:
        conn = connect()
        with conn.cursor() as cur:
            cur.execute('SELECT 1')
            cur.fetchone()
        log.info('Connected to Postgres.')
    except Exception as exc:
        log.error('Cannot connect to Postgres: %s', exc)
        return

    log.info('Polling for processing jobs every %.1fs…', POLL_INTERVAL)
    while True:
        try:
            job = claim_next_job(conn)
            if job:
                log.info('Processing job %s (type=%s)', job['id'], job['type'])
                process_job(conn, job)
            else:
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            log.info('Shutting down.')
            break
        except Exception as exc:
            log.exception('Unexpected worker error: %s', exc)
            time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main()
