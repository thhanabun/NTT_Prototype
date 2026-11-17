# DynamoDB state store

This guide describes the optional legacy Node API adapter, which stores one versioned aggregate item instead of the local JSON file. The integrated Cloud stack uses a separate normalized records repository and provisions its StateTable/ControlTable through [`infra/cloud`](../cloud/README.md). Do not use this standalone table as a substitute for the deployed Cloud data model. Current Cloud status is in [deployment status](../../docs/cloud-deployment-status.md).

## Deploy the table

From the repository root, deploy the small on-demand, encrypted table:

    aws cloudformation deploy --template-file infra/dynamodb/template.yaml --stack-name smartbasket-prototype-db --parameter-overrides Stage=prototype

This creates `smartbasket-prototype-state` by default. Attach `app-policy.json` to the IAM role or IAM Identity Center role used to run the Node app after replacing `REGION` and `ACCOUNT_ID`. The app only needs `dynamodb:GetItem` and `dynamodb:PutItem` on this table. Avoid long-lived access keys; use the AWS credential provider configured for your development role.

## Run the app against DynamoDB

PowerShell:

    $env:STORE_BACKEND = "dynamodb"
    $env:AWS_REGION = "ap-southeast-1"
    $env:DYNAMODB_TABLE_NAME = "smartbasket-prototype-state"
    npm start

To use DynamoDB Local, set `DYNAMODB_ENDPOINT` to its endpoint. The adapter supplies placeholder local credentials only when this endpoint is set.

Create the local table first, for example:

    aws dynamodb create-table --endpoint-url http://127.0.0.1:8000 --region us-east-1 --table-name smartbasket-prototype-state --attribute-definitions AttributeName=stateKey,AttributeType=S --key-schema AttributeName=stateKey,KeyType=HASH --billing-mode PAY_PER_REQUEST

Existing state is not copied automatically. Starting DynamoDB mode on an empty table creates a fresh prototype state; the JSON file is left untouched. Reset in the app resets the DynamoDB state item.

## Prototype storage model

The current FSM mutates one small aggregate containing product catalog, shelf state, basket sessions/carts, recent events, cases, and orders. DynamoDB stores this aggregate as one versioned item. Conditional writes use an optimistic version check and retry on concurrent updates, so the local JSON and DynamoDB adapters run the same domain code.

This is deliberately a prototype store, not the final event-data model: DynamoDB items have a 400 KB limit, and the single item is not suitable for a multi-instance high-write service. The recent event list, duplicate-ID list and audit log are bounded; case/order history and agent tool evidence can grow and may eventually exceed the item limit. Audit entries are part of the versioned state item, not an independent append-only table. Before scaling, split events, cases/audit, products, sessions, and cart lines into queryable records and use transactions for cart/case changes.

## Operations

- Create the table and IAM policy before setting `STORE_BACKEND=dynamodb`.
- Choose the AWS region explicitly and keep the IAM permissions scoped to the named table.
- The standalone Node app writes structured logs to stdout. The integrated Cloud template deploys its own Lambda, API Gateway, Step Functions, Bedrock permissions, and CloudWatch resources; this standalone DynamoDB template does not.
- Remove the stack with CloudFormation when the prototype data is no longer needed.
