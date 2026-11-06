import process from 'node:process';
import { runSdlcFromArgv } from './sdlc/pipeline.js';

runSdlcFromArgv(process.argv.slice(2)).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
