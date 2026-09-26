import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToEpoch } from './time.js';

test('property-local check-in times convert correctly across time zones and DST',()=>{
 assert.equal(new Date(localDateTimeToEpoch('2026-09-26','15:00','Africa/Douala')).toISOString(),'2026-09-26T14:00:00.000Z');
 assert.equal(new Date(localDateTimeToEpoch('2026-01-15','15:00','America/New_York')).toISOString(),'2026-01-15T20:00:00.000Z');
 assert.equal(new Date(localDateTimeToEpoch('2026-07-15','15:00','America/New_York')).toISOString(),'2026-07-15T19:00:00.000Z');
 assert.equal(new Date(localDateTimeToEpoch('2026-09-26','15:00','Asia/Kolkata')).toISOString(),'2026-09-26T09:30:00.000Z');
});
