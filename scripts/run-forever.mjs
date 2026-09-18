#!/usr/bin/env node
// Запускает команду и перезапускает её при падении (любой ненулевой код выхода
// или сигнал). Экспоненциальная задержка между попытками, сброс — после
// стабильной работы.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const [command, ...commandArgs] = args.length > 0 ? args : ['node', 'dist/index.js'];

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const STABLE_UPTIME_MS = 30000;

let restartDelay = MIN_DELAY_MS;
let stopping = false;
let child;

function log(message) {
  console.log(`[run-forever] ${new Date().toISOString()} ${message}`);
}

function start() {
  log(`Starting: ${command} ${commandArgs.join(' ')}`);
  const startedAt = Date.now();
  child = spawn(command, commandArgs, { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    child = undefined;
    if (stopping) return;

    const uptime = Date.now() - startedAt;
    restartDelay = uptime > STABLE_UPTIME_MS ? MIN_DELAY_MS : Math.min(restartDelay * 2, MAX_DELAY_MS);

    log(`Process exited (code=${code}, signal=${signal}). Restarting in ${restartDelay}ms...`);
    setTimeout(start, restartDelay);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`Received ${signal}, shutting down...`);
  if (child) {
    child.kill(signal);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

start();
