# AWS IoT Core device paths

FAST has two IoT paths. **Local validation** uses `ESP32 → AWS IoT Core → laptop MQTT bridge → local API`; the bridge ACKs only after the local API accepts the event. **Hosted Cloud** uses `ESP32 → AWS IoT Core → IoT Rule → Ingest Lambda → DynamoDB/FSM/Step Functions`; it does not require a laptop bridge. The NTT Cloud stack has IoT enabled and provisions `SHELF-01` to `SHELF-03`. Current resource and physical-test status is in [Cloud deployment status](../../docs/cloud-deployment-status.md).

## Topics and clients

| Client | MQTT client ID | Permission |
| --- | --- | --- |
| ESP32 shelf | `SHELF-01` | Publish events and telemetry; subscribe/receive ACKs |
| Laptop bridge | `smartbasket-bridge-SHELF-01` | Subscribe/receive events; publish ACKs |

The policy templates are `policies/device.json` and `policies/bridge.json`. Replace `REGION` and `ACCOUNT_ID` before creating the policies. The device policy is limited to this shelf's event/ACK topics. If `AWS_IOT_CLIENT_ID` is overridden, update the bridge policy to match.

## Optional local bridge setup

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

The manual policy/certificate steps above are for the optional laptop bridge path and for learning the per-device MQTT contract; they do not replace the integrated Cloud template/provisioning script. Do not mix the bridge certificate with any ESP32 certificate. Shelf Thing names and certificates are unique per board. Physical MQTT connection and end-to-end cart behavior must be checked on each flashed shelf; CloudFormation resource success alone is not that proof.
