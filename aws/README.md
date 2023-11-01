# Deploying Docker Compose to AWS ECS Fargate

## Introduction

Docker Compose is a powerful tool for defining and managing multi-container Docker applications. AWS ECS Fargate is a serverless compute engine for containers that allows you to run Docker containers without managing the underlying infrastructure. In this guide, we will walk through the process of deploying a Docker Compose application to AWS ECS Fargate.

## Prerequisites

Before getting started, make sure you have the following:

- An AWS account with the necessary permissions
- Docker installed on your local machine
- A Docker Compose file that defines your application's services and dependencies

## Step 0: Description `.env` file

```env
# AWS configuration
ECS_PROFILE_NAME=hyperdx
ECS_SERVICE_NAME=hyperdx
ECS_CLUSTER_NAME=hyperdx
AWS_REGION=us-east-1
ECS_LAUNCH_TYPE=FARGATE
HYPERDX_APP_ALB_PORT=443
HYPERDX_APP_ALB_URL=https://localhost
```

## Step 1: Set up an ECS Cluster

First, we need to create an ECS cluster to host our containers. Follow the [AWS documentation](https://docs.aws.amazon.com/AmazonECS/latest/userguide/ECS_CLI.html#ECS_CLI_Configuration) to create an ECS cluster in your desired region.

```bash
$ ecs-cli configure profile --profile-name profile_name --access-key $AWS_ACCESS_KEY_ID --secret-key $AWS_SECRET_ACCESS_KEY
```
```bash
$ ecs-cli configure --cluster cluster_name --default-launch-type launch_type --region region_name --config-name configuration_name
```

or commands based on env variables in the `.env` file

```bash
$ make aws-ecs
```

## Step 2: Deploy your Docker image to ECR

Prepare to push personal images by referring to [AWS documentation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html). Modify the '.env' file and deploy the built docker image to the ECR.

```env
# Used by docker-compose.yml
IMAGE_NAME=aws_account_id.dkr.ecr.us-east-1.amazonaws.com/hyperdx
```

and

```bash
$ make release
```

## Step 3: Create a Task Definition

A task definition is a blueprint that describes how to run a Docker container in ECS. In this step, we will create a task definition for our Docker Compose application. Make sure to specify the required CPU and memory resources for each container.

```bash
$ make aws-compose
INFO[0003] Using ECS task definition                     TaskDefinition="hyperdx:1"
```

## Step 4: Configure Load Balancing (Optional)

If your application requires load balancing, you can configure an Application Load Balancer (ALB) to distribute traffic across your containers. Follow the AWS documentation to set up an ALB and associate it with your ECS service.

```
Container <-> Target group <-> Application Load Balancer
```

|Container|Container Port|Target group|Target group Port - ALB Port|
|-|-|-|-|
|api|8000|hyperdx-api|80:443|
|app|8080|hyperdx-app|80:443|
|otel-collector|4318|hyperdx-otel|80:443|

### Create Target groups

> [!IMPORTANT]
> As of the end of 2023, AWS Web Console could not refer multiple loadBalancers to ECS services. [Set up via cli](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/register-multiple-targetgroups.html) to resolve [this issue](https://github.com/aws/containers-roadmap/issues/104).

Create an empty target group first, then associate that target group with ALB.
Copy the target group ARN and save it to `service-definition.json` for each item `"loadBalancers"`.

```json
  ...
  "loadBalancers": [
      {
        "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:aws_account_id:targetgroup/hyperdx-app/targetgroup_id",
        "containerName": "app",
        "containerPort": 8080
      },
      {
        "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:aws_account_id:targetgroup/hyperdx-api/targetgroup_id",
        "containerName": "api",
        "containerPort": 8000
      },
      {
        "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:aws_account_id:targetgroup/hyperdx-otel/targetgroup_id",
        "containerName": "otel-collector",
        "containerPort": 4318
      }
  ],
  ...
```

## Step 5: Create an ECS Service

An ECS service allows you to run and maintain a specified number of instances of a task definition. In this step, we will create an ECS service that runs our Docker Compose application. Specify the desired number of tasks and the task definition created in the previous step.

Copy the settings of the ECS cluster and save them to `service-definition.json` for each item of `"awsvpcConfiguration"`.

```json
  ...
  "networkConfiguration": {
      "awsvpcConfiguration": {
          "subnets": [
              "subnet-00000000000000000"
          ],
          "securityGroups": [
              "sg-00000000000000000"
          ],
          "assignPublicIp": "ENABLED"
      }
  },
  ...
```

and

```bash
$ make aws-create-service
```

## Conclusion

By following these steps, you can deploy your Docker Compose application to AWS ECS Fargate. This serverless compute engine provides a scalable and managed environment for running your containers without the need to manage the underlying infrastructure.

> [!NOTE]
> Try [hyperdx cloud](https://www.hyperdx.io/) to configure services without complicated settings!

# Troubleshooting

## default-user.xml: No such file or directory

![default-user.xml](https://github.com/hyperdxio/hyperdx/assets/59823089/d8c39942-b7cc-457a-a27e-f9dddc6aab71)

To explain how to put a config file from S3 into AWS EFS using DataSync, follow these steps:

1. Set up an AWS DataSync task. Configure the source location as the S3 bucket containing the config file and the destination location as the target EFS file system.
2. Specify the appropriate settings for the DataSync task, such as scheduling, filtering, and transfer options.
3. Start the DataSync task to initiate the transfer of the config file from S3 to EFS.
4. Monitor the progress of the DataSync task to ensure the successful completion of the file transfer.
5. Once the transfer is complete, the config file will be available in the designated location within the AWS EFS file system.

Please note that this is a high-level overview of the process, and it is recommended to refer to the AWS documentation for detailed instructions and best practices when using DataSync for transferring files between S3 and EFS.
