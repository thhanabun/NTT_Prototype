# AWS IoT Core device path

This branch implements `ESP32 → AWS IoT Core → local bridge → POST /api/events → deterministic FSM`. The bridge sends an application ACK only after the local API accepts the event. The ESP32 retains the event ID in its bounded RAM queue and retries until it receives that ACK.

## Topics and clients

| Client | MQTT client ID | Permission |
| --- | --- | --- |
| ESP32 shelf | `SHELF-01` | Publish events; subscribe/receive ACKs |
| Laptop bridge | `smartbasket-bridge-SHELF-01` | Subscribe/receive events; publish ACKs |

The policy templates are `policies/device.json` and `policies/bridge.json`. Replace `REGION` and `ACCOUNT_ID` before creating the policies. The device policy is limited to this shelf's event/ACK topics. If `AWS_IOT_CLIENT_ID` is overridden, update the bridge policy to match.

## AWS setup

1. Replace `REGION` and `ACCOUNT_ID` in each policy, then create them with `aws iot create-policy --policy-name smartbasket-shelf-device --policy-document file://infra/aws-iot/policies/device.json` and `aws iot create-policy --policy-name smartbasket-local-bridge --policy-document file://infra/aws-iot/policies/bridge.json`.
2. Create the IoT Thing `SHELF-01` and a device X.509 certificate in the AWS IoT Core console. Attach the certificate to the Thing and attach the device policy.
3. Create a separate X.509 certificate for the laptop bridge and attach the bridge policy. Do not reuse the ESP32 private key on the laptop.
4. Download the Amazon Root CA and each certificate/private key. Keep private files under ignored `firmware/esp32/certs/`; never commit them.
5. Get the ATS data endpoint with `aws iot describe-endpoint --endpoint-type iot:Data-ATS`. Put the hostname, Wi-Fi, device certificate/key, root CA and iBeacon UUID in local `firmware/esp32/secrets.h`, copied from the example.
6. Start the local app with `npm start`, then set these PowerShell environment variables and run `npm run bridge:iot` from the repository root:

       $env:AWS_IOT_ENDPOINT = "<ATS data endpoint hostname>"
       $env:AWS_IOT_CA_FILE = "firmware/esp32/certs/AmazonRootCA1.pem"
       $env:AWS_IOT_CERT_FILE = "firmware/esp32/certs/bridge-certificate.pem.crt"
       $env:AWS_IOT_KEY_FILE = "firmware/esp32/certs/bridge-private.pem.key"
       $env:LOCAL_API_ORIGIN = "http://127.0.0.1:3000"
       npm run bridge:iot

The app and bridge run on the same laptop, so the API can stay bound to localhost. The device retries every three seconds until the bridge returns the ACK. A delayed retry goes to staff review and never uses old RSSI to choose a basket.

## Scope

This guide covers only the IoT device path. The optional DynamoDB state table is provisioned separately using [the DynamoDB guide](../dynamodb/README.md). These source changes do not deploy AWS resources; an AWS account, endpoint, certificates and policy attachment are still required. Lambda, API Gateway, Step Functions and Bedrock are not deployed here. The cart-event path consumes the two basket iBeacons; the third high-value-item tag and telemetry dashboard are outside this integration.
