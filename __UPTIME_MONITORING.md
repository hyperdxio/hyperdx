# Uptime Monitoring Feature

This document describes the uptime monitoring feature added to HyperDX.

## Overview

The uptime monitoring feature allows users to monitor the availability and performance of their HTTP endpoints. It provides:

- Regular health checks for HTTP/HTTPS endpoints
- Configurable check intervals (1m, 5m, 10m, 15m, 30m, 1h)
- Multiple HTTP methods support (GET, POST, PUT, DELETE, HEAD, OPTIONS)
- Response time tracking
- Status code validation
- Response body content validation
- SSL/TLS certificate verification
- Webhook notifications for status changes
- Pause/resume functionality
- Historical check data with automatic cleanup (30-day retention)

## Architecture

### Backend Components

#### 1. Database Models

**UptimeMonitor** (`packages/api/src/models/uptimeMonitor.ts`)
- Stores monitor configuration
- Fields include: name, URL, method, interval, timeout, expected status codes, etc.
- Supports notification channels (webhooks)
- Tracks last check status and response time

**UptimeCheckHistory** (`packages/api/src/models/uptimeCheckHistory.ts`)
- Stores historical check results
- Automatically expires after 30 days (TTL index)
- Includes response time, status code, errors, and metadata

#### 2. API Controllers

**UptimeMonitors Controller** (`packages/api/src/controllers/uptimeMonitors.ts`)
- CRUD operations for monitors
- Pause/resume functionality
- Check history retrieval
- Statistics calculation (uptime percentage, avg response time, etc.)

#### 3. API Routes

**Uptime Monitors Router** (`packages/api/src/routers/api/uptimeMonitors.ts`)
- `GET /uptime-monitors` - List all monitors
- `GET /uptime-monitors/:id` - Get specific monitor
- `POST /uptime-monitors` - Create new monitor
- `PUT /uptime-monitors/:id` - Update monitor
- `DELETE /uptime-monitors/:id` - Delete monitor
- `POST /uptime-monitors/:id/pause` - Pause monitor
- `POST /uptime-monitors/:id/resume` - Resume monitor
- `GET /uptime-monitors/:id/history` - Get check history
- `GET /uptime-monitors/:id/stats` - Get uptime statistics

#### 4. Background Task

**CheckUptimeMonitorsTask** (`packages/api/src/tasks/checkUptimeMonitors.ts`)
- Runs periodically to check all active monitors
- Performs HTTP requests with configured settings
- Validates responses against expected criteria
- Sends notifications on status changes
- Updates monitor status and history

To run the task:
```bash
npm run task -- check-uptime-monitors
```

### Frontend Components

#### 1. Uptime Monitors Page

**UptimeMonitorsPage** (`packages/app/src/UptimeMonitorsPage.tsx`)
- Main page for managing uptime monitors
- Table view of all monitors with status indicators
- Create/edit/delete monitor functionality
- Pause/resume controls
- Shows last check time, response time, and errors

#### 2. Navigation

The uptime monitors page is accessible from the main navigation menu under "Uptime Monitors" (only visible in non-local mode).

#### 3. API Hooks

**API Hooks** (`packages/app/src/api.ts`)
- `useUptimeMonitors()` - Fetch all monitors
- `useUptimeMonitor(id)` - Fetch specific monitor
- `useCreateUptimeMonitor()` - Create monitor
- `useUpdateUptimeMonitor()` - Update monitor
- `useDeleteUptimeMonitor()` - Delete monitor
- `usePauseUptimeMonitor()` - Pause monitor
- `useResumeUptimeMonitor()` - Resume monitor
- `useUptimeCheckHistory(id, limit)` - Fetch check history
- `useUptimeStats(id, startDate, endDate)` - Fetch statistics

## Configuration

### Monitor Settings

When creating or editing a monitor, you can configure:

1. **Basic Settings**
   - Name: Display name for the monitor
   - URL: The endpoint to monitor
   - HTTP Method: GET, POST, PUT, DELETE, HEAD, OPTIONS
   - Check Interval: How often to check (1m - 1h)
   - Timeout: Request timeout in milliseconds (1000-60000)

2. **Validation Settings**
   - Expected Status Codes: List of acceptable HTTP status codes (default: [200])
   - Expected Response Time: Alert if response time exceeds this (optional)
   - Expected Body Contains: Check if response body contains a string (optional)
   - Verify SSL: Enable/disable SSL certificate verification

3. **Request Settings**
   - Headers: Custom HTTP headers (JSON format)
   - Body: Request body for POST/PUT requests

4. **Notifications**
   - Notification Channel: Select a webhook for alerts
   - Notifications are sent when status changes from UP to DOWN/DEGRADED or vice versa

### Status Types

- **UP**: Monitor is healthy and responding as expected
- **DOWN**: Monitor is not responding or failing validation
- **DEGRADED**: Monitor is responding but slower than expected
- **PAUSED**: Monitor is temporarily disabled

## Deployment

### Database Indexes

The models include optimized indexes for:
- Team-based queries
- Status filtering
- Time-based queries
- Automatic TTL cleanup

### Scheduled Task

To enable uptime monitoring checks, you need to run the task periodically. You can:

1. **Use the built-in cron** (development mode):
   - The task runs automatically every minute when `RUN_SCHEDULED_TASKS_EXTERNALLY=false`

2. **Use external cron** (production):
   - Set `RUN_SCHEDULED_TASKS_EXTERNALLY=true`
   - Schedule the task to run every minute:
   ```bash
   * * * * * cd /path/to/hyperdx && npm run task -- check-uptime-monitors
   ```

3. **Use Kubernetes CronJob**:
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: hyperdx-uptime-checks
   spec:
     schedule: "* * * * *"  # Every minute
     jobTemplate:
       spec:
         template:
           spec:
             containers:
             - name: uptime-checks
               image: hyperdx/api:latest
               command: ["npm", "run", "task", "--", "check-uptime-monitors"]
   ```

## Usage Examples

### Creating a Simple HTTP Monitor

```javascript
{
  "name": "API Health Check",
  "url": "https://api.example.com/health",
  "method": "GET",
  "interval": "5m",
  "timeout": 10000,
  "expectedStatusCodes": [200],
  "verifySsl": true
}
```

### Creating a Monitor with Authentication

```javascript
{
  "name": "Authenticated Endpoint",
  "url": "https://api.example.com/protected",
  "method": "GET",
  "interval": "5m",
  "timeout": 10000,
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  },
  "expectedStatusCodes": [200],
  "expectedBodyContains": "success"
}
```

### Creating a POST Monitor

```javascript
{
  "name": "API POST Endpoint",
  "url": "https://api.example.com/webhook",
  "method": "POST",
  "interval": "10m",
  "timeout": 15000,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"test\": true}",
  "expectedStatusCodes": [200, 201]
}
```

## Integration with Existing Features

### Webhooks

Uptime monitors can send notifications through the existing webhook system:
1. Create a webhook in the Webhooks page (Slack or Generic)
2. Select the webhook when creating/editing a monitor
3. Receive alerts when monitor status changes

### Alerting

The uptime monitoring system integrates with HyperDX's notification infrastructure:
- Uses the same webhook templates as alerts
- Sends formatted messages with monitor details
- Includes status changes, response times, and errors

## Future Enhancements

Potential improvements for the uptime monitoring feature:

1. **Dashboard Integration**
   - Add uptime charts to dashboards
   - Visualize response time trends
   - Show uptime percentage over time

2. **Advanced Monitoring**
   - Multi-region checks
   - Custom scripts/assertions
   - Certificate expiration warnings
   - DNS resolution tracking

3. **Incident Management**
   - Automatic incident creation
   - Escalation policies
   - On-call scheduling

4. **Reporting**
   - SLA reports
   - Uptime summaries
   - Performance trends

5. **Status Pages**
   - Public status page generation
   - Subscriber notifications
   - Historical incident timeline

## Troubleshooting

### Monitor Not Running

1. Check if the task is scheduled:
   ```bash
   npm run task -- check-uptime-monitors
   ```

2. Verify the monitor is not paused:
   - Check the `paused` field in the database
   - Use the resume button in the UI

3. Check the interval:
   - Monitors only run based on their configured interval
   - Last check time is stored in `lastCheckedAt`

### Notifications Not Sending

1. Verify webhook configuration:
   - Check if webhook exists and is valid
   - Test the webhook independently

2. Check notification conditions:
   - Notifications only send on status changes
   - Verify the monitor status has actually changed

3. Review logs:
   - Check for webhook errors in application logs
   - Look for "Failed to send uptime monitor notification" messages

### False Positives

1. Adjust timeout settings:
   - Increase timeout for slow endpoints
   - Consider network latency

2. Review expected status codes:
   - Ensure all valid status codes are listed
   - Check for redirects (301, 302)

3. Verify SSL settings:
   - Disable SSL verification for self-signed certificates
   - Check certificate validity

## Testing

To test the uptime monitoring feature:

1. Create a test monitor pointing to a reliable endpoint
2. Set a short interval (1m) for quick testing
3. Verify the monitor runs and updates status
4. Test pause/resume functionality
5. Create a monitor pointing to a non-existent URL to test DOWN status
6. Verify notifications are sent (if webhook configured)

## Code Reuse

This implementation reuses several existing HyperDX patterns:

- **Model Structure**: Similar to Alert and SLO models
- **API Routes**: Follows the same pattern as alerts and SLOs
- **Task System**: Integrates with existing task infrastructure
- **Webhook Integration**: Uses existing webhook notification system
- **Frontend Patterns**: Follows AlertsPage and SLOPage patterns
- **React Hooks**: Uses the same API hook patterns

This ensures consistency with the existing codebase and makes the feature easy to maintain.

