include ../.env.aws

.PHONY: aws-ecs
aws-ecs:
	ecs-cli configure profile --profile-name ${ECS_PROFILE_NAME} --access-key ${AWS_ACCESS_KEY_ID} --secret-key ${AWS_SECRET_ACCESS_KEY}
	ecs-cli configure --cluster ${ECS_CLUSTER_NAME} --default-launch-type ${ECS_LAUNCH_TYPE} --region ${AWS_REGION} --config-name ${ECS_PROFILE_NAME}

.PHONY: aws-compose
aws-compose:
	HYPERDX_APP_URL=${HYPERDX_APP_ALB_URL} HYPERDX_APP_PORT=${HYPERDX_APP_ALB_PORT} ecs-cli compose --project-name ${ECS_CLUSTER_NAME} --file ./docker-compose.aws.yml --region ${AWS_REGION} --ecs-params ./ecs-params.yml create --launch-type ${ECS_LAUNCH_TYPE} --create-log-groups

.PHONY: aws-create-service
aws-create-service:
	aws ecs create-service --service-name ${ECS_SERVICE_NAME} --cluster ${ECS_CLUSTER_NAME} --cli-input-json file://service-definition.json
