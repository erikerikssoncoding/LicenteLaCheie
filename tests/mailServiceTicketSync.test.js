import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, test } from 'node:test';

const originalAbortTimeout = process.env.MAIL_TICKET_SYNC_ABORT_TIMEOUT_MS;
process.env.MAIL_TICKET_SYNC_ABORT_TIMEOUT_MS = '50';

const mailService = await import('../src/services/mailService.js');
const {
  __resetTicketSyncStateForTests,
  __setTicketSyncStateForTests,
  getTicketInboxSyncState,
  stopTicketInboxSync
} = mailService;

beforeEach(() => {
  __resetTicketSyncStateForTests();
});

afterEach(() => {
  __resetTicketSyncStateForTests();
  process.env.MAIL_TICKET_SYNC_ABORT_TIMEOUT_MS = originalAbortTimeout;
});

test('stopping an in-flight ticket sync forces cleanup and re-enables controls', async () => {
  let closeCalled = false;
  const mockClient = {
    close: async () => {
      closeCalled = true;
    }
  };

  __setTicketSyncStateForTests({ inProgress: true, client: mockClient });

  const result = stopTicketInboxSync();
  assert.equal(result.wasRunning, true);
  assert.equal(result.abortRequested, true);

  const interimState = getTicketInboxSyncState();
  assert.equal(interimState.inProgress, true);
  assert.equal(interimState.abortRequested, true);

  await delay(1200);

  const finalState = getTicketInboxSyncState();
  assert.equal(finalState.inProgress, false);
  assert.equal(finalState.abortRequested, false);
  assert.ok(closeCalled);
});
