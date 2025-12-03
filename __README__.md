## Running Clickhouse Migrations

brew install golang-migrate
yarn run dev:migrate-ch

API_KEY=5b29561b-d60a-4c28-8e07-6c831b8ef773 TYPE=traces ERROR_RATE=0.10 npx -y tsx packages/api/scripts/generate-slo-data.ts 
API_KEY=5b29561b-d60a-4c28-8e07-6c831b8ef773 TYPE=traces npx -y tsx packages/api/scripts/generate-slo-data.ts

RUN_SCHEDULED_TASKS_EXTERNALLY=false yarn run slo-task
RUN_SCHEDULED_TASKS_EXTERNALLY=false yarn run uptime-task



https://console.anthropic.com/settings/keys