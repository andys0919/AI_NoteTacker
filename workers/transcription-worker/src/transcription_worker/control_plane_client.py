import json
from urllib import error as urllib_error, request


class ControlPlaneClient:
    def __init__(
        self,
        base_url: str,
        internal_service_token: str | None = None,
        timeout_seconds: int = 30,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.internal_service_token = internal_service_token
        self.timeout_seconds = timeout_seconds

    def claim_next_job(self, worker_id: str) -> dict | None:
        response = self._post_json(
            f"{self.base_url}/transcription-workers/claims",
            {"workerId": worker_id},
            allow_no_content=True,
        )

        if response is None:
            return None

        return response

    def claim_next_summary_job(
        self, worker_id: str, codex_usage: dict | None = None
    ) -> dict | None:
        payload = {"workerId": worker_id}
        if codex_usage is not None:
            payload["codexUsage"] = codex_usage
        response = self._post_json(
            f"{self.base_url}/summary-workers/claims",
            payload,
            allow_no_content=True,
        )

        if response is None:
            return None

        return response

    def reserve_summary_fallback(self, job_id: str, lease_token: str | None) -> bool:
        if not lease_token:
            return False
        response = self._post_json(
            f"{self.base_url}/recording-jobs/{job_id}/summary-fallback/reservations",
            {"leaseToken": lease_token},
        )
        return bool(response and response.get("reserved") is True)

    def start_provider_request(
        self,
        job_id: str,
        request_id: str,
        *,
        stage: str,
        lease_token: str,
        provider: str,
        model: str,
        operation: str | None = None,
        audio_ms: int | None = None,
    ) -> dict:
        payload = {
            "stage": stage,
            "leaseToken": lease_token,
            "provider": provider,
            "model": model,
        }
        if operation:
            payload["operation"] = operation
        if audio_ms is not None:
            payload["audioMs"] = audio_ms
        response = self._post_provider_audit(
            f"{self.base_url}/recording-jobs/{job_id}/provider-requests/{request_id}/start",
            payload,
        )
        return response or {}

    def finish_provider_request(
        self,
        job_id: str,
        request_id: str,
        *,
        lease_token: str,
        status: str,
        provider_request_id: str | None = None,
        http_status: int | None = None,
        error_code: str | None = None,
        usage: dict | None = None,
    ) -> dict:
        payload = {
            "leaseToken": lease_token,
            "status": status,
        }
        if provider_request_id:
            payload["providerRequestId"] = provider_request_id
        if http_status is not None:
            payload["httpStatus"] = http_status
        if error_code:
            payload["errorCode"] = error_code
        if usage:
            payload["usage"] = usage
        response = self._post_provider_audit(
            f"{self.base_url}/recording-jobs/{job_id}/provider-requests/{request_id}/finish",
            payload,
        )
        return response or {}

    def _post_provider_audit(self, url: str, payload: dict) -> dict | None:
        try:
            return self._post_json(url, payload)
        except urllib_error.HTTPError:
            raise
        except Exception:
            return self._post_json(url, payload)

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
            headers=(
                {"x-internal-service-token": self.internal_service_token}
                if self.internal_service_token
                else {}
            ),
        )

        with request.urlopen(  # noqa: S310
            http_request,
            timeout=self.timeout_seconds,
        ) as response:
            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None

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

        with request.urlopen(  # noqa: S310
            http_request,
            timeout=self.timeout_seconds,
        ) as response:
            if response.status == 204:
                return None

            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None
