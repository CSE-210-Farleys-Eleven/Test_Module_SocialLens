import type { AdaptWorker, WorkerLike } from './contract';

export const adaptWorker: AdaptWorker = (worker) => {
  let onmessage: WorkerLike['onmessage'] = null;
  let onerror: WorkerLike['onerror'] = null;
  const messageListener = (e: Event): void => onmessage?.({ data: (e as MessageEvent).data });
  const errorListener = (e: Event): void => onerror?.(e);
  worker.addEventListener('message', messageListener);
  worker.addEventListener('error', errorListener);
  worker.addEventListener('messageerror', errorListener);
  return {
    postMessage: (m) => worker.postMessage(m),
    terminate: () => worker.terminate(),
    get onmessage() {
      return onmessage;
    },
    set onmessage(h) {
      onmessage = h;
    },
    get onerror() {
      return onerror;
    },
    set onerror(h) {
      onerror = h;
    },
  };
};
