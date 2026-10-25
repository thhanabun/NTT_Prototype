import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const ref = Ref => ({ Ref });
const att = (name, attribute = "Arn") => ({ "Fn::GetAtt": [name, attribute] });
const sub = text => ({ "Fn::Sub": text });
const resource = (Type, Properties, extra = {}) => ({ Type, Properties, ...extra });
const statement = (Action, Resource) => ({ Effect: "Allow", Action, Resource });
const shelfIds = ["SHELF-01", "SHELF-02", "SHELF-03"];
const shelfArn = (type, shelfId, suffix) => sub(`arn:\${AWS::Partition}:iot:\${AWS::Region}:\${AWS::AccountId}:${type}/smartbasket/shelf/${shelfId}/${suffix}`);
const stateRead = statement(["dynamodb:GetItem", "dynamodb:BatchGetItem"], att("StateTable"));
const stateWrite = statement(["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"], att("StateTable"));
const controls = statement(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"], att("ControlTable"));
const controlScan = statement("dynamodb:Scan", att("ControlTable"));
const agentInvoke = statement("lambda:InvokeFunction", att("AgentRuntime"));
const agentEnvironment = { AGENT_FUNCTION_ARN: att("AgentRuntime") };
const fn = (handler, statements, properties = {}) => resource("AWS::Serverless::Function", {
  Runtime: "nodejs22.x", CodeUri: "../../data/cloud-package/", Handler: "src/cloud/handlers." + handler, Policies: [{ Statement: statements }], ...properties,
});
const task = (functionName, payload, next, rest = {}) => ({ Type: "Task", Resource: "arn:aws:states:::lambda:invoke", Parameters: { FunctionName: att(functionName), Payload: payload }, ResultPath: "$.task", Next: next, ...rest });
const handoff = (stage, next, seconds) => ({ Type: "Task", Resource: "arn:aws:states:::lambda:invoke.waitForTaskToken", TimeoutSeconds: seconds,
  Parameters: { FunctionName: att("HandoffFunction"), Payload: { "caseId.$": "$.caseId", "taskToken.$": "$$.Task.Token", stage } }, ResultPath: "$.humanDecision", Next: next,
});

export function cloudTemplate() {
  const Resources = {
    StateTable: resource("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST", AttributeDefinitions: [{ AttributeName: "stateKey", AttributeType: "S" }], KeySchema: [{ AttributeName: "stateKey", KeyType: "HASH" }], SSESpecification: { SSEEnabled: true }, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" } }, { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" }),
    ControlTable: resource("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST", AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }], KeySchema: [{ AttributeName: "id", KeyType: "HASH" }], SSESpecification: { SSEEnabled: true }, TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true } }),
    SessionSecret: resource("AWS::SecretsManager::Secret", { GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true }, Description: "Basket session signatures and QR pairing HMAC; never send this secret to the browser" }, { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" }),
    UserPool: resource("AWS::Cognito::UserPool", { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, UsernameAttributes: ["email"], AutoVerifiedAttributes: ["email"], Policies: { PasswordPolicy: { MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: true } } }),
    StaffGroup: resource("AWS::Cognito::UserPoolGroup", { UserPoolId: ref("UserPool"), GroupName: "STAFF", Description: "Staff dashboard and human approval access" }),
    UserPoolClient: resource("AWS::Cognito::UserPoolClient", { UserPoolId: ref("UserPool"), GenerateSecret: false, AllowedOAuthFlowsUserPoolClient: true, AllowedOAuthFlows: ["code"], AllowedOAuthScopes: ["openid", "email"], SupportedIdentityProviders: ["COGNITO"], CallbackURLs: [sub("${WebOrigin}/api/auth/callback")], LogoutURLs: [sub("${WebOrigin}/admin/login")], PreventUserExistenceErrors: "ENABLED", EnableTokenRevocation: true, AccessTokenValidity: 60, TokenValidityUnits: { AccessToken: "minutes" } }),
    UserPoolDomain: resource("AWS::Cognito::UserPoolDomain", { UserPoolId: ref("UserPool"), Domain: sub("${AWS::StackName}-${AWS::AccountId}") }),
    HttpApi: resource("AWS::Serverless::HttpApi", { StageName: "$default", DefaultRouteSettings: { ThrottlingBurstLimit: 30, ThrottlingRateLimit: 15 } }),
    WebSocketApi: resource("AWS::ApiGatewayV2::Api", { Name: sub("${AWS::StackName}-realtime"), ProtocolType: "WEBSOCKET", RouteSelectionExpression: "$request.body.action" }),
    WebSocketIntegration: resource("AWS::ApiGatewayV2::Integration", { ApiId: ref("WebSocketApi"), IntegrationType: "AWS_PROXY", IntegrationUri: sub("arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${WebSocketFunction.Arn}/invocations") }),
    WebSocketStage: resource("AWS::ApiGatewayV2::Stage", { ApiId: ref("WebSocketApi"), StageName: "live", AutoDeploy: true, DefaultRouteSettings: { ThrottlingBurstLimit: 30, ThrottlingRateLimit: 15 } }),
    WebSocketPermission: resource("AWS::Lambda::Permission", { Action: "lambda:InvokeFunction", FunctionName: ref("WebSocketFunction"), Principal: "apigateway.amazonaws.com", SourceArn: sub("arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/*") }),
    ApiFunction: fn("api", [stateWrite, controls, agentInvoke, statement("secretsmanager:GetSecretValue", ref("SessionSecret"))], { Environment: { Variables: { ...agentEnvironment } }, Events: { Api: { Type: "HttpApi", Properties: { ApiId: ref("HttpApi"), Path: "/api/{proxy+}", Method: "ANY" } } } }),
    IngestFunction: fn("ingest", [stateWrite, statement("states:StartExecution", ref("CaseWorkflow")), statement("iot:Publish", shelfIds.map(shelfId => shelfArn("topic", shelfId, "acks")))], { Environment: { Variables: { WORKFLOW_ARN: ref("CaseWorkflow"), IOT_DATA_ENDPOINT: ref("IoTDataEndpoint") } }, EventInvokeConfig: { MaximumRetryAttempts: 2, DestinationConfig: { OnFailure: { Type: "SQS", Destination: att("FailureQueue") } } } }),
    InvestigateFunction: fn("investigate", [stateWrite, agentInvoke], { Timeout: 300, Environment: { Variables: { ...agentEnvironment } } }),
    HandoffFunction: fn("handoff", [stateWrite, controls, statement("states:SendTaskSuccess", "*")]),
    ValidateFunction: fn("validate", [stateWrite]),
    ReconcileFunction: fn("reconcile", [stateWrite, controls, controlScan, statement("states:StartExecution", ref("CaseWorkflow")), statement("states:SendTaskSuccess", "*")], { Environment: { Variables: { WORKFLOW_ARN: ref("CaseWorkflow") } }, Events: { Reconcile: { Type: "Schedule", Properties: { Schedule: "rate(1 minute)", Enabled: true } } } }),
    WebSocketFunction: fn("websocket", [controls]),
    ChangesFunction: fn("changes", [controlScan, statement("dynamodb:DeleteItem", att("ControlTable")), statement("execute-api:ManageConnections", sub("arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/live/POST/@connections/*"))], { Environment: { Variables: { WS_MANAGEMENT_ENDPOINT: sub("https://${WebSocketApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/live") } }, Events: { Changes: { Type: "DynamoDB", Properties: { Stream: att("StateTable", "StreamArn"), StartingPosition: "LATEST", BatchSize: 10, MaximumRetryAttempts: 3, BisectBatchOnFunctionError: true, DestinationConfig: { OnFailure: { Type: "SQS", Destination: att("FailureQueue") } }, FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ["INSERT", "MODIFY"], dynamodb: { Keys: { stateKey: { S: ["STATE#META"] } } } }) }] } } } } }),
    ToolsFunction: fn("unused", [stateRead], { Handler: "src/cloud/agent-runtime.toolsHandler", Timeout: 10 }),
    ArchiveBucket: resource("AWS::S3::Bucket", { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] }, VersioningConfiguration: { Status: "Enabled" }, LifecycleConfiguration: { Rules: [{ Id: "DemoRetention", Status: "Enabled", ExpirationInDays: 90, NoncurrentVersionExpiration: { NoncurrentDays: 90 } }] } }, { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" }),
    ArchiveFunction: fn("archive", [statement("s3:PutObject", sub("${ArchiveBucket.Arn}/business/*"))], { Environment: { Variables: { ARCHIVE_BUCKET: ref("ArchiveBucket") } }, Events: { Archive: { Type: "DynamoDB", Properties: { Stream: att("StateTable", "StreamArn"), StartingPosition: "TRIM_HORIZON", BatchSize: 25, MaximumRetryAttempts: 3, BisectBatchOnFunctionError: true, DestinationConfig: { OnFailure: { Type: "SQS", Destination: att("FailureQueue") } }, FilterCriteria: { Filters: [{ Pattern: JSON.stringify({ eventName: ["INSERT", "MODIFY"], dynamodb: { Keys: { stateKey: { S: ["auditLog", "events", "cases", "orders"].map(field => ({ prefix: `STATE#${field}#` })) } } } }) }] } } } } }),
    TrailBucketPolicy: resource("AWS::S3::BucketPolicy", { Bucket: ref("ArchiveBucket"), PolicyDocument: { Version: "2012-10-17", Statement: [
      { Effect: "Allow", Principal: { Service: "cloudtrail.amazonaws.com" }, Action: "s3:GetBucketAcl", Resource: att("ArchiveBucket"), Condition: { StringEquals: { "AWS:SourceArn": sub("arn:${AWS::Partition}:cloudtrail:${AWS::Region}:${AWS::AccountId}:trail/${AWS::StackName}") } } },
      { Effect: "Allow", Principal: { Service: "cloudtrail.amazonaws.com" }, Action: "s3:PutObject", Resource: sub("${ArchiveBucket.Arn}/AWSLogs/${AWS::AccountId}/*"), Condition: { StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control", "AWS:SourceArn": sub("arn:${AWS::Partition}:cloudtrail:${AWS::Region}:${AWS::AccountId}:trail/${AWS::StackName}") } } },
    ] } }),
    Trail: resource("AWS::CloudTrail::Trail", { TrailName: ref("AWS::StackName"), S3BucketName: ref("ArchiveBucket"), IsLogging: true, EnableLogFileValidation: true, IsMultiRegionTrail: false, IncludeGlobalServiceEvents: true, EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }] }, { DependsOn: "TrailBucketPolicy" }),
    AgentRole: resource("AWS::IAM::Role", { AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }, ManagedPolicyArns: [sub("arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")], Policies: [{ PolicyName: "AgentRuntime", PolicyDocument: { Version: "2012-10-17", Statement: [stateWrite, statement("lambda:InvokeFunction", att("ToolsFunction")), statement("bedrock:InvokeModel", ref("BedrockInvokeResources"))] } }] }),
    AgentRuntime: resource("AWS::Serverless::Function", { PackageType: "Image", ImageUri: ref("AgentImageUri"), Role: att("AgentRole"), MemorySize: 3008, Timeout: 300, Environment: { Variables: { AGENT_HOSTING: "lambda", TOOLS_FUNCTION_ARN: att("ToolsFunction"), BEDROCK_MODEL_ID: ref("BedrockModelId") } } }),
    CaseWorkflow: resource("AWS::Serverless::StateMachine", { Type: "STANDARD", Policies: [{ Statement: [statement("lambda:InvokeFunction", [att("InvestigateFunction"), att("HandoffFunction"), att("ValidateFunction")])] }], Definition: {
      StartAt: "Investigate", TimeoutSeconds: 90000, States: {
        Investigate: task("InvestigateFunction", { "caseId.$": "$.caseId", "investigate.$": "$.investigate" }, "Route", { ResultSelector: { "nextAction.$": "$.Payload.nextAction" }, Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.failure", Next: "StaffApproval" }] }),
        Route: { Type: "Choice", Choices: [{ Variable: "$.task.nextAction", StringEquals: "CUSTOMER_CONFIRM", Next: "CustomerConfirmation" }], Default: "StaffApproval" },
        CustomerConfirmation: { ...handoff("CUSTOMER", "AfterCustomer", 120), Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.customerFailure", Next: "StaffApproval" }] },
        AfterCustomer: { Type: "Choice", Choices: [{ Variable: "$.humanDecision.nextAction", StringEquals: "CLOSE", Next: "Validate" }], Default: "StaffApproval" },
        StaffApproval: handoff("STAFF", "Validate", 86400),
        Validate: { ...task("ValidateFunction", { "caseId.$": "$.caseId" }, "Done"), Retry: [{ ErrorEquals: ["Lambda.ServiceException", "Lambda.TooManyRequestsException"], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 }] },
        Done: { Type: "Succeed" },
      },
    } }),
    FailureQueue: resource("AWS::SQS::Queue", { MessageRetentionPeriod: 1209600, SqsManagedSseEnabled: true }),
    FailureAlarm: resource("AWS::CloudWatch::Alarm", { AlarmDescription: "Cloud ingestion/realtime failure queue requires review", Namespace: "AWS/SQS", MetricName: "ApproximateNumberOfMessagesVisible", Dimensions: [{ Name: "QueueName", Value: att("FailureQueue", "QueueName") }], Statistic: "Maximum", Period: 60, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: "GreaterThanThreshold", TreatMissingData: "notBreaching", AlarmActions: [ref("AlarmTopic")] }),
    AlarmTopic: resource("AWS::SNS::Topic", { Subscription: [{ Protocol: "email", Endpoint: ref("BudgetEmail") }] }),
    Budget: resource("AWS::Budgets::Budget", { Budget: { BudgetName: sub("${AWS::StackName}-monthly"), BudgetType: "COST", TimeUnit: "MONTHLY", BudgetLimit: { Amount: ref("MonthlyBudgetUsd"), Unit: "USD" } }, NotificationsWithSubscribers: [{ Notification: { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold: 80, ThresholdType: "PERCENTAGE" }, Subscribers: [{ SubscriptionType: "EMAIL", Address: ref("BudgetEmail") }] }] }),
    ShelfThing: resource("AWS::IoT::Thing", { ThingName: "SHELF-01" }),
    ShelfThing02: resource("AWS::IoT::Thing", { ThingName: "SHELF-02" }),
    ShelfThing03: resource("AWS::IoT::Thing", { ThingName: "SHELF-03" }),
    DevicePolicy: resource("AWS::IoT::Policy", { PolicyDocument: { Version: "2012-10-17", Statement: [statement("iot:Connect", shelfIds.map(shelfId => sub(`arn:\${AWS::Partition}:iot:\${AWS::Region}:\${AWS::AccountId}:client/${shelfId}`))), statement("iot:Publish", shelfIds.flatMap(shelfId => [shelfArn("topic", shelfId, "events"), shelfArn("topic", shelfId, "telemetry")])), statement("iot:Subscribe", shelfIds.map(shelfId => shelfArn("topicfilter", shelfId, "acks"))), statement("iot:Receive", shelfIds.map(shelfId => shelfArn("topic", shelfId, "acks")))] } }),
    // shortcut: IoT rule action failures before Lambda accepts the invocation are not sent to FailureQueue; restore the role-backed ErrorAction when PassRole is available.
    ShelfRule: resource("AWS::IoT::TopicRule", { TopicRulePayload: { AwsIotSqlVersion: "2016-03-23", Sql: "SELECT *, topic() AS mqttTopic, clientid() AS mqttClientId FROM 'smartbasket/shelf/+/+' WHERE (topic(4) = 'events' OR topic(4) = 'telemetry') AND (topic(3) = 'SHELF-01' OR topic(3) = 'SHELF-02' OR topic(3) = 'SHELF-03')", RuleDisabled: false, Actions: [{ Lambda: { FunctionArn: att("IngestFunction") } }] } }),
    IoTInvokePermission: resource("AWS::Lambda::Permission", { Action: "lambda:InvokeFunction", FunctionName: ref("IngestFunction"), Principal: "iot.amazonaws.com", SourceAccount: ref("AWS::AccountId"), SourceArn: att("ShelfRule") }),
    WebService: resource("AWS::Serverless::Function", { PackageType: "Image", ImageUri: ref("WebImageUri"), MemorySize: 2048, Timeout: 60, Environment: { Variables: { NEXT_PUBLIC_CLOUD_MODE: "true", CLOUD_API_ORIGIN: sub("https://${HttpApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}"), CLOUD_WEBSOCKET_URL: sub("wss://${WebSocketApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/live"), WEB_ORIGIN: ref("WebOrigin"), COGNITO_CLIENT_ID: ref("UserPoolClient"), COGNITO_DOMAIN: sub("https://${UserPoolDomain}.auth.${AWS::Region}.amazoncognito.com"), CLOUD_DEMO_SIGNALS: ref("EnableDemoSignals") } } }),
    WebFunctionUrl: resource("AWS::Lambda::Url", { TargetFunctionArn: ref("WebService"), AuthType: "NONE" }),
    WebUrlPermission: resource("AWS::Lambda::Permission", { Action: "lambda:InvokeFunctionUrl", FunctionName: ref("WebService"), Principal: "*", FunctionUrlAuthType: "NONE" }),
    WebUrlInvokePermission: resource("AWS::Lambda::Permission", { Action: "lambda:InvokeFunction", FunctionName: ref("WebService"), Principal: "*", InvokedViaFunctionUrl: true }),
    RetentionFunction: fn("retention", [statement("logs:DescribeLogGroups", "*"), statement("logs:PutRetentionPolicy", sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-*"))], { Environment: { Variables: { AGENT_LOG_GROUP: ref("AgentRuntimeLog"), WEB_LOG_GROUP: ref("WebServiceLog") } }, Events: { Retention: { Type: "Schedule", Properties: { Schedule: "rate(1 day)", Enabled: true } } } }),
  };
  for (const name of ["IngestFunction", "ShelfThing", "ShelfThing02", "ShelfThing03", "DevicePolicy", "ShelfRule", "IoTInvokePermission"]) Resources[name].Condition = "ProvisionIoT";
  Resources.ApiFunction.Properties.Environment.Variables.WORKFLOW_ARN = ref("CaseWorkflow");
  Resources.ApiFunction.Properties.Policies[0].Statement.push(statement("states:StartExecution", ref("CaseWorkflow")));
  // Task-token API actions cannot be resource scoped by AWS; other write permissions are scoped.
  Resources.ApiFunction.Properties.Policies[0].Statement.push(statement("states:SendTaskSuccess", "*"));
  for (const [suffix, route] of [["Connect", "$connect"], ["Disconnect", "$disconnect"], ["Default", "$default"]]) Resources["WebSocket" + suffix] = resource("AWS::ApiGatewayV2::Route", { ApiId: ref("WebSocketApi"), RouteKey: route, Target: { "Fn::Join": ["/", ["integrations", ref("WebSocketIntegration")]] } });
  for (const name of Object.keys(Resources).filter(name => Resources[name].Type === "AWS::Serverless::Function")) {
    Resources[name].Properties.FunctionName = sub(`\${AWS::StackName}-${name}`);
    Resources[name].Metadata = { BuildProperties: { UseNpmCi: true } };
    Resources[name].Properties.LoggingConfig = { LogGroup: ref(name + "Log") };
    Resources[name + "Log"] = resource("AWS::Logs::LogGroup", { LogGroupName: sub(`/aws/lambda/\${AWS::StackName}-${name}`), RetentionInDays: 14 });
    Resources[name + "ErrorAlarm"] = resource("AWS::CloudWatch::Alarm", { Namespace: "AWS/Lambda", MetricName: "Errors", Dimensions: [{ Name: "FunctionName", Value: ref(name) }], Statistic: "Sum", Period: 60, EvaluationPeriods: 1, Threshold: 0, ComparisonOperator: "GreaterThanThreshold", TreatMissingData: "notBreaching", AlarmActions: [ref("AlarmTopic")] });
    if (Resources[name].Condition) {
      Resources[name + "Log"].Condition = Resources[name].Condition;
      Resources[name + "ErrorAlarm"].Condition = Resources[name].Condition;
    }
  }
  return {
    AWSTemplateFormatVersion: "2010-09-09", Transform: "AWS::Serverless-2016-10-31", Description: "FAST cloud prototype: split state, API, realtime, Cognito, HITL, live vision and optional IoT",
    Conditions: { ProvisionIoT: { "Fn::Equals": [ref("EnableIoT"), "true"] } },
    Parameters: {
      WebImageUri: { Type: "String" }, AgentImageUri: { Type: "String" },
      WebOrigin: { Type: "String", Default: "http://localhost:3001", AllowedPattern: "https://[^/]+|http://localhost:3001" },
      EnableIoT: { Type: "String", Default: "false", AllowedValues: ["true", "false"] },
      EnableDemoSignals: { Type: "String", Default: "true", AllowedValues: ["true", "false"], Description: "Allow authenticated STAFF to submit labelled demo shelf signals" },
      IoTDataEndpoint: { Type: "String", Default: "", AllowedPattern: "^$|[a-zA-Z0-9.-]+\\.iot\\.[a-z0-9-]+\\.amazonaws\\.com" },
      ShelfId: { Type: "String", Default: "SHELF-01", AllowedPattern: "[A-Z0-9-]+" },
      BedrockModelId: { Type: "String", Description: "A tool-use-capable Converse model/inference profile available in the deployment account/region" },
      BedrockInvokeResources: { Type: "CommaDelimitedList", Description: "Exact Bedrock model/profile ARNs needed by the selected model" },
      BudgetEmail: { Type: "String", AllowedPattern: "[^@ ]+@[^@ ]+\\.[^@ ]+" }, MonthlyBudgetUsd: { Type: "Number", Default: 50, MinValue: 1 },
    },
    Globals: { Function: { Timeout: 29, MemorySize: 512, Architectures: ["x86_64"], Environment: { Variables: { STATE_TABLE: ref("StateTable"), CONTROL_TABLE: ref("ControlTable"), SESSION_SECRET_ARN: ref("SessionSecret"), USER_POOL_ID: ref("UserPool"), USER_POOL_CLIENT_ID: ref("UserPoolClient"), SHELF_ID: ref("ShelfId"), ENABLE_DEMO_SIGNALS: ref("EnableDemoSignals") } } } },
    Resources,
    Outputs: { WebUrl: { Value: att("WebFunctionUrl", "FunctionUrl") }, ApiUrl: { Value: sub("https://${HttpApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}") }, WebSocketUrl: { Value: sub("wss://${WebSocketApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/live") }, UserPoolId: { Value: ref("UserPool") }, UserPoolClientId: { Value: ref("UserPoolClient") }, StateTable: { Value: ref("StateTable") }, SessionSecretArn: { Value: ref("SessionSecret") }, DevicePolicyName: { Condition: "ProvisionIoT", Value: ref("DevicePolicy") }, ThingName: { Condition: "ProvisionIoT", Value: ref("ShelfThing") }, Shelf02ThingName: { Condition: "ProvisionIoT", Value: ref("ShelfThing02") }, Shelf03ThingName: { Condition: "ProvisionIoT", Value: ref("ShelfThing03") }, AgentFunctionArn: { Value: att("AgentRuntime") }, WebFunctionArn: { Value: att("WebService") }, WorkflowArn: { Value: ref("CaseWorkflow") } },
  };
}

export function bootstrapTemplate() {
  return { AWSTemplateFormatVersion: "2010-09-09", Resources: Object.fromEntries(["Web", "Agent"].map(name => [name + "Repository", resource("AWS::ECR::Repository", { ImageScanningConfiguration: { ScanOnPush: true }, ImageTagMutability: "IMMUTABLE", EncryptionConfiguration: { EncryptionType: "AES256" }, LifecyclePolicy: { LifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, selection: { tagStatus: "untagged", countType: "sinceImagePushed", countUnit: "days", countNumber: 7 }, action: { type: "expire" } }] }) } }, { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" })])), Outputs: Object.fromEntries(["Web", "Agent"].flatMap(name => [[name + "RepositoryUri", { Value: att(name + "Repository", "RepositoryUri") }], [name + "RepositoryArn", { Value: att(name + "Repository") }]])) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, template] of [["template", cloudTemplate()], ["bootstrap", bootstrapTemplate()]]) await writeFile(new URL(name + ".json", import.meta.url), JSON.stringify(template, null, 2) + "\n");
  console.log("Generated cloud SAM and ECR bootstrap templates (no AWS calls)");
}
