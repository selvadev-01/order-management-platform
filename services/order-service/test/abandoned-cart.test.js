/**
 * Abandoned-cart reminder scheduling (docx §7 — the delayed job).
 *
 * The queue is a fake recording what BullMQ was asked to do, so these assert
 * the scheduling decisions — delay, replacement, cancellation — without Redis.
 * The cart's own resolution is stubbed, since what is under test is which job
 * a given cart state produces, not how the cart is read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CartService } from '../src/cart.service.js';
import { NotificationEvent, ABANDONED_CART_DELAY_MS } from '@oms/shared';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** Minimal stand-in for a BullMQ queue, recording adds and removals. */
function fakeQueue() {
  const jobs = new Map();
  return {
    jobs,
    added: [],
    removed: [],
    async add(name, data, opts) {
      const job = { name, data, opts, remove: async () => jobs.delete(opts.jobId) };
      jobs.set(opts.jobId, job);
      this.added.push({ name, data, opts });
      return job;
    },
    async getJob(id) {
      const job = jobs.get(id);
      if (!job) return null;
      return {
        ...job,
        remove: async () => {
          jobs.delete(id);
          this.removed.push(id);
        },
      };
    },
  };
}

/**
 * The cart mutation methods query Mongo before they reach the scheduling step,
 * so these drive `scheduleAbandonedCartReminder` directly — it is the step
 * every mutation performs once its write has committed.
 */
function makeService(queue) {
  return new CartService({ productClient: null, queue, logger: quiet });
}

const USER = 'user-1';
const JOB_ID = `${NotificationEvent.ABANDONED_CART}-${USER}`;

test('a non-empty cart schedules a delayed reminder', async () => {
  const queue = fakeQueue();
  const service = makeService(queue);

  await service.scheduleAbandonedCartReminder(USER, 2);

  assert.equal(queue.added.length, 1);
  const [job] = queue.added;
  assert.equal(job.name, NotificationEvent.ABANDONED_CART);
  assert.equal(job.opts.delay, ABANDONED_CART_DELAY_MS, 'must be delayed, not immediate');
  assert.equal(job.opts.jobId, JOB_ID);
  assert.equal(job.data.cart.itemCount, 2);
  assert.equal(job.data.userId, USER);
});

test('a further mutation replaces the pending reminder rather than adding a second', async () => {
  const queue = fakeQueue();
  const service = makeService(queue);

  await service.scheduleAbandonedCartReminder(USER, 2);
  await service.scheduleAbandonedCartReminder(USER, 3);

  // The timer measures inactivity, so the old job must be removed first.
  assert.deepEqual(queue.removed, [JOB_ID]);
  assert.equal(queue.added.length, 2);
  assert.equal(queue.jobs.size, 1, 'only one reminder may be pending per user');
});

test('emptying the cart cancels the reminder instead of scheduling one', async () => {
  const queue = fakeQueue();
  const service = makeService(queue);

  await service.scheduleAbandonedCartReminder(USER, 2);
  assert.equal(queue.jobs.size, 1);

  await service.scheduleAbandonedCartReminder(USER, 0);

  assert.equal(queue.jobs.size, 0, 'an empty cart has nothing to be reminded about');
});

test('checkout cancels the pending reminder', async () => {
  const queue = fakeQueue();
  const service = makeService(queue);

  await service.scheduleAbandonedCartReminder(USER, 2);
  // What clear() calls once an order commits — a converted cart was not abandoned.
  await service.cancelAbandonedCartReminder(USER);

  assert.equal(queue.jobs.size, 0);
});

test('a queue outage does not fail the cart operation', async () => {
  const broken = {
    async getJob() {
      throw new Error('redis down');
    },
    async add() {
      throw new Error('redis down');
    },
  };
  const service = makeService(broken);

  // Must resolve rather than reject: the customer's cart operation comes first.
  await service.scheduleAbandonedCartReminder(USER, 1);
});
