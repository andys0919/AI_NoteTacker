import json
from urllib import request


class ControlPlaneClient:
    def __init__(self, base_url: str, internal_service_token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_service_token = internal_service_token

    def claim_next_job(self, worker_id: str) -> dict | None:
        response = self._post_json(
            f"{self.base_url}/transcription-workers/claims",
            {"workerId": worker_id},
            allow_no_content=True,
        )

        if response is None:
            return None

        return response

    def claim_next_summary_job(self, worker_id: str) -> dict | None:
        response = self._post_json(
            f"{self.base_url}/summary-workers/claims",
            {"workerId": worker_id},
            allow_no_content=True,
        )

        if response is None:
            return None

        return response

    def post_job_event(self, job_id: str, payload: dict, lease_token: str | None = None) -> None:
        if lease_token:
            payload = {**payload, "leaseToken": lease_token}
        self._post_json(f"{self.base_url}/recording-jobs/{job_id}/events", payload)

    def post_lease_heartbeat(self, job_id: str, stage: str, lease_token: str | None = None) -> None:
        payload = {"stage": stage}
        if lease_token:
            payload["leaseToken"] = lease_token
        self._post_json(f"{self.base_url}/recording-jobs/{job_id}/leases/heartbeat", payload)

    def get_job(self, job_id: str) -> dict | None:
        http_request = request.Request(
            f"{self.base_url}/recording-jobs/{job_id}",
            method="GET",
        )

        with request.urlopen(http_request) as response:  # noqa: S310
            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None

    def claim_summary_slot(self, job_id: str, worker_id: str) -> bool:
        response = self._post_json(
            f"{self.base_url}/transcription-workers/summary-claims",
            {"jobId": job_id, "workerId": worker_id},
            allow_no_content=True,
        )

        return response is not None

    def _post_json(self, url: str, payload: dict, allow_no_content: bool = False) -> dict | None:
        encoded_payload = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            url,
            method="POST",
            headers={
                "Content-Type": "application/json",
                **(
                    {"x-internal-service-token": self.internal_service_token}
                    if self.internal_service_token
                    else {}
                ),
            },
            data=encoded_payload,
        )

        with request.urlopen(http_request) as response:  # noqa: S310
            if allow_no_content and response.status == 204:
                return None

            if response.status == 204:
                return None

            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None
