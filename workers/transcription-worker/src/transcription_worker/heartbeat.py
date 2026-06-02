import threading


def start_lease_heartbeat(client, job_id: str, stage: str, lease_token: str | None, heartbeat_interval_ms: int):
    """Start a background daemon thread that periodically extends the worker lease.

    Returns ``(stop_event, thread)`` so the caller can stop the heartbeat when the job
    finishes, or ``(None, None)`` when there is no lease token / heartbeats are disabled.
    """
    if not lease_token or heartbeat_interval_ms <= 0:
        return None, None

    stop_event = threading.Event()

    def heartbeat_loop() -> None:
        interval_seconds = heartbeat_interval_ms / 1000

        while not stop_event.wait(interval_seconds):
            try:
                client.post_lease_heartbeat(job_id, stage, lease_token)
            except Exception:  # noqa: BLE001
                # A transient network blip must not kill the heartbeat permanently, or the
                # lease would expire and the job be reclaimed (discarding this worker's
                # progress). Keep retrying on the next interval until stop_event is set.
                continue

    thread = threading.Thread(target=heartbeat_loop, daemon=True)
    thread.start()
    return stop_event, thread
