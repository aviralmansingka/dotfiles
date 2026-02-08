# ─── DynamoDB ────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "go_serverless" {
  provider = aws.us_west_1

  name           = "go-serverless"
  billing_mode   = "PROVISIONED"
  read_capacity  = 1
  write_capacity = 1
  hash_key       = "email"

  attribute {
    name = "email"
    type = "S"
  }
}

# ─── Lambda ──────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "go_serverless" {
  provider = aws.us_west_1

  function_name = "go-serverless"
  role          = aws_iam_role.go_serverless_executor.arn
  handler       = "main"
  runtime       = "go1.x"
  timeout       = 15
  memory_size   = 512
  architectures = ["x86_64"]
  filename      = "${path.module}/lambda-placeholder.zip"

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── CloudWatch Log Group ────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "go_serverless" {
  provider = aws.us_west_1

  name = "/aws/lambda/go-serverless"
}

# ─── API Gateway ─────────────────────────────────────────────────────────────

resource "aws_api_gateway_rest_api" "go_serverless" {
  provider = aws.us_west_1

  name = "go-serverless"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_deployment" "go_serverless" {
  provider = aws.us_west_1

  rest_api_id = aws_api_gateway_rest_api.go_serverless.id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "staging" {
  provider = aws.us_west_1

  rest_api_id   = aws_api_gateway_rest_api.go_serverless.id
  deployment_id = aws_api_gateway_deployment.go_serverless.id
  stage_name    = "staging"
}

# ─── Lambda Permission for API Gateway ───────────────────────────────────────

resource "aws_lambda_permission" "api_gateway" {
  provider = aws.us_west_1

  statement_id  = "3e910ec6-d61b-46d9-9369-54e3c23758c3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.go_serverless.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.go_serverless.execution_arn}/*/*/"
}
