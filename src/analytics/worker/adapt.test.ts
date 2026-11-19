import { describe, expect, it } from 'vitest';
import { adaptWorker } from './index';

class FakeNativeWorker extends EventTarget {
  posted: unknown[] = [];
  terminated = 0;
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated += 1;
  }
}
const asWorker = (w: FakeNativeWorker) => w as unknown as Worker;

describe('adaptWorker', () => {
  it('forwards postMessage and terminate', () => {
    const w = new FakeNativeWorker();
    const a = adaptWorker(asWorker(w));
    const req = { type: 'analyse', job: { jobId: 'x' } } as never;
    a.postMessage(req);
    a.terminate();
    expect(w.posted).toEqual([req]);
    expect(w.terminated).toBe(1);
  });

  it('delivers message events to onmessage with data', () => {
    const w = new FakeNativeWorker();
    const a = adaptWorker(asWorker(w));
    const got: unknown[] = [];
    a.onmessage = (e) => void got.push(e.data);
    w.dispatchEvent(Object.assign(new Event('message'), { data: { hi: 1 } }));
    expect(got).toEqual([{ hi: 1 }]);
  });

  it('delivers error and messageerror to onerror', () => {
    const w = new FakeNativeWorker();
    const a = adaptWorker(asWorker(w));
    let n = 0;
    a.onerror = () => void (n += 1);
    w.dispatchEvent(new Event('error'));
    w.dispatchEvent(new Event('messageerror'));
    expect(n).toBe(2);
  });

  it('stops delivery when a handler is set to null or replaced', () => {
    const w = new FakeNativeWorker();
    const a = adaptWorker(asWorker(w));
    let m = 0;
    let e = 0;
    a.onmessage = () => void (m += 1);
    a.onerror = () => void (e += 1);
    a.onmessage = null;
    a.onerror = null;
    w.dispatchEvent(new Event('message'));
    w.dispatchEvent(new Event('error'));
    w.dispatchEvent(new Event('messageerror'));
    expect([m, e]).toEqual([0, 0]);
    let m2 = 0;
    a.onmessage = () => void (m2 += 1);
    a.onmessage = () => void (m2 += 10);
    w.dispatchEvent(new Event('message'));
    expect(m2).toBe(10);
  });
});
