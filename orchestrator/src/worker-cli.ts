import './env-preload.js';
import process from 'node:process';
import { runWorkerMain } from './sdlc/worker.js';

runWorkerMain(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
