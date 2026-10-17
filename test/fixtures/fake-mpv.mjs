#!/usr/bin/env node
// Protocol fixture only. This process never plays or synthesizes music.
import { statSync, read, writeSync, appendFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
// Use plain inherited-descriptor I/O; no listening socket or network API is used.
let paused = true, speed = 1, position = 0, observed = false, ended = false, anchor = performance.now();
const duration = 211944;
const now = () => Math.min(duration, position + (paused ? 0 : (performance.now() - anchor) * speed));
const send = value => { try { writeSync(3, JSON.stringify(value) + '\n'); } catch { process.exit(0); } };
let buffer = '';
const consume = chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const text = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!text) continue;
    const { command, request_id } = JSON.parse(text); let data = null, error = 'success', event;
    if (process.env.FAKE_MPV_COMMAND_LOG) appendFileSync(process.env.FAKE_MPV_COMMAND_LOG, JSON.stringify(command) + '\n');
    if (command[0] === 'observe_property') observed = true;
    else if (command[0] === 'loadfile') {
      try { statSync(command[1]); position = 0; ended = false; anchor = performance.now(); event = 'file-loaded'; }
      catch { send({ event: 'end-file', reason: 'error', file_error: 'fixture-missing-file' }); }
    } else if (command[0] === 'get_property') {
      data = ({ 'time-pos': ended ? undefined : now() / 1000, duration: duration / 1000, pause: paused, speed })[command[1]];
      if (data === undefined) error = 'property unavailable';
    } else if (command[0] === 'set_property') {
      position = now(); anchor = performance.now();
      if (command[1] === 'pause') paused = command[2];
      if (command[1] === 'speed') speed = command[2];
    } else if (command[0] === 'seek') { position = command[1] * 1000; anchor = performance.now(); ended = false; event = 'playback-restart'; }
    else if (command[0] === 'quit') { clearInterval(timer); process.exit(0); }
    else error = 'command not found';
    send({ request_id, data, error }); if (event) send({ event });
    if (observed) send({ event: 'property-change', name: 'time-pos', data: now() / 1000 });
  }
};
const decoder = new StringDecoder('utf8'), incoming = Buffer.alloc(8192);
let reading = false;
const reader = setInterval(() => {
  if (reading) return; reading = true;
  read(3, incoming, 0, incoming.length, null, (error, count) => {
    reading = false;
    if (error) { if (error.code !== 'EAGAIN') process.exit(0); return; }
    if (!count) process.exit(0);
    consume(decoder.write(incoming.subarray(0, count)));
  });
}, 5);
const timer = setInterval(() => {
  if (observed) send({ event: 'property-change', name: 'time-pos', data: now() / 1000 });
  if (now() >= duration && !ended) { ended = true; send({ event: 'end-file', reason: 'eof' }); }
}, 50);
void reader;
if (process.env.FAKE_MPV_EXIT_AFTER_MS) setTimeout(() => process.exit(17), Number(process.env.FAKE_MPV_EXIT_AFTER_MS));
