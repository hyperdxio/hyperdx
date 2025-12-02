/**
 * Quick verification script to test the fix
 * Run with: node verify-fix.js
 */
const { createClient } = require('@clickhouse/client');

async function verify() {
  const client = createClient({
    url: 'http://localhost:8123',
    username: 'default',
    password: '',
  });

  try {
    console.log('✅ Verifying the fix...\n');

    // Test 1: Insert into slo_definitions
    console.log('Test 1: Inserting into slo_definitions with Date objects...');
    const testId1 = 'verify-test-' + Date.now();
    await client.insert({
      table: 'default.slo_definitions',
      values: [{
        id: testId1,
        service_name: 'test-service',
        slo_name: 'test-slo',
        metric_type: 'availability',
        target_value: 99.5,
        time_window: '30d',
        source_table: 'otel_logs',
        numerator_query: 'SELECT count() FROM logs WHERE status=200',
        denominator_query: 'SELECT count() FROM logs',
        alert_threshold: 80,
        created_at: new Date(),
        updated_at: new Date(),
      }],
      format: 'JSONEachRow',
      clickhouse_settings: {
        date_time_input_format: 'best_effort',
        wait_end_of_query: 1,
      },
    });
    console.log('✅ Test 1 passed!\n');

    // Test 2: Insert into slo_aggregates
    console.log('Test 2: Inserting into slo_aggregates with Date objects...');
    await client.insert({
      table: 'default.slo_aggregates',
      values: [{
        slo_id: testId1,
        timestamp: new Date(),
        numerator_count: 99,
        denominator_count: 100,
      }],
      format: 'JSONEachRow',
      clickhouse_settings: {
        date_time_input_format: 'best_effort',
        wait_end_of_query: 1,
      },
    });
    console.log('✅ Test 2 passed!\n');

    // Verify data was inserted
    console.log('Verifying data...');
    const result = await client.query({
      query: `SELECT * FROM default.slo_definitions WHERE id = '${testId1}'`,
      format: 'JSON',
    });
    const data = await result.json();

    if (data.data.length > 0) {
      console.log('✅ Data verified:', {
        id: data.data[0].id,
        slo_name: data.data[0].slo_name,
        created_at: data.data[0].created_at,
      });
    }

    // Clean up
    console.log('\nCleaning up test data...');
    await client.command({ query: `ALTER TABLE default.slo_definitions DELETE WHERE id LIKE 'verify-test-%'` });
    await client.command({ query: `ALTER TABLE default.slo_aggregates DELETE WHERE slo_id LIKE 'verify-test-%'` });

    console.log('\n✅ All tests passed! The fix is working correctly.');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Error code:', error.code);
    process.exit(1);
  } finally {
    await client.close();
  }
}

verify();

