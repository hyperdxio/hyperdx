## Running Clickhouse Migrations

brew install golang-migrate
yarn run dev:migrate-ch

API_KEY=511a470a-241a-458c-9d00-4f08373ee5d3 TYPE=traces ERROR_RATE=0.40 npx -y tsx packages/api/scripts/generate-slo-data.ts 
API_KEY=511a470a-241a-458c-9d00-4f08373ee5d3 TYPE=traces npx -y tsx packages/api/scripts/generate-slo-data.ts

RUN_SCHEDULED_TASKS_EXTERNALLY=false yarn run slo-task
RUN_SCHEDULED_TASKS_EXTERNALLY=false yarn run uptime-task
RUN_SCHEDULED_TASKS_EXTERNALLY=false yarn run alert-task




https://console.anthropic.com/settings/keys