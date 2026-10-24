"""Warm the private Agent models before a demo without touching carts or cases."""
import json
from pathlib import Path
import time

import boto3
from botocore.config import Config


def main():
    root = Path(__file__).resolve().parent.parent
    outputs = json.loads((root / "data/cloud-outputs.json").read_text(encoding="utf-8-sig"))
    session = boto3.Session(profile_name=outputs.get("Profile") or None, region_name=outputs["Region"])
    if session.client("sts").get_caller_identity()["Account"] != outputs["AccountId"]:
        raise SystemExit("AWS account does not match this FAST deployment")
    event = {
        "version": "2.0", "routeKey": "GET /ping", "rawPath": "/ping", "rawQueryString": "",
        "headers": {"host": "agent.internal"}, "isBase64Encoded": False,
        "requestContext": {
            "accountId": outputs["AccountId"], "apiId": "agent", "domainName": "agent.internal",
            "domainPrefix": "agent", "requestId": "deployment-health", "routeKey": "GET /ping",
            "stage": "$default", "timeEpoch": int(time.time() * 1000),
            "http": {"method": "GET", "path": "/ping", "protocol": "HTTP/1.1",
                     "sourceIp": "127.0.0.1", "userAgent": "FAST deployment health"},
        },
    }
    print("Warming Laya and YOLO; a cold start can take about three minutes.", flush=True)
    started = time.monotonic()
    response = session.client("lambda", config=Config(read_timeout=330, retries={"max_attempts": 0})).invoke(
        FunctionName=outputs["AgentFunctionArn"], Payload=json.dumps(event).encode())
    http = json.loads(response["Payload"].read())
    if response.get("FunctionError") or http.get("statusCode") != 200:
        raise SystemExit("Agent models are not ready; inspect the AgentRuntime CloudWatch log")
    body = json.loads(http.get("body", "{}"))
    if body.get("status") not in ("Healthy", "HealthyBusy"):
        raise SystemExit("Unexpected Agent health response")
    print(f"Agent models ready ({time.monotonic() - started:.1f}s). Bedrock access is checked separately.")


if __name__ == "__main__":
    main()
