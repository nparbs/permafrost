// Open the WebSocket, say hello and wait for the welcome.

import type { Transport, Welcome } from './netSession';
import { PROTOCOL_VERSION, type ServerMsg } from './protocol';

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export interface Hello {
  token?: string;
  name?: string;
  paint?: number;
}

export function connect(hello: Hello, url = wsUrl(), timeoutMs = 8000): Promise<{ transport: Transport; welcome: Welcome }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }
    // Hold messages that arrive before the session is listening.
    const early: ServerMsg[] = [];
    const t: Transport = {
      send: (m) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      },
      close: () => ws.close(1000, 'bye'),
    };
    let listener: ((m: ServerMsg) => void) | undefined;
    Object.defineProperty(t, 'onMessage', {
      get: () => listener,
      set: (fn: (m: ServerMsg) => void) => {
        listener = fn;
        for (const m of early.splice(0)) fn(m);
      },
    });
    let done = false;
    const fail = (why: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail("The server didn't answer."), timeoutMs);
    ws.onopen = () => t.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!done) {
        if (m.t === 'welcome') {
          done = true;
          clearTimeout(timer);
          resolve({ transport: t, welcome: m });
        } else if (m.t === 'error') {
          fail(m.msg);
        }
        return;
      }
      if (listener) listener(m);
      else early.push(m);
    };
    ws.onclose = (e) => {
      if (!done) fail("Couldn't reach the server.");
      else t.onClose?.(e.reason || 'The connection dropped.');
    };
  });
}
