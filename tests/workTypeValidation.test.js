import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { OFFER_WORK_TYPES, offerSubmissionSchema } from '../src/routes/public.js';

const OFFER_TEMPLATE_PATH = new URL('../src/views/pages/offer.ejs', import.meta.url);

const buildValidPayload = (workType) => ({
  clientName: 'Client Test',
  email: 'client@example.com',
  phone: '+40712345678',
  program: 'Program valid',
  topic: 'Subiect valid pentru test',
  workType,
  deliveryDate: '2999-12-31'
});

test('work type select values match the validation enum', async () => {
  const template = await readFile(OFFER_TEMPLATE_PATH, 'utf8');
  const [_, selectContent = ''] = template.split('id="workType"', 2);
  const [selectBody = ''] = selectContent.split('</select>', 1);
  const optionValues = Array.from(selectBody.matchAll(/value="([^"]+)"/g)).map(([, value]) => value);

  assert.deepEqual(optionValues, OFFER_WORK_TYPES);
});

test('offer schema accepts every work type option', () => {
  for (const workType of OFFER_WORK_TYPES) {
    assert.doesNotThrow(() => offerSubmissionSchema.parse(buildValidPayload(workType)));
  }
});
